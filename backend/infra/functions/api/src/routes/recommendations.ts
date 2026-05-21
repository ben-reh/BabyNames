import { BatchGetCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE, ORIGIN_INDEX } from '../db/dynamo';

const LISTS_TABLE = 'Lists';
import { getPool } from '../db/postgres';
import { ok, err } from '../utils';
import { formatName } from './names';
import rerankerData from '../reranker.json';

type Params = Record<string, string | undefined>;

// ── Vector layout constants (must match compute_vectors.py) ──────────────────
const HC_DIMS   = 55;
const EMBED_DIMS = 512;
const ORIGIN_END = 36;   // origin one-hot occupies dims [0, ORIGIN_END)
const YEAR_DIM   = 36;
const SYL_DIM    = 37;
const POP_DIM    = 54;
const ORIGIN_ACTIVE = 1.5;
const ORIGIN_TOL    = 0.1;
const VECTOR_DIM    = HC_DIMS + EMBED_DIMS; // 567

// ── Retrieval / deck constants ────────────────────────────────────────────────
const RETRIEVAL_K  = 100;  // ANN pool size per centroid
const SIMILARITY_SIZE  = 10;
const POPULAR_SIZE     = 5;
const EXPLORATION_SIZE = 5;
const POPULAR_POOL     = 150;
const EXPLORATION_MIN_COUNT = 25;
const EXPLORATION_MAX_COUNT = 499;
const COLD_START_LIMIT = 100;

// Reranker blend: BLEND * cosine_rank_score + (1 - BLEND) * reranker_score
const BLEND = 0.2;

// k-means multi-vector thresholds (must match Python handler)
const CLUSTER_MIN_LIKES        = 8;
const CLUSTER_K_HIGH_THRESHOLD = 20;

// ── Filter helpers ────────────────────────────────────────────────────────────
const UNISEX_MIN = 0.05;
const UNISEX_MAX = 0.95;
const SEX_FILTER_F = 0.05;
const SEX_FILTER_M = 0.95;

function vSex(sex: string | undefined): 'F' | 'M' | 'U' {
  return sex === 'F' || sex === 'M' || sex === 'U' ? sex : 'U';
}

function sexClause(sex: string | undefined): string {
  const pct = `COALESCE(np.female_pct, nv.female_pct, 0.5)`;
  if (sex === 'F') return `AND ${pct} >= ${SEX_FILTER_F}`;
  if (sex === 'M') return `AND ${pct} <= ${SEX_FILTER_M}`;
  if (sex === 'U') return `AND ${pct} > ${UNISEX_MIN} AND ${pct} < ${UNISEX_MAX}`;
  return '';
}

function popularityClause(tiers: string[]): string {
  if (tiers.length === 0 || tiers.length === 3) return '';
  const conditions: string[] = [];
  if (tiers.includes('popular'))  conditions.push('np.count >= 5000');
  if (tiers.includes('familiar')) conditions.push('(np.count >= 1500 AND np.count < 5000)');
  if (tiers.includes('unique'))   conditions.push('np.count < 1500');
  return conditions.length ? `AND (${conditions.join(' OR ')})` : '';
}

const NP_AGG = `(
  SELECT name,
         SUM(count)                                                               AS count,
         SUM(CASE WHEN gender='F' THEN count ELSE 0 END)::float / NULLIF(SUM(count),0) AS female_pct
  FROM   name_popularity WHERE year = 2025 GROUP BY name
) np`;

// ── Math helpers ──────────────────────────────────────────────────────────────
function parseVec(pgvecStr: string): number[] {
  return pgvecStr.slice(1, -1).split(',').map(Number);
}

function l2norm(v: number[]): number[] {
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag);
  if (mag === 0) return v.slice();
  return v.map(x => x / mag);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function sqDist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

function vecToStr(v: number[]): string {
  return `[${v.join(',')}]`;
}

function blendVecs(a: number[], b: number[]): string {
  return `[${a.map((v, i) => 0.5 * v + 0.5 * b[i]).join(',')}]`;
}

