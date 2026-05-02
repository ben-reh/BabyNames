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
