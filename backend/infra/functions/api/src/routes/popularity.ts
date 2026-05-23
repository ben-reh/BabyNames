import { getPool } from '../db/postgres';
import { ok, err } from '../utils';

type Params = Record<string, string | undefined>;

export async function getPopularity(name: string, params: Params) {
  const { sex, start_year, end_year } = params;

  const conditions = ['name = $1'];
  const values: unknown[] = [name];
  let i = 2;

  if (sex)        { conditions.push(`gender = $${i++}`); values.push(sex); }
  if (start_year) { conditions.push(`year >= $${i++}`); values.push(parseInt(start_year, 10)); }
  if (end_year)   { conditions.push(`year <= $${i++}`); values.push(parseInt(end_year, 10)); }

  const { rows } = await getPool().query(
    `SELECT year, gender, count
     FROM name_popularity
     WHERE ${conditions.join(' AND ')}
     ORDER BY year ASC`,
    values,
  );

  if (rows.length === 0) return err(404, 'No popularity data found');
  return ok({ name, data: rows });
}

export async function getComparableNames(name: string, params: Params) {
  const year = parseInt(params.year || '1990', 10);
  const { sex } = params;
  if (!sex) return err(400, 'sex is required');

  const { rows } = await getPool().query<{ name: string }>(
    `SELECT np.name
     FROM name_popularity np
     JOIN (SELECT count FROM name_popularity WHERE name = $1 AND year = $2 AND gender = $3) t ON true
     WHERE np.year = $2 AND np.gender = $3 AND np.name != $1
     ORDER BY ABS(np.count - t.count) ASC
     LIMIT 2`,
    [name, year, sex],
  );

  return ok({ comparable: rows.map((r) => r.name) });
}

export async function getNameRank(name: string, params: Params) {
  const year = parseInt(params.year || '2024', 10);
  const { sex } = params;
  if (!sex) return err(400, 'sex is required');

  const { rows } = await getPool().query<{ rank: string; count: string }>(
    `SELECT rank, count FROM (
       SELECT name, count, RANK() OVER (ORDER BY count DESC) AS rank
       FROM name_popularity
       WHERE year = $1 AND gender = $2
     ) ranked
     WHERE name = $3`,
    [year, sex, name],
  );

  if (rows.length === 0) return ok({ rank: null, count: null, year });
  return ok({ rank: Number(rows[0].rank), count: Number(rows[0].count), year });
}
