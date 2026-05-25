import { getPool } from '../db/postgres';
import { ok, err } from '../utils';

const VECTOR_DIM = 567;

function parseVec(pgvecStr: string): number[] {
  return pgvecStr.slice(1, -1).split(',').map(Number);
}

function vecToStr(v: number[]): string {
  return `[${v.join(',')}]`;
}

type OnboardingAction = { name: string; action: 'add' | 'vibe' | 'skip' };
type PreferenceFilters = { exclude_top_n?: number; preferred_origins?: string[] };

export async function processOnboarding(body: Record<string, unknown>) {
  const deviceId = body.deviceId as string | undefined;
  const sex      = body.sex      as string | undefined;
  const actions  = body.actions  as OnboardingAction[] | undefined;
  const filters  = body.filters  as PreferenceFilters  | undefined;

  if (!deviceId || !Array.isArray(actions)) {
    return err(400, 'deviceId and actions are required');
  }

  const ctx = sex === 'F' || sex === 'M' ? sex : 'U';
  const pool = getPool();

  const signalActions = actions.filter(a => a.action === 'add' || a.action === 'vibe');
  const addActions    = actions.filter(a => a.action === 'add');

  let avgVec: number[] | null = null;
  let onboardingCount = 0;
  let likedCount = 0;

  if (signalActions.length > 0) {
    const names = signalActions.map(a => a.name);
    const vecResult = await pool.query<{ name: string; embedding: string }>(
      'SELECT name, embedding FROM name_vectors WHERE name = ANY($1::text[])',
      [names],
    );
    const vecMap = new Map(
      vecResult.rows.map(r => [r.name, parseVec(r.embedding as unknown as string)]),
    );

    const weightedSum = new Array<number>(VECTOR_DIM).fill(0);
    let totalWeight = 0;
    for (const action of signalActions) {
      const vec = vecMap.get(action.name);
      if (!vec) continue;
      const weight = action.action === 'add' ? 1.0 : 0.5;
      for (let i = 0; i < VECTOR_DIM; i++) weightedSum[i] += vec[i] * weight;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      avgVec = weightedSum.map(v => v / totalWeight);
      onboardingCount = totalWeight;
      likedCount = addActions.length;
    }
  }

  if (avgVec !== null) {
    await pool.query(
      `INSERT INTO user_taste
         (user_id, sex_context, embedding, liked_count, disliked_count, onboarding_count, preference_filters, updated_at)
       VALUES ($1, $2, $3::vector, $4, 0, $5, $6, NOW())
       ON CONFLICT (user_id, sex_context) DO UPDATE SET
         embedding          = EXCLUDED.embedding,
         liked_count        = EXCLUDED.liked_count,
         onboarding_count   = EXCLUDED.onboarding_count,
         preference_filters = EXCLUDED.preference_filters,
         updated_at         = NOW()`,
      [deviceId, ctx, vecToStr(avgVec), likedCount, onboardingCount, filters ? JSON.stringify(filters) : null],
    );

    // Record add actions as real liked swipes (can reappear until swiped in main deck)
    for (const action of addActions) {
      if (!pool) continue;
      await pool.query(
        `INSERT INTO user_swipes (user_id, name, liked, sex_context)
         VALUES ($1, $2, true, $3)
         ON CONFLICT (user_id, name, sex_context) DO UPDATE SET liked = true, swiped_at = NOW()`,
        [deviceId, action.name, ctx],
      );
    }
  } else if (filters) {
    // No signal actions but filters provided — save filters only if a taste row exists
    await pool.query(
      `UPDATE user_taste SET preference_filters = $3, updated_at = NOW()
       WHERE user_id = $1 AND sex_context = $2`,
      [deviceId, ctx, JSON.stringify(filters)],
    );
  }

  return ok({ ok: true });
}