// ── K-means++ ────────────────────────────────────────────────────────────────
function kmeanspp(vectors: number[][], k: number, maxIter = 20): number[][] {
  const n = vectors.length;
  if (n <= k) return vectors.slice();
  const dim = vectors[0].length;

  // k-means++ seeding
  const centroids: number[][] = [vectors[Math.floor(Math.random() * n)]];
  for (let c = 1; c < k; c++) {
    const dists = vectors.map(v => Math.min(...centroids.map(cen => sqDist(v, cen))));
    const total = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) { r -= dists[i]; if (r <= 0) { chosen = i; break; } }
    centroids.push(vectors[chosen]);
  }

  for (let iter = 0; iter < maxIter; iter++) {
    const assignments = vectors.map(v =>
      centroids.reduce((best, cen, i) => sqDist(v, cen) < sqDist(v, centroids[best]) ? i : best, 0),
    );
    let changed = false;
    for (let c = 0; c < k; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c);
      if (members.length === 0) continue;
      const newCen = new Array<number>(dim).fill(0);
      for (const v of members) for (let d = 0; d < dim; d++) newCen[d] += v[d];
      for (let d = 0; d < dim; d++) newCen[d] /= members.length;
      if (sqDist(newCen, centroids[c]) > 1e-12) changed = true;
      centroids[c] = newCen;
    }
    if (!changed) break;
  }
  return centroids;
}

// ── GBC reranker ─────────────────────────────────────────────────────────────
interface GBCTree {
  feature: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[];
}

interface RerankerModel {
  learning_rate: number;
  init_score: number;   // log-odds of positive class
  scaler_mean: number[];
  scaler_scale: number[];
  trees: GBCTree[];
}

const RERANKER = rerankerData as RerankerModel;

function traverseTree(scaled: number[], tree: GBCTree): number {
  let node = 0;
  while (tree.left[node] !== -1) {
    node = scaled[tree.feature[node]] <= tree.threshold[node]
      ? tree.left[node]
      : tree.right[node];
  }
  return tree.value[node];
}

function rerankerScore(rawFeatures: number[]): number {
  const { scaler_mean, scaler_scale, learning_rate, init_score, trees } = RERANKER;
  const scaled = rawFeatures.map((x, i) => (x - scaler_mean[i]) / scaler_scale[i]);
  let F = init_score;
  for (const tree of trees) F += learning_rate * traverseTree(scaled, tree);
  return 1 / (1 + Math.exp(-F)); // sigmoid → probability of positive class
}

function originIndex(v: number[]): number {
  for (let i = 0; i < ORIGIN_END; i++) {
    if (Math.abs(v[i] - ORIGIN_ACTIVE) < ORIGIN_TOL) return i;
  }
  return -1;
}

// Features: [cos_sim, emb_cos, origin_match, year_diff, syl_diff, pop_diff]
function rerankerFeatures(
  queryVec: number[], queryNorm: number[], queryEmbNorm: number[],
  candVec:  number[], candNorm:  number[], candEmbNorm:  number[],
): number[] {
  const cos        = dot(queryNorm, candNorm);
  const embCos     = dot(queryEmbNorm, candEmbNorm);
  const qi         = originIndex(queryVec);
  const ci         = originIndex(candVec);
  const origMatch  = (qi === ci && qi !== -1) ? 1.0 : 0.0;
  const yearDiff   = Math.abs(queryVec[YEAR_DIM] - candVec[YEAR_DIM]);
  const sylDiff    = Math.abs(queryVec[SYL_DIM]  - candVec[SYL_DIM]);
  const popDiff    = Math.abs(queryVec[POP_DIM]  - candVec[POP_DIM]);
  return [cos, embCos, origMatch, yearDiff, sylDiff, popDiff];
}

