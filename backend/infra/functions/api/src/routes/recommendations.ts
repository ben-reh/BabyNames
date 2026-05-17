import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE, ORIGIN_INDEX } from '../db/dynamo';
import { getPool } from '../db/postgres';
import { ok, err } from '../utils';
import { formatName } from './names';

type Params = Record<string, string | undefined>;

const UNISEX_MIN = 0.05;
const UNISEX_MAX = 0.95;
const SEX_FILTER_F = 0.05;
const SEX_FILTER_M = 0.95;
const SIMILARITY_POOL = 60;
const SIMILARITY_SIZE = 10;
const POPULAR_SIZE = 5;
const EXPLORATION_SIZE = 5;
const EXPLORATION_MIN_COUNT = 25;
const EXPLORATION_MAX_COUNT = 499;
const POPULAR_POOL = 150;
const COLD_START_LIMIT = 100;

// Pre-computed diverse cold-start deck (k=10 clusters × 3 names, interleaved by cluster).
// Regenerate with: python3 data/scripts/compute_cold_start.py
const COLD_START_DECK: Record<'F' | 'M' | 'U', string[]> = {
  F: ['Ailany','Josephine','Harper','Charlotte','Emma','Hazel','Sophia','Eleanor','Kennedy','Olivia','Leilani','Jade','Lily','Abigail','Amelia','Lainey','Isabella','Elizabeth','Rose','Evelyn','Ayla','Juniper','Nora','Adeline','Mia','Avery','Eliana','Penelope','Melanie','Violet'],
  M: ['Mateo','Oliver','Elijah','Lucas','Liam','Alexander','Matthew','John','Ethan','Cooper','Santiago','Theodore','Elias','Luca','Noah','Jackson','Theo','Luke','Owen','Brooks','Anthony','Henry','Julian','Hudson','Levi','Maverick','Archer','Gael','Grayson','Colton'],
  U: ['Riley','Jordan','Taylor','Quinn','Parker','Morgan','Avery','Charlie','Logan','Harper','Blake','Finley','Rowan','Emerson','Elliot','Hayden','Peyton','Cameron','Reese','Drew','Jamie','Skylar','Dakota','Scout','Sage','Ryan','Dylan','Casey','Marlowe','Sutton'],
};

// Validate and normalise the sex param — always returns a safe literal
function vSex(sex: string | undefined): 'F' | 'M' | 'U' {
  return sex === 'F' || sex === 'M' || sex === 'U' ? sex : 'U';
}

