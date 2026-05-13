import { getPool } from '../db/postgres';
import { ok, err } from '../utils';

type Params = Record<string, string | undefined>;

const UNISEX_MIN = 0.05;
const UNISEX_MAX = 0.95;
const SEX_FILTER_F = 0.10;
const SEX_FILTER_M = 0.90;
const BATCH_SIZE = 20;
const COLD_START_LIMIT = 100; // fetch more for cold start popularity sort

function sexClause(sex: string | undefined): string {
  if (sex === 'F') return `AND nv.female_pct >= ${SEX_FILTER_F}`;
  if (sex === 'M') return `AND nv.female_pct <= ${SEX_FILTER_M}`;
  if (sex === 'U') return `AND nv.female_pct > ${UNISEX_MIN} AND nv.female_pct < ${UNISEX_MAX}`;
  return '';
}

export async function getRecommendations(userId: string, params: Params) {
  const { sex } = params;
  const filter = sexClause(sex);
  const pool = getPool();

  const tasteResult = await pool.query<{ embedding: string }>(
    'SELECT embedding FROM user_taste WHERE user_id = $1',
    [userId],
  );

  let names: string[];

  if (tasteResult.rows.length > 0) {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT nv.name
       FROM   name_vectors nv
       WHERE  nv.name NOT IN (SELECT name FROM user_swipes WHERE user_id = $1)
       ${filter}
       ORDER  BY nv.embedding <=> (SELECT embedding FROM user_taste WHERE user_id = $1)
       LIMIT  $2`,
      [userId, BATCH_SIZE],
    );
    names = rows.map(r => r.name);
  } else {
    // Cold start: return most popular unswiped names
    const { rows } = await pool.query<{ name: string }>(
      `SELECT nv.name
       FROM   name_vectors nv
       JOIN   name_popularity np ON np.name = nv.name AND np.year = 2025
       WHERE  nv.name NOT IN (SELECT name FROM user_swipes WHERE user_id = $1)
       ${filter}
       ORDER  BY np.count DESC
       LIMIT  $2`,
      [userId, COLD_START_LIMIT],
    );
    // Trim to batch size after popularity sort
    names = rows.slice(0, BATCH_SIZE).map(r => r.name);
  }

  return ok({ names });
}

export async function recordSwipe(userId: string, body: Record<string, unknown>) {
  const name = body.name as string | undefined;
  const liked = body.liked;

  if (!name || typeof liked !== 'boolean') {
    return err(400, 'name and liked (boolean) are required');
  }

  const pool = getPool();

  // Fetch the name's embedding
  const vectorResult = await pool.query<{ embedding: string }>(
    'SELECT embedding FROM name_vectors WHERE name = $1',
    [name],
  );
  if (vectorResult.rows.length === 0) {
    return err(404, `name not found: ${name}`);
  }
  const nameEmbedding = vectorResult.rows[0].embedding;

  // Record the swipe
  await pool.query(
    `INSERT INTO user_swipes (user_id, name, liked)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, name) DO UPDATE SET liked = EXCLUDED.liked, swiped_at = NOW()`,
    [userId, name, liked],
  );

  // Update taste vector using running weighted average
  const weight = liked ? 1.0 : -0.5;
  await pool.query(
    `INSERT INTO user_taste (user_id, embedding, liked_count, disliked_count, updated_at)
     VALUES (
       $1,
       ($2::vector * $3),
       $4,
       $5,
       NOW()
     )
     ON CONFLICT (user_id) DO UPDATE SET
       embedding      = (
         (user_taste.embedding * (user_taste.liked_count + user_taste.disliked_count)::float
           + $2::vector * $3)
         / (user_taste.liked_count + user_taste.disliked_count + 1)::float
       ),
       liked_count    = user_taste.liked_count    + $4,
       disliked_count = user_taste.disliked_count + $5,
       updated_at     = NOW()`,
    [
      userId,
      nameEmbedding,
      weight,
      liked ? 1 : 0,
      liked ? 0 : 1,
    ],
  );

  return ok({ ok: true });
}