// Rerank a pool of candidates against a taste vector.
// Returns names sorted best-first (blend of cosine rank + GBC score).
function rerankPool(
  pool: Array<{ name: string; vec: number[] }>,
  tasteVec: number[],
): string[] {
  if (pool.length === 0) return [];
  const tasteNorm    = l2norm(tasteVec);
  const tasteEmbNorm = l2norm(tasteVec.slice(HC_DIMS, HC_DIMS + EMBED_DIMS));
  const n = pool.length;

  const scored = pool.map(({ name, vec }, rank) => {
    const candNorm    = l2norm(vec);
    const candEmbNorm = l2norm(vec.slice(HC_DIMS, HC_DIMS + EMBED_DIMS));
    const features    = rerankerFeatures(tasteVec, tasteNorm, tasteEmbNorm, vec, candNorm, candEmbNorm);
    const rScore      = rerankerScore(features);
    const cosScore    = 1 - rank / n; // 1.0 for first ANN result, approaching 0
    return { name, score: BLEND * cosScore + (1 - BLEND) * rScore };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.name);
}

// ── Origin filter ─────────────────────────────────────────────────────────────
async function getOriginNames(origins: string[]): Promise<Set<string> | null> {
  if (origins.length === 0) return null;
  const results = await Promise.all(
    origins.map(origin =>
      ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: ORIGIN_INDEX,
        KeyConditionExpression: 'origin = :o',
        ExpressionAttributeValues: { ':o': origin },
        ProjectionExpression: '#n',
        ExpressionAttributeNames: { '#n': 'name' },
      })),
    ),
  );
  const names = new Set<string>();
  for (const r of results) for (const item of (r.Items ?? [])) names.add(item.name as string);
  return names;
}

// ── Schema migration ───────────────────────────────────────────────────────────
let schemaMigrated = false;
async function ensureSchema(pool: ReturnType<typeof getPool>) {
  if (schemaMigrated) return;
  const run = async (sql: string) => { try { await pool.query(sql); } catch { /* already applied */ } };

  await run(`ALTER TABLE user_swipes ADD COLUMN IF NOT EXISTS sex_context TEXT`);
  await run(`UPDATE user_swipes SET sex_context = 'U' WHERE sex_context IS NULL`);
  await run(`ALTER TABLE user_swipes ALTER COLUMN sex_context SET NOT NULL`);
  await run(`ALTER TABLE user_swipes ALTER COLUMN sex_context SET DEFAULT 'U'`);
  await run(`ALTER TABLE user_swipes DROP CONSTRAINT IF EXISTS user_swipes_pkey`);
  await run(`ALTER TABLE user_swipes DROP CONSTRAINT IF EXISTS user_swipes_user_id_name_key`);
  await run(`ALTER TABLE user_swipes ADD CONSTRAINT user_swipes_user_id_name_ctx UNIQUE (user_id, name, sex_context)`);

  await run(`ALTER TABLE user_taste ADD COLUMN IF NOT EXISTS sex_context TEXT NOT NULL DEFAULT 'U'`);
  await run(`ALTER TABLE user_taste DROP CONSTRAINT IF EXISTS user_taste_pkey`);
  await run(`ALTER TABLE user_taste DROP CONSTRAINT IF EXISTS user_taste_user_id_key`);
  await run(`ALTER TABLE user_taste ADD CONSTRAINT user_taste_user_id_ctx UNIQUE (user_id, sex_context)`);

  // Wipe and retype user_taste.embedding if dimension doesn't match new vectors
  await pool.query(`DO $$
    DECLARE col_type text;
    BEGIN
      SELECT pg_catalog.format_type(atttypid, atttypmod) INTO col_type
      FROM pg_attribute
      WHERE attrelid = 'user_taste'::regclass AND attname = 'embedding' AND NOT attisdropped;
      IF col_type IS DISTINCT FROM 'vector(${VECTOR_DIM})' THEN
        TRUNCATE user_taste;
        EXECUTE 'ALTER TABLE user_taste ALTER COLUMN embedding TYPE vector(${VECTOR_DIM})';
      END IF;
    END $$`);

  schemaMigrated = true;
}