// Fetch all names belonging to the requested origins from DynamoDB origin GSI.
// Returns null when no origins are requested (meaning: no filter).
async function getOriginNames(origins: string[]): Promise<Set<string> | null> {
  if (origins.length === 0) return null;
  const results = await Promise.all(
    origins.map((origin) =>
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

// Aggregated subquery: one row per name with total count and female_pct
// computed from 2025 popularity data.  Use as: JOIN (NP_AGG) np ON np.name = nv.name
// This eliminates duplicate rows that arise when a name has both M and F entries
// for the same year, and gives accurate female fractions for the sex filter.
const NP_AGG = `(
  SELECT name,
         SUM(count)                                                               AS count,
         SUM(CASE WHEN gender='F' THEN count ELSE 0 END)::float / NULLIF(SUM(count),0) AS female_pct
  FROM   name_popularity WHERE year = 2025 GROUP BY name
) np`;

// SQL fragment: filter by 2025 total count based on selected popularity tiers.
// Multiple tiers are OR-ed so e.g. ["familiar","unique"] excludes only "popular".
function popularityClause(tiers: string[]): string {
  if (tiers.length === 0 || tiers.length === 3) return '';
  const conditions: string[] = [];
  if (tiers.includes('popular'))  conditions.push('np.count >= 5000');
  if (tiers.includes('familiar')) conditions.push('(np.count >= 1500 AND np.count < 5000)');
  if (tiers.includes('unique'))   conditions.push('np.count < 1500');
  return conditions.length ? `AND (${conditions.join(' OR ')})` : '';
}

// SQL fragment: filter by female_pct.  Requires the NP_AGG subquery to be joined
// as "np".  Falls back to nv.female_pct then 0.5 for names not in 2025 data.
function sexClause(sex: string | undefined): string {
  const pct = `COALESCE(np.female_pct, nv.female_pct, 0.5)`;
  if (sex === 'F') return `AND ${pct} >= ${SEX_FILTER_F}`;
  if (sex === 'M') return `AND ${pct} <= ${SEX_FILTER_M}`;
  if (sex === 'U') return `AND ${pct} > ${UNISEX_MIN} AND ${pct} < ${UNISEX_MAX}`;
  return '';
}

// Schema migration — runs once per Lambda cold start, idempotent
let schemaMigrated = false;
async function ensureSchema(pool: ReturnType<typeof getPool>) {
  if (schemaMigrated) return;
  // Run each migration step independently — a previously-applied step must not block later ones
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

  // Ensure embedding is vector(564) — if wrong dimension, wipe stale taste data and retype
  await pool.query(`DO $$
    DECLARE col_type text;
    BEGIN
      SELECT pg_catalog.format_type(atttypid, atttypmod) INTO col_type
      FROM pg_attribute
      WHERE attrelid = 'user_taste'::regclass AND attname = 'embedding' AND NOT attisdropped;
      IF col_type IS DISTINCT FROM 'vector(564)' THEN
        TRUNCATE user_taste;
        EXECUTE 'ALTER TABLE user_taste ALTER COLUMN embedding TYPE vector(564)';
      END IF;
    END $$`);

  schemaMigrated = true;
}

async function enrichNames(names: string[], rankSex?: string) {
  if (names.length === 0) return [];
  const pool = getPool();
  const [batchResult, rankResult] = await Promise.all([
    ddb.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: names.map((n) => ({ name: n })) } } })),
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
    .map((n) => {
      const item = itemMap.get(n);
      if (!item) return null;
      const primarySex = item.sex as string;
      const lookupSex = rankSex ?? primarySex;
      const formatted = formatName(item);
      return {
        ...formatted,
        female_pct: femalePctMap.has(n) ? femalePctMap.get(n)! : formatted.female_pct,
        rank_2025: rank2025Map.get(`${n}-${lookupSex}`) ?? rank2025Map.get(`${n}-${primarySex}`) ?? null,
      };
    })
    .filter(Boolean);
}

