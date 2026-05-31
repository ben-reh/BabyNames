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
const ANN_FETCH_K  = 400;  // raw cosine candidates fetched per centroid
const RETRIEVAL_K  = 100;  // candidates passed to reranker after pop-prior blend
const POP_PRIOR_ALPHA = 0.40;  // blend weight for log-popularity (0 = pure cosine)
const SIM_SIZE          = 15;   // similarity bucket (absorbs old popular bucket)
const EXPLORE_SIZE      = 5;    // anti-centroid exploration bucket
const LOG_SAMPLE_SIZE   = 20;   // phase 0: log-weighted random sample
const EXPLORE_MIN_COUNT = 200;  // min pop count for exploration candidates

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

// Minimum absolute births/yr required to count as genuinely given to that sex.
// Prevents names like "Dan" (9 girls/yr) from appearing in girls recs while
// keeping unisex names like Dylan (337 girls/yr) and Carter (679 girls/yr).
const SEX_COUNT_MIN = 100;

function sexClause(sex: string | undefined): string {
  const pct = `COALESCE(np.female_pct, nv.female_pct, 0.5)`;
  if (sex === 'F') return `AND ${pct} >= ${SEX_FILTER_F} AND np.female_count >= ${SEX_COUNT_MIN}`;
  if (sex === 'M') return `AND ${pct} <= ${SEX_FILTER_M} AND (np.count - np.female_count) >= ${SEX_COUNT_MIN}`;
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
         SUM(CASE WHEN gender='F' THEN count ELSE 0 END)                         AS female_count,
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

function blendVecsArr(a: number[], b: number[]): number[] {
  return a.map((v, i) => 0.5 * v + 0.5 * b[i]);
}

function blendVecs(a: number[], b: number[]): string {
  return vecToStr(blendVecsArr(a, b));
}

function makeAntiCentroid(vec: number[]): number[] {
  const anti = vec.slice();
  for (let i = HC_DIMS; i < HC_DIMS + EMBED_DIMS; i++) anti[i] = -vec[i];
  return anti;
}

// ── K-means++ ────────────────────────────────────────────────────────────────
// rng is exposed so callers (and tests) can seed it; defaults to Math.random.
export function kmeanspp(vectors: number[][], k: number, maxIter = 20, rng: () => number = Math.random): number[][] {
  const n = vectors.length;
  if (n <= k) return vectors.slice();
  const dim = vectors[0].length;

  // k-means++ seeding
  const centroids: number[][] = [vectors[Math.floor(rng() * n)]];
  for (let c = 1; c < k; c++) {
    const dists = vectors.map(v => Math.min(...centroids.map(cen => sqDist(v, cen))));
    const total = dists.reduce((a, b) => a + b, 0);
    let r = rng() * total;
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

// Given the user's liked-name vectors, return k query vectors for ANN retrieval:
//   - run k-means++, take the cluster centroids
//   - replace each centroid with the actual liked vector closest to it (style preservation)
//   - 50/50-blend with partner taste if pairing is active
// If there aren't enough liked vectors, returns an empty array (caller falls back).
export function pickCentroidQueries(
  likedVecs: number[][],
  k: number,
  partnerTasteVec: number[] | null,
  rng: () => number = Math.random,
): number[][] {
  if (likedVecs.length < k) return [];
  const centroids = kmeanspp(likedVecs, k, 20, rng);
  return centroids.map(centroid => {
    let best = likedVecs[0];
    let bestDist = sqDist(likedVecs[0], centroid);
    for (const v of likedVecs) {
      const d = sqDist(v, centroid);
      if (d < bestDist) { bestDist = d; best = v; }
    }
    return partnerTasteVec ? blendVecsArr(best, partnerTasteVec) : best;
  });
}

// In-place bounded-window shuffle. Each position swaps with a random j in
// [i-window, i+window]. Adds local variety without globally scrambling the
// ranking (note: chained forward swaps can drift items beyond ±window).
// window=0 leaves the array unchanged.
export function boundedShuffle<T>(arr: T[], window: number, rng: () => number = Math.random): T[] {
  if (window <= 0 || arr.length <= 1) return arr;
  for (let i = 0; i < arr.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(arr.length - 1, i + window);
    const j  = lo + Math.floor(rng() * (hi - lo + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
// Returns names sorted best-first: blend of GBC reranker score and an
// ANN-retrieval-rank prior (`rankScore`). `bestAnnRank` is the candidate's
// minimum rank across k-means centroids during retrieval — i.e. how strong a
// raw cosine match it was, before the pop-prior blend re-sorted the pool.
function rerankPool(
  pool: Array<{ name: string; vec: number[]; bestAnnRank: number }>,
  tasteVec: number[],
): string[] {
  if (pool.length === 0) return [];
  const tasteNorm    = l2norm(tasteVec);
  const tasteEmbNorm = l2norm(tasteVec.slice(HC_DIMS, HC_DIMS + EMBED_DIMS));

  const scored = pool.map(({ name, vec, bestAnnRank }) => {
    const candNorm    = l2norm(vec);
    const candEmbNorm = l2norm(vec.slice(HC_DIMS, HC_DIMS + EMBED_DIMS));
    const features    = rerankerFeatures(tasteVec, tasteNorm, tasteEmbNorm, vec, candNorm, candEmbNorm);
    const rScore      = rerankerScore(features);
    const rankScore   = 1 - bestAnnRank / ANN_FETCH_K; // 1.0 if first ANN result on any centroid, approaching 0
    return { name, score: BLEND * rankScore + (1 - BLEND) * rScore };
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
  // Only swallow PG idempotency codes; anything else is a real failure and must surface.
  //   42701 = duplicate_column, 42710 = duplicate_object (constraint/index), 42P07 = duplicate_table
  const run = async (sql: string) => {
    try { await pool.query(sql); }
    catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === '42701' || code === '42710' || code === '42P07') return;
      console.error(JSON.stringify({ event: 'migration_failed', sql, code, error: String(e) }));
      throw e;
    }
  };

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
  await run(`ALTER TABLE user_taste ADD COLUMN IF NOT EXISTS onboarding_count FLOAT NOT NULL DEFAULT 0`);
  await run(`ALTER TABLE user_taste ADD COLUMN IF NOT EXISTS preference_filters JSONB`);

  // Vector-dim guard. Previously this branch unconditionally TRUNCATEd user_taste on
  // any dim mismatch — one bad VECTOR_DIM constant on deploy would wipe every taste
  // vector with no warning. Require explicit opt-in via ALLOW_TASTE_TRUNCATE=true.
  const colTypeResult = await pool.query<{ col_type: string }>(`
    SELECT pg_catalog.format_type(atttypid, atttypmod) AS col_type
    FROM pg_attribute
    WHERE attrelid = 'user_taste'::regclass AND attname = 'embedding' AND NOT attisdropped
  `);
  const colType = colTypeResult.rows[0]?.col_type;
  if (colType && colType !== `vector(${VECTOR_DIM})`) {
    if (process.env.ALLOW_TASTE_TRUNCATE === 'true') {
      console.warn(JSON.stringify({
        event: 'taste_truncate', stored: colType, expected: `vector(${VECTOR_DIM})`,
      }));
      await pool.query('TRUNCATE user_taste');
      await pool.query(`ALTER TABLE user_taste ALTER COLUMN embedding TYPE vector(${VECTOR_DIM})`);
    } else {
      console.error(JSON.stringify({
        event: 'taste_dim_mismatch_blocked', stored: colType, expected: `vector(${VECTOR_DIM})`,
      }));
      throw new Error(
        `user_taste.embedding dimension mismatch (stored ${colType}, expected vector(${VECTOR_DIM})). ` +
        `Refusing to TRUNCATE. Set ALLOW_TASTE_TRUNCATE=true to wipe and rebuild.`,
      );
    }
  }

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

// ── Main recommendation function ──────────────────────────────────────────────
export async function getRecommendations(deviceId: string, params: Params) {
  const { sex, listId } = params;
  const ctx    = vSex(sex);
  const filter = sexClause(sex);
  const excl   = `AND nv.name NOT IN (SELECT name FROM user_swipes WHERE user_id = $1 AND sex_context = '${ctx}')`;
  const pool   = getPool();
  await ensureSchema(pool);

  const popularityTiers = params.popularity ? params.popularity.split(',').map(s => s.trim()).filter(Boolean) : [];
  const popFilter = popularityClause(popularityTiers);

  const [tasteResult, partnerDeviceId] = await Promise.all([
    pool.query<{ embedding: string; liked_count: number; preference_filters: unknown }>(
      `SELECT embedding, liked_count, preference_filters FROM user_taste WHERE user_id = $1 AND sex_context = '${ctx}'`,
      [deviceId],
    ),
    listId ? getPartnerDeviceId(listId, deviceId) : Promise.resolve(null),
  ]);

  // Hard constraints from onboarding preference_filters
  const prefFilters = (tasteResult.rows[0]?.preference_filters ?? null) as {
    exclude_top_n?: number;
    preferred_origins?: string[];
  } | null;
  const excludeTopNSql = prefFilters?.exclude_top_n ? `AND np.count < ${Number(prefFilters.exclude_top_n)}` : '';

  // Origins: request params override onboarding preferred_origins
  const origins = params.origins
    ? params.origins.split(',').map(s => s.trim()).filter(Boolean)
    : (prefFilters?.preferred_origins ?? []);
  const originSet = await getOriginNames(origins);
  const originArr = originSet ? [...originSet] : null;
  const originSql = (nextIdx: number) => originArr ? ` AND nv.name = ANY($${nextIdx}::text[])` : '';

  // Resolve taste vector and blended query vector (partner blended when pairing)
  let tasteVec: number[] | null        = null;  // user-only, used for reranker features
  let partnerTasteVec: number[] | null = null;  // partner-only, used to blend per-centroid query at k>1
  let blendedVec: number[] | null      = null;  // user+partner blend, used for single-vector ANN

  if (tasteResult.rows.length > 0) {
    tasteVec = parseVec(tasteResult.rows[0].embedding as unknown as string);
    if (partnerDeviceId) {
      const partnerTaste = await pool.query<{ embedding: string }>(
        `SELECT embedding FROM user_taste WHERE user_id = $1 AND sex_context = '${ctx}'`,
        [partnerDeviceId],
      );
      if (partnerTaste.rows.length > 0) {
        partnerTasteVec = parseVec(partnerTaste.rows[0].embedding as unknown as string);
        blendedVec      = blendVecsArr(tasteVec, partnerTasteVec);
      } else {
        blendedVec = tasteVec;
      }
    } else {
      blendedVec = tasteVec;
    }
  }

  const likedCount = tasteResult.rows.length > 0 ? (tasteResult.rows[0].liked_count ?? 0) : 0;
  const useANN     = blendedVec !== null && likedCount >= 3;

  let names: string[];

  if (!useANN) {
    // ── Phase 0: log-weighted random sample (0–2 real likes) ─────────────────
    const { rows } = await pool.query<{ name: string }>(
      `SELECT nv.name
       FROM   name_vectors nv
       JOIN   ${NP_AGG} ON np.name = nv.name
       WHERE  1=1 ${excl} ${filter} ${popFilter} ${excludeTopNSql}${originSql(2)}
       AND    np.count >= 200
       ORDER  BY LOG(np.count + 1) * (0.5 + RANDOM() * 0.5) DESC
       LIMIT  ${LOG_SAMPLE_SIZE}`,
      originArr ? [deviceId, originArr] : [deviceId],
    );
    names = rows.map(r => r.name);

  } else {
    // ── Phase 1+: ANN similarity + anti-centroid exploration ──────────────────
    const queryVec = vecToStr(blendedVec!);
    const antiVec  = vecToStr(makeAntiCentroid(blendedVec!));

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
      const likedVecs       = likedVecResult.rows.map(r => parseVec(r.embedding as unknown as string));
      const centroidQueries = pickCentroidQueries(likedVecs, k, partnerTasteVec);
      annQueryVecs = centroidQueries.length > 0 ? centroidQueries.map(vecToStr) : [queryVec];
    } else {
      annQueryVecs = [queryVec];
    }

    const tQueries = Date.now();

    // ── ANN retrieval (per centroid) + anti-centroid exploration in parallel ──
    const annQueries = annQueryVecs.map(qv =>
      pool.query<{ name: string; embedding: string; pop_count: string }>(
        `SELECT nv.name, nv.embedding, np.count AS pop_count
         FROM   name_vectors nv
         JOIN   ${NP_AGG} ON np.name = nv.name
         WHERE  1=1 ${excl} ${filter} ${popFilter} ${excludeTopNSql}${originSql(3)}
         ORDER  BY nv.embedding <=> $2::vector
         LIMIT  ${ANN_FETCH_K}`,
        originArr ? [deviceId, qv, originArr] : [deviceId, qv],
      )
    );

    const explorationQuery = pool.query<{ name: string }>(
      `SELECT nv.name
       FROM   name_vectors nv
       JOIN   ${NP_AGG} ON np.name = nv.name
       WHERE  1=1 ${excl} ${filter} ${popFilter} ${excludeTopNSql}${originSql(3)}
       AND    np.count >= ${EXPLORE_MIN_COUNT}
       ORDER  BY nv.embedding <=> $2::vector
       LIMIT  ${EXPLORE_SIZE}`,
      originArr ? [deviceId, antiVec, originArr] : [deviceId, antiVec],
    );

    const [explorationResult, ...annResults] = await Promise.all([explorationQuery, ...annQueries]);

    console.log(JSON.stringify({
      event: 'rec_queries', duration_ms: Date.now() - tQueries,
      liked_count: likedCount, k, blend: BLEND,
      partner_blended: !!partnerDeviceId,
      counts: {
        ann_per_centroid: annResults.map(r => r.rows.length),
        exploration: explorationResult.rows.length,
      },
    }));

    // ── Round-robin interleave ANN results from all centroids ─────────────────
    // Each name's bestAnnRank is its lowest per-centroid index across all centroids
    // it appeared in (i.e., its strongest raw retrieval signal). Because the loop
    // iterates i = 0..maxLen-1 and adds names on first appearance, that first-seen
    // index is necessarily the min rank for that name across the centroids it hit.
    const annRaw: Array<{ name: string; vec: number[]; popCount: number; bestAnnRank: number }> = [];
    const annSeen = new Set<string>();
    const maxLen  = Math.max(...annResults.map(r => r.rows.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const result of annResults) {
        if (i < result.rows.length) {
          const row = result.rows[i];
          if (!annSeen.has(row.name)) {
            annSeen.add(row.name);
            annRaw.push({
              name: row.name,
              vec: parseVec(row.embedding as unknown as string),
              popCount: Number(row.pop_count) || 0,
              bestAnnRank: i,
            });
          }
        }
      }
    }

    // ── Blend retrieval rank with log-popularity, trim to RETRIEVAL_K ────────
    const logMax = Math.log(Math.max(...annRaw.map(c => c.popCount), 1) + 1);
    const annPool = annRaw
      .map((c, i) => {
        const annScore = 1 - i / annRaw.length;
        const logScore = Math.log(c.popCount + 1) / logMax;
        return { ...c, blendScore: (1 - POP_PRIOR_ALPHA) * annScore + POP_PRIOR_ALPHA * logScore };
      })
      .sort((a, b) => b.blendScore - a.blendScore)
      .slice(0, RETRIEVAL_K);

    // ── Rerank similarity pool with GBC ───────────────────────────────────────
    const reranked = rerankPool(annPool, tasteVec!);
    const similarityNames = reranked.slice(0, SIM_SIZE);
    const seen = new Set(similarityNames);

    // ── Exploration: anti-centroid ANN (deduplicated against similarity) ──────
    const explorationNames = explorationResult.rows
      .map(r => r.name)
      .filter(n => !seen.has(n));

    // ── Merge and bounded-window shuffle ──────────────────────────────────────
    // Add local variety without burying the strongest reranked candidates.
    const SHUFFLE_WINDOW = 3;
    names = boundedShuffle([...similarityNames, ...explorationNames], SHUFFLE_WINDOW);
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

// Snapshot of the stored user_taste row, after parsing the embedding column.
export interface TasteSnapshot {
  embedding: number[];
  liked_count: number;
  disliked_count: number;
  onboarding_count: number;
}

export interface TasteUpdate {
  newVec: number[];
  newLiked: number;
  newDisliked: number;
}

// Pure: given the current taste state and the prior swipe direction for this
// name, return the updated taste vector and counts after applying `liked`.
//
//   current === null         → first-ever swipe; produces weight * nameVec.
//   priorLiked === null      → brand-new swipe for this name; add contribution.
//   priorLiked === liked     → same-direction re-swipe; no-op.
//   priorLiked !== liked     → flip; reverse prior contribution and add new one.
//
// Denominator on flip stays at `total` because we're replacing, not adding.
export function computeTasteUpdate(
  current: TasteSnapshot | null,
  priorLiked: boolean | null,
  nameVec: number[],
  liked: boolean,
): TasteUpdate {
  const newWeight = liked ? 1.0 : -0.5;

  if (current === null) {
    return {
      newVec: nameVec.map(v => v * newWeight),
      newLiked:    liked ? 1 : 0,
      newDisliked: liked ? 0 : 1,
    };
  }

  const { embedding: curVec, liked_count, disliked_count, onboarding_count } = current;
  const total = liked_count + disliked_count + (onboarding_count ?? 0);

  if (priorLiked === null) {
    return {
      newVec: curVec.map((v, i) => (v * total + nameVec[i] * newWeight) / (total + 1)),
      newLiked:    liked_count    + (liked ? 1 : 0),
      newDisliked: disliked_count + (liked ? 0 : 1),
    };
  }

  if (priorLiked === liked) {
    return { newVec: curVec, newLiked: liked_count, newDisliked: disliked_count };
  }

  const oldWeight = priorLiked ? 1.0 : -0.5;
  return {
    newVec: curVec.map((v, i) => (v * total - oldWeight * nameVec[i] + newWeight * nameVec[i]) / total),
    newLiked:    liked_count    + (liked ? 1 : 0) - (priorLiked ? 1 : 0),
    newDisliked: disliked_count + (liked ? 0 : 1) - (priorLiked ? 0 : 1),
  };
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

  // Read prior swipe (if any) and taste row in parallel before mutating either,
  // so a re-swipe can reverse the prior contribution instead of double-counting.
  const [priorSwipe, tasteRow] = await Promise.all([
    pool.query<{ liked: boolean }>(
      'SELECT liked FROM user_swipes WHERE user_id = $1 AND name = $2 AND sex_context = $3',
      [deviceId, name, sex_context],
    ),
    pool.query<{ embedding: string; liked_count: number; disliked_count: number; onboarding_count: number }>(
      'SELECT embedding, liked_count, disliked_count, onboarding_count FROM user_taste WHERE user_id = $1 AND sex_context = $2',
      [deviceId, sex_context],
    ),
  ]);

  await pool.query(
    `INSERT INTO user_swipes (user_id, name, liked, sex_context)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, name, sex_context) DO UPDATE SET liked = EXCLUDED.liked, swiped_at = NOW()`,
    [deviceId, name, liked, sex_context],
  );

  const priorLiked: boolean | null = priorSwipe.rows.length > 0 ? priorSwipe.rows[0].liked : null;
  const current: TasteSnapshot | null = tasteRow.rows.length === 0 ? null : {
    embedding:        parseVec(tasteRow.rows[0].embedding as unknown as string),
    liked_count:      tasteRow.rows[0].liked_count,
    disliked_count:   tasteRow.rows[0].disliked_count,
    onboarding_count: tasteRow.rows[0].onboarding_count ?? 0,
  };

  const { newVec, newLiked, newDisliked } = computeTasteUpdate(current, priorLiked, nameVec, liked);

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