// ── Enrichment ────────────────────────────────────────────────────────────────
async function enrichNames(names: string[], rankSex?: string) {
  if (names.length === 0) return [];
  const pool = getPool();
  const [batchResult, rankResult] = await Promise.all([
    ddb.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: names.map(n => ({ name: n })) } } })),
    pool.query<{ name: string; gender: string; rank_2025: string; female_pct: string }>(
      `SELECT name, gender, rank_2025,
              female_count::float / NULLIF(total_count, 0) AS female_pct
       FROM (
         SELECT name, gender,
                RANK() OVER (PARTITION BY gender ORDER BY count DESC) AS rank_2025,
                SUM(count) OVER (PARTITION BY name) AS total_count,
                SUM(CASE WHEN gender = 'F' THEN count ELSE 0 END) OVER (PARTITION BY name) AS female_count
         FROM name_popularity WHERE year = 2025
       ) r WHERE name = ANY($1::text[])`,
      [names],
    ),
  ]);

  const itemMap = new Map<string, Record<string, unknown>>();
  for (const item of (batchResult.Responses?.[TABLE] ?? []) as Record<string, unknown>[]) {
    itemMap.set(item.name as string, item);
  }
  const rank2025Map = new Map<string, number>();
  const femalePctMap = new Map<string, number>();
  for (const row of rankResult.rows) {
    rank2025Map.set(`${row.name}-${row.gender}`, Number(row.rank_2025));
    femalePctMap.set(row.name, Number(row.female_pct));
  }

  return names
    .map(n => {
      const item = itemMap.get(n);
      if (!item) return null;
      const primarySex = item.sex as string;
      const lookupSex  = rankSex ?? primarySex;
      const formatted  = formatName(item);
      return {
        ...formatted,
        female_pct:  femalePctMap.has(n) ? femalePctMap.get(n)! : formatted.female_pct,
        rank_2025:   rank2025Map.get(`${n}-${lookupSex}`) ?? rank2025Map.get(`${n}-${primarySex}`) ?? null,
      };
    })
    .filter(Boolean);
}

async function getPartnerDeviceId(listId: string, deviceId: string): Promise<string | null> {
  const result = await ddb.send(new GetCommand({ TableName: LISTS_TABLE, Key: { listId } }));
  const list = result.Item as { partnerA?: { deviceId: string }; partnerB?: { deviceId: string } } | undefined;
  if (!list) return null;
  if (list.partnerA?.deviceId === deviceId) return list.partnerB?.deviceId ?? null;
  if (list.partnerB?.deviceId === deviceId) return list.partnerA?.deviceId ?? null;
  return null;
}

// ── Cold-start deck ───────────────────────────────────────────────────────────
// Pre-computed diverse cold-start deck (k=10 clusters × 3 names, interleaved by cluster).
// Regenerate with: python3 data/scripts/compute_cold_start.py
const COLD_START_DECK: Record<'F' | 'M' | 'U', string[]> = {
  F: ['Ailany','Josephine','Harper','Charlotte','Emma','Hazel','Sophia','Eleanor','Kennedy','Olivia','Leilani','Jade','Lily','Abigail','Amelia','Lainey','Isabella','Elizabeth','Rose','Evelyn','Ayla','Juniper','Nora','Adeline','Mia','Avery','Eliana','Penelope','Melanie','Violet'],
  M: ['Mateo','Oliver','Elijah','Lucas','Liam','Alexander','Matthew','John','Ethan','Cooper','Santiago','Theodore','Elias','Luca','Noah','Jackson','Theo','Luke','Owen','Brooks','Anthony','Henry','Julian','Hudson','Levi','Maverick','Archer','Gael','Grayson','Colton'],
  U: ['Riley','Jordan','Taylor','Quinn','Parker','Morgan','Avery','Charlie','Logan','Harper','Blake','Finley','Rowan','Emerson','Elliot','Hayden','Peyton','Cameron','Reese','Drew','Jamie','Skylar','Dakota','Scout','Sage','Ryan','Dylan','Casey','Marlowe','Sutton'],
};