export async function getRecommendations(deviceId: string, params: Params) {
  const { sex } = params;
  const ctx = vSex(sex);
  const filter = sexClause(sex);
  const excl = `AND nv.name NOT IN (SELECT name FROM user_swipes WHERE user_id = $1 AND sex_context = '${ctx}')`;
  const pool = getPool();

  const popularityTiers = params.popularity ? params.popularity.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const popFilter = popularityClause(popularityTiers);

  const origins = params.origins ? params.origins.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const originSet = await getOriginNames(origins);
  // When origins are requested, add a parameter to restrict to those names.
  // Each query appends originNames as its last $N parameter.
  const originArr = originSet ? [...originSet] : null;
  const originSql = (nextIdx: number) => originArr ? ` AND nv.name = ANY($${nextIdx}::text[])` : '';

  const tasteResult = await pool.query<{ embedding: string; liked_count: number }>(
    `SELECT embedding, liked_count FROM user_taste WHERE user_id = $1 AND sex_context = '${ctx}'`,
    [deviceId],
  );

  let names: string[];

  if (tasteResult.rows.length > 0) {
    const likedCount = tasteResult.rows[0].liked_count ?? 0;

    const simWeight = likedCount < 3 ? 0 : Math.min(1, (likedCount - 3) / 7);
    const actualSimilaritySize = Math.round(SIMILARITY_SIZE * simWeight);
    const extraSlots = SIMILARITY_SIZE - actualSimilaritySize;
    const actualPopularSize = POPULAR_SIZE + Math.round(extraSlots * 0.5);
    const actualExplorationSize = EXPLORATION_SIZE + (extraSlots - Math.round(extraSlots * 0.5));

    const tQueries = Date.now();
    const [similarityResult, explorationResult, popularResult] = await Promise.all([
      actualSimilaritySize > 0
        ? pool.query<{ name: string }>(
            `SELECT nv.name
             FROM   name_vectors nv
             JOIN   ${NP_AGG} ON np.name = nv.name
             WHERE  1=1 ${excl} ${filter} ${popFilter}${originSql(3)}
             ORDER  BY nv.embedding <=> (SELECT embedding FROM user_taste WHERE user_id = $1 AND sex_context = '${ctx}')
             LIMIT  $2`,
            originArr ? [deviceId, SIMILARITY_POOL, originArr] : [deviceId, SIMILARITY_POOL],
          )
        : Promise.resolve({ rows: [] }),
      pool.query<{ name: string }>(
        `SELECT nv.name
         FROM   name_vectors nv
         JOIN   ${NP_AGG} ON np.name = nv.name
         WHERE  1=1 ${excl} ${filter} ${popFilter}
         AND    np.count >= $2
         AND    np.count < $3${originSql(5)}
         ORDER  BY nv.embedding <=> (SELECT embedding FROM user_taste WHERE user_id = $1 AND sex_context = '${ctx}')
         LIMIT  $4`,
        originArr ? [deviceId, EXPLORATION_MIN_COUNT, EXPLORATION_MAX_COUNT, actualExplorationSize, originArr] : [deviceId, EXPLORATION_MIN_COUNT, EXPLORATION_MAX_COUNT, actualExplorationSize],
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
    ]);

    console.log(JSON.stringify({ event: 'rec_queries', duration_ms: Date.now() - tQueries, liked_count: likedCount, sim_weight: simWeight, counts: { similarity: similarityResult.rows.length, exploration: explorationResult.rows.length, popular: popularResult.rows.length } }));

    const pool60 = similarityResult.rows.map((r: { name: string }) => r.name);
    for (let i = pool60.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool60[i], pool60[j]] = [pool60[j], pool60[i]];
    }
    const similarityNames = pool60.slice(0, actualSimilaritySize);
    const seen = new Set(similarityNames);

    const explorationNames = explorationResult.rows
      .map((r: { name: string }) => r.name)
      .filter((n: string) => !seen.has(n));
    explorationNames.forEach((n: string) => seen.add(n));

    const popularPool = popularResult.rows.map((r: { name: string }) => r.name).filter((n: string) => !seen.has(n));
    for (let i = popularPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [popularPool[i], popularPool[j]] = [popularPool[j], popularPool[i]];
    }
    const popularNames = popularPool.slice(0, actualPopularSize);

    const merged = [...similarityNames, ...explorationNames, ...popularNames];
    for (let i = merged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [merged[i], merged[j]] = [merged[j], merged[i]];
    }
    names = merged;
  } else {
    // Cold start: per-context deck, excluding names already swiped in this context
    const deck = COLD_START_DECK[ctx];

    const swipedResult = await pool.query<{ name: string }>(
      `SELECT name FROM user_swipes WHERE user_id = $1 AND sex_context = '${ctx}'`,
      [deviceId],
    );
    const swiped = new Set(swipedResult.rows.map((r: { name: string }) => r.name));
    // Skip the in-memory deck when a popularity filter is active — deck names are
    // all popular, so they would incorrectly survive a "unique" filter.
    names = popularityTiers.length === 0
      ? deck.filter((n) => !swiped.has(n) && (!originSet || originSet.has(n)))
            .slice(0, SIMILARITY_SIZE + EXPLORATION_SIZE + POPULAR_SIZE)
      : [];

    if (names.length === 0) {
      const { rows } = await pool.query<{ name: string }>(
        `SELECT nv.name FROM name_vectors nv
         JOIN ${NP_AGG} ON np.name = nv.name
         WHERE 1=1 ${excl} ${filter} ${popFilter}${originSql(3)} ORDER BY np.count DESC LIMIT $2`,
        originArr ? [deviceId, COLD_START_LIMIT, originArr] : [deviceId, COLD_START_LIMIT],
      );
      names = rows.slice(0, SIMILARITY_SIZE + EXPLORATION_SIZE + POPULAR_SIZE).map((r: { name: string }) => r.name);
    }
  }

  // Deduplicate before enrichNames — DynamoDB BatchGet rejects duplicate keys.
  const uniqueNames = [...new Set(names)];
  return ok({ names: await enrichNames(uniqueNames, sex) });
}

