import { getPool } from '../../db/postgres';
import { ok, err } from '../../utils';

export async function recordConsultantFeedback(body: Record<string, unknown>) {
  const deviceId = body.deviceId as string | undefined;
  const likes = (body.likes as string[] | undefined) ?? [];
  const passes = (body.passes as string[] | undefined) ?? [];
  const sex = body.sex as string | undefined;
  const sexCtx = (sex === 'F' || sex === 'M' || sex === 'U') ? sex : 'U';

  if (!deviceId) return err(400, 'deviceId is required');
  if (!Array.isArray(likes) || !Array.isArray(passes)) {
    return err(400, 'likes and passes must be arrays');
  }

  const allNames = [...new Set([...likes, ...passes])];
  if (allNames.length === 0) return ok({ ok: true });

  const pool = getPool();

  // Fetch all name vectors at once
  const { rows: vecRows } = await pool.query<{ name: string; embedding: string }>(
    'SELECT name, embedding FROM name_vectors WHERE name = ANY($1::text[])',
    [allNames],
  );
  const nameVecMap = new Map(vecRows.map((r) => [r.name, r.embedding as unknown as string]));

  const swipeList = [
    ...likes.filter((n) => nameVecMap.has(n)).map((n) => ({ name: n, liked: true })),
    ...passes.filter((n) => nameVecMap.has(n)).map((n) => ({ name: n, liked: false })),
  ];

  if (swipeList.length === 0) return ok({ ok: true });

  // Bulk upsert all swipe records
  const swipePlaceholders = swipeList
    .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
    .join(', ');
  await pool.query(
    `INSERT INTO user_swipes (user_id, name, liked, sex_context)
     VALUES ${swipePlaceholders}
     ON CONFLICT (user_id, name, sex_context)
     DO UPDATE SET liked = EXCLUDED.liked, swiped_at = NOW()`,
    swipeList.flatMap((s) => [deviceId, s.name, s.liked, sexCtx]),
  );

  // Read current taste vector and apply all swipes in a single pass
  const { rows: tasteRows } = await pool.query<{
    embedding: string;
    liked_count: number;
    disliked_count: number;
  }>(
    'SELECT embedding, liked_count, disliked_count FROM user_taste WHERE user_id = $1 AND sex_context = $2',
    [deviceId, sexCtx],
  );

  let curVec: number[] | null = tasteRows[0]
    ? tasteRows[0].embedding.slice(1, -1).split(',').map(Number)
    : null;
  let likedCount = tasteRows[0]?.liked_count ?? 0;
  let dislikedCount = tasteRows[0]?.disliked_count ?? 0;

  for (const { name, liked } of swipeList) {
    const rawVec = nameVecMap.get(name);
    if (!rawVec) continue;
    const nameVec = rawVec.slice(1, -1).split(',').map(Number);
    const weight = liked ? 1.0 : -0.5;
    if (curVec === null) {
      curVec = nameVec.map((v) => v * weight);
    } else {
      const total = likedCount + dislikedCount;
      curVec = curVec.map((v, i) => (v * total + nameVec[i] * weight) / (total + 1));
    }
    if (liked) likedCount++;
    else dislikedCount++;
  }

  if (curVec === null) return ok({ ok: true });

  await pool.query(
    `INSERT INTO user_taste (user_id, sex_context, embedding, liked_count, disliked_count, updated_at)
     VALUES ($1, $2, $3::vector, $4, $5, NOW())
     ON CONFLICT (user_id, sex_context) DO UPDATE SET
       embedding      = EXCLUDED.embedding,
       liked_count    = EXCLUDED.liked_count,
       disliked_count = EXCLUDED.disliked_count,
       updated_at     = NOW()`,
    [deviceId, sexCtx, `[${curVec.join(',')}]`, likedCount, dislikedCount],
  );

  return ok({ ok: true });
}