// ── Main recommendation function ──────────────────────────────────────────────
export async function getRecommendations(deviceId: string, params: Params) {
  const { sex, listId } = params;
  const ctx    = vSex(sex);
  const filter = sexClause(sex);
  const excl   = `AND nv.name NOT IN (SELECT name FROM user_swipes WHERE user_id = $1 AND sex_context = '${ctx}')`;
  const pool   = getPool();

  const popularityTiers = params.popularity ? params.popularity.split(',').map(s => s.trim()).filter(Boolean) : [];
  const popFilter = popularityClause(popularityTiers);

  const origins   = params.origins ? params.origins.split(',').map(s => s.trim()).filter(Boolean) : [];
  const originSet = await getOriginNames(origins);
  const originArr = originSet ? [...originSet] : null;
  const originSql = (nextIdx: number) => originArr ? ` AND nv.name = ANY($${nextIdx}::text[])` : '';

  const [tasteResult, partnerDeviceId] = await Promise.all([
    pool.query<{ embedding: string; liked_count: number }>(
      `SELECT embedding, liked_count FROM user_taste WHERE user_id = $1 AND sex_context = '${ctx}'`,
      [deviceId],
    ),
    listId ? getPartnerDeviceId(listId, deviceId) : Promise.resolve(null),
  ]);

  // Resolve primary taste vector (for reranker features) and ANN query vec
  let tasteVec: number[] | null = null;
  let queryVec: string | null   = null;

  if (tasteResult.rows.length > 0) {
    tasteVec = parseVec(tasteResult.rows[0].embedding as unknown as string);
    if (partnerDeviceId) {
      const partnerTaste = await pool.query<{ embedding: string }>(
        `SELECT embedding FROM user_taste WHERE user_id = $1 AND sex_context = '${ctx}'`,
        [partnerDeviceId],
      );
      queryVec = partnerTaste.rows.length > 0
        ? blendVecs(tasteVec, parseVec(partnerTaste.rows[0].embedding as unknown as string))
        : vecToStr(tasteVec);
    } else {
      queryVec = vecToStr(tasteVec);
    }
  }

  let names: string[];

  if (queryVec !== null && tasteVec !== null) {
    const likedCount = tasteResult.rows[0].liked_count ?? 0;

    const simWeight            = likedCount < 3 ? 0 : Math.min(1, (likedCount - 3) / 7);
    const actualSimilaritySize = Math.round(SIMILARITY_SIZE * simWeight);
    const extraSlots           = SIMILARITY_SIZE - actualSimilaritySize;
    const actualPopularSize    = POPULAR_SIZE     + Math.round(extraSlots * 0.5);
    const actualExplorationSize = EXPLORATION_SIZE + (extraSlots - Math.round(extraSlots * 0.5));

    // ── Determine query vectors (k-means multi-vector or single) ──────────────
    const k = likedCount >= CLUSTER_K_HIGH_THRESHOLD ? 3
            : likedCount >= CLUSTER_MIN_LIKES         ? 2
            : 1;

    let annQueryVecs: string[];

    if (k > 1) {
      const likedVecResult = await pool.query<{ embedding: string }>(
        `SELECT nv.embedding
         FROM user_swipes us JOIN name_vectors nv ON us.name = nv.name
         WHERE us.user_id = $1 AND us.liked = true AND us.sex_context = '${ctx}'`,
        [deviceId],
      );
      const likedVecs = likedVecResult.rows.map(r => parseVec(r.embedding as unknown as string));
      if (likedVecs.length >= k) {
        // Use the closest actual liked name to each centroid rather than the centroid
        // itself — averaging destroys style signal (e.g. Stella's vintage cluster
        // collapses into generic popular names when blended with Luna/Nova).
        const centroids = kmeanspp(likedVecs, k);
        annQueryVecs = centroids.map(centroid => {
          let best = likedVecs[0];
          let bestDist = sqDist(likedVecs[0], centroid);
          for (const v of likedVecs) {
            const d = sqDist(v, centroid);
            if (d < bestDist) { bestDist = d; best = v; }
          }
          return vecToStr(best);
        });
      } else {
        annQueryVecs = [queryVec];
      }
    } else {
      annQueryVecs = [queryVec];
    }

    const tQueries = Date.now();

    // ── ANN retrieval: K=100 per centroid, plus exploration and popular ───────
    const annQueries = annQueryVecs.map(qv =>
      actualSimilaritySize > 0
        ? pool.query<{ name: string; embedding: string }>(
            `SELECT nv.name, nv.embedding
             FROM   name_vectors nv
             JOIN   ${NP_AGG} ON np.name = nv.name
             WHERE  1=1 ${excl} ${filter} ${popFilter}${originSql(3)}
             ORDER  BY nv.embedding <=> $2::vector
             LIMIT  $3`,
            originArr ? [deviceId, qv, RETRIEVAL_K, originArr] : [deviceId, qv, RETRIEVAL_K],
          )
        : Promise.resolve({ rows: [] as { name: string; embedding: string }[] }),
    );

    const [explorationResult, popularResult, ...annResults] = await Promise.all([
      pool.query<{ name: string }>(
        `SELECT nv.name
         FROM   name_vectors nv
         JOIN   ${NP_AGG} ON np.name = nv.name
         WHERE  1=1 ${excl} ${filter} ${popFilter}
         AND    np.count >= $3
         AND    np.count < $4${originSql(6)}
         ORDER  BY nv.embedding <=> $2::vector
         LIMIT  $5`,
        originArr
          ? [deviceId, queryVec, EXPLORATION_MIN_COUNT, EXPLORATION_MAX_COUNT, actualExplorationSize, originArr]
          : [deviceId, queryVec, EXPLORATION_MIN_COUNT, EXPLORATION_MAX_COUNT, actualExplorationSize],
      ),
      pool.query<{ name: string }>(
        `SELECT nv.name
         FROM   name_vectors nv
         JOIN   ${NP_AGG} ON np.name = nv.name
         WHERE  1=1 ${excl} ${filter} ${popFilter}${originSql(3)}
         ORDER  BY np.count DESC
         LIMIT  $2`,
        originArr ? [deviceId, POPULAR_POOL, originArr] : [deviceId, POPULAR_POOL],
      ),
      ...annQueries,
    ]);

    console.log(JSON.stringify({
      event: 'rec_queries', duration_ms: Date.now() - tQueries,
      liked_count: likedCount, k, blend: BLEND,
      partner_blended: !!partnerDeviceId,
      counts: {
        ann_per_centroid: annResults.map(r => r.rows.length),
        exploration: explorationResult.rows.length,
        popular: popularResult.rows.length,
      },
    }));

    // ── Round-robin interleave ANN results from all centroids ─────────────────
    const annPool: Array<{ name: string; vec: number[] }> = [];
    const annSeen = new Set<string>();
    const maxLen  = Math.max(...annResults.map(r => r.rows.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const result of annResults) {
        if (i < result.rows.length) {
          const row = result.rows[i];
          if (!annSeen.has(row.name)) {
            annSeen.add(row.name);
            annPool.push({ name: row.name, vec: parseVec(row.embedding as unknown as string) });
          }
        }
      }
    }

    // ── Rerank ANN pool with GBC (blended with cosine rank position) ──────────
    const reranked = rerankPool(annPool, tasteVec);
    const similarityNames = reranked.slice(0, actualSimilaritySize);
    const seen = new Set(similarityNames);

    // ── Exploration bucket (unchanged) ────────────────────────────────────────
    const explorationNames = explorationResult.rows
      .map((r: { name: string }) => r.name)
      .filter((n: string) => !seen.has(n));
    explorationNames.forEach((n: string) => seen.add(n));

    // ── Popular bucket: random shuffle for variety ────────────────────────────
    const popularPool = popularResult.rows
      .map((r: { name: string }) => r.name)
      .filter((n: string) => !seen.has(n));
    for (let i = popularPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [popularPool[i], popularPool[j]] = [popularPool[j], popularPool[i]];
    }
    const popularNames = popularPool.slice(0, actualPopularSize);

    // ── Merge and light shuffle ───────────────────────────────────────────────
    const merged = [...similarityNames, ...explorationNames, ...popularNames];
    for (let i = merged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [merged[i], merged[j]] = [merged[j], merged[i]];
    }
    names = merged;

  } else {
    // ── Cold start ─────────────────────────────────────────────────────────────
    const deck = COLD_START_DECK[ctx];
    const swipedResult = await pool.query<{ name: string }>(
      `SELECT name FROM user_swipes WHERE user_id = $1 AND sex_context = '${ctx}'`,
      [deviceId],
    );
    const swiped = new Set(swipedResult.rows.map((r: { name: string }) => r.name));
    names = popularityTiers.length === 0
      ? deck.filter(n => !swiped.has(n) && (!originSet || originSet.has(n)))
            .slice(0, SIMILARITY_SIZE + EXPLORATION_SIZE + POPULAR_SIZE)
      : [];

    if (names.length === 0) {
      const { rows } = await pool.query<{ name: string }>(
        `SELECT nv.name FROM name_vectors nv
         JOIN ${NP_AGG} ON np.name = nv.name
         WHERE 1=1 ${excl} ${filter} ${popFilter}${originSql(3)}
         ORDER BY np.count DESC LIMIT $2`,
        originArr ? [deviceId, COLD_START_LIMIT, originArr] : [deviceId, COLD_START_LIMIT],
      );
      names = rows.slice(0, SIMILARITY_SIZE + EXPLORATION_SIZE + POPULAR_SIZE)
                  .map((r: { name: string }) => r.name);
    }
  }

  const uniqueNames = [...new Set(names)];
  return ok({ names: await enrichNames(uniqueNames, sex) });
}