export async function getUserSwipes(deviceId: string, liked: boolean, sex?: string) {
  const pool = getPool();
  const ctx = sex && ['F', 'M', 'U'].includes(sex) ? sex : null;
  const { rows } = await pool.query<{ name: string }>(
    ctx
      ? `SELECT name FROM user_swipes WHERE user_id = $1 AND liked = $2 AND sex_context = $3 ORDER BY swiped_at DESC`
      : `SELECT name FROM user_swipes WHERE user_id = $1 AND liked = $2 ORDER BY swiped_at DESC`,
    ctx ? [deviceId, liked, ctx] : [deviceId, liked],
  );
  return ok({ names: rows.map((r: { name: string }) => r.name) });
}

export async function recordSwipe(deviceId: string, body: Record<string, unknown>) {
  const name = body.name as string | undefined;
  const liked = body.liked;
  const sex_context = vSex(body.sex_context as string | undefined);

  if (!name || typeof liked !== 'boolean') {
    return err(400, 'name and liked (boolean) are required');
  }

  const pool = getPool();
  await ensureSchema(pool);

  const vectorResult = await pool.query<{ embedding: string }>(
    'SELECT embedding FROM name_vectors WHERE name = $1',
    [name],
  );
  if (vectorResult.rows.length === 0) {
    return err(404, `name not found: ${name}`);
  }
  // Parse pgvector string "[0.1,0.2,...]" → number[]
  const nameVec: number[] = (vectorResult.rows[0].embedding as unknown as string)
    .slice(1, -1).split(',').map(Number);

  // Per-context swipe record — same name can be swiped in multiple sex contexts
  await pool.query(
    `INSERT INTO user_swipes (user_id, name, liked, sex_context)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, name, sex_context) DO UPDATE SET liked = EXCLUDED.liked, swiped_at = NOW()`,
    [deviceId, name, liked, sex_context],
  );

  // Compute updated taste vector in JS — pgvector doesn't support vector * scalar
  const weight = liked ? 1.0 : -0.5;

  const tasteRow = await pool.query<{ embedding: string; liked_count: number; disliked_count: number }>(
    'SELECT embedding, liked_count, disliked_count FROM user_taste WHERE user_id = $1 AND sex_context = $2',
    [deviceId, sex_context],
  );

  let newVec: number[];
  let newLiked: number;
  let newDisliked: number;

  if (tasteRow.rows.length === 0) {
    newVec = nameVec.map((v) => v * weight);
    newLiked = liked ? 1 : 0;
    newDisliked = liked ? 0 : 1;
  } else {
    const row = tasteRow.rows[0];
    const curVec: number[] = (row.embedding as unknown as string).slice(1, -1).split(',').map(Number);
    const total = row.liked_count + row.disliked_count;
    newVec = curVec.map((v, i) => (v * total + nameVec[i] * weight) / (total + 1));
    newLiked = row.liked_count + (liked ? 1 : 0);
    newDisliked = row.disliked_count + (liked ? 0 : 1);
  }

  const embeddingStr = `[${newVec.join(',')}]`;

  await pool.query(
    `INSERT INTO user_taste (user_id, sex_context, embedding, liked_count, disliked_count, updated_at)
     VALUES ($1, $2, $3::vector, $4, $5, NOW())
     ON CONFLICT (user_id, sex_context) DO UPDATE SET
       embedding      = EXCLUDED.embedding,
       liked_count    = EXCLUDED.liked_count,
       disliked_count = EXCLUDED.disliked_count,
       updated_at     = NOW()`,
    [deviceId, sex_context, embeddingStr, newLiked, newDisliked],
  );

  return ok({ ok: true });
}