// ── Swipe recording (unchanged) ───────────────────────────────────────────────
export async function getUserSwipes(deviceId: string, liked: boolean, sex?: string) {
  const pool = getPool();
  const ctx  = sex && ['F', 'M', 'U'].includes(sex) ? sex : null;
  const { rows } = await pool.query<{ name: string }>(
    ctx
      ? `SELECT name FROM user_swipes WHERE user_id = $1 AND liked = $2 AND sex_context = $3 ORDER BY swiped_at DESC`
      : `SELECT name FROM user_swipes WHERE user_id = $1 AND liked = $2 ORDER BY swiped_at DESC`,
    ctx ? [deviceId, liked, ctx] : [deviceId, liked],
  );
  return ok({ names: rows.map((r: { name: string }) => r.name) });
}

export async function recordSwipe(deviceId: string, body: Record<string, unknown>) {
  const name        = body.name as string | undefined;
  const liked       = body.liked;
  const sex_context = vSex(body.sex_context as string | undefined);

  if (!name || typeof liked !== 'boolean') return err(400, 'name and liked (boolean) are required');

  const pool = getPool();
  await ensureSchema(pool);

  const vectorResult = await pool.query<{ embedding: string }>(
    'SELECT embedding FROM name_vectors WHERE name = $1',
    [name],
  );
  if (vectorResult.rows.length === 0) return err(404, `name not found: ${name}`);

  const nameVec = parseVec(vectorResult.rows[0].embedding as unknown as string);
  const weight  = liked ? 1.0 : -0.5;

  await pool.query(
    `INSERT INTO user_swipes (user_id, name, liked, sex_context)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, name, sex_context) DO UPDATE SET liked = EXCLUDED.liked, swiped_at = NOW()`,
    [deviceId, name, liked, sex_context],
  );

  const tasteRow = await pool.query<{ embedding: string; liked_count: number; disliked_count: number }>(
    'SELECT embedding, liked_count, disliked_count FROM user_taste WHERE user_id = $1 AND sex_context = $2',
    [deviceId, sex_context],
  );

  let newVec: number[];
  let newLiked: number;
  let newDisliked: number;

  if (tasteRow.rows.length === 0) {
    newVec = nameVec.map(v => v * weight);
    newLiked    = liked ? 1 : 0;
    newDisliked = liked ? 0 : 1;
  } else {
    const row    = tasteRow.rows[0];
    const curVec = parseVec(row.embedding as unknown as string);
    const total  = row.liked_count + row.disliked_count;
    newVec      = curVec.map((v, i) => (v * total + nameVec[i] * weight) / (total + 1));
    newLiked    = row.liked_count    + (liked ? 1 : 0);
    newDisliked = row.disliked_count + (liked ? 0 : 1);
  }

  await pool.query(
    `INSERT INTO user_taste (user_id, sex_context, embedding, liked_count, disliked_count, updated_at)
     VALUES ($1, $2, $3::vector, $4, $5, NOW())
     ON CONFLICT (user_id, sex_context) DO UPDATE SET
       embedding      = EXCLUDED.embedding,
       liked_count    = EXCLUDED.liked_count,
       disliked_count = EXCLUDED.disliked_count,
       updated_at     = NOW()`,
    [deviceId, sex_context, vecToStr(newVec), newLiked, newDisliked],
  );

  return ok({ ok: true });
}
