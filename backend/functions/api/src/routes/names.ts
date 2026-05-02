import { GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE, ORIGIN_INDEX } from '../db/dynamo';
import { getPool } from '../db/postgres';
import { ok, err } from '../utils';

type Params = Record<string, string | undefined>;

function formatName(item: Record<string, unknown>) {
  return {
    name: item.name,
    sex: item.sex,
    rank: item.rank ? Number(item.rank) : null,
    origin: item.origin || null,
    year_peak: item.year_peak ? Number(item.year_peak) : null,
    total_count: item.total_count ? Number(item.total_count) : null,
    similar_names: (item.similar_names as string[]) || [],
    spelling_variants: item.spelling_variants
      ? (item.spelling_variants as string).split(' ').filter(Boolean)
      : [],
  };
}

async function getExcludedNames(topN: number, yearsBack: number, sex?: string): Promise<Set<string>> {
  const sinceYear = new Date().getFullYear() - yearsBack;
  const genderClause = sex ? `AND gender = $3` : '';
  const values: unknown[] = [sinceYear, topN];
  if (sex) values.push(sex);

  const { rows } = await getPool().query(
    `SELECT DISTINCT name FROM (
       SELECT name, RANK() OVER (PARTITION BY year, gender ORDER BY count DESC) AS rnk
       FROM name_popularity
       WHERE year >= $1 ${genderClause}
     ) ranked
     WHERE rnk <= $2`,
    values,
  );
  return new Set(rows.map((r: { name: string }) => r.name));
}

export async function getNames(params: Params) {
  const { sex, origin, exclude_top, years_back, min_rank, max_rank, cursor } = params;
  const limit = Math.min(parseInt(params.limit || '20', 10), 100);

  let excluded: Set<string> | null = null;
  if (exclude_top || years_back) {
    excluded = await getExcludedNames(
      parseInt(exclude_top || '25', 10),
      parseInt(years_back || '10', 10),
      sex,
    );
  }

  const lastKey = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : undefined;
  let items: Record<string, unknown>[] = [];
  let nextKey: unknown;

  if (origin) {
    const filterParts: string[] = [];
    const attrVals: Record<string, unknown> = { ':origin': origin };
    if (sex) { filterParts.push('sex = :sex'); attrVals[':sex'] = sex; }

    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: ORIGIN_INDEX,
      KeyConditionExpression: 'origin = :origin',
      FilterExpression: filterParts.length ? filterParts.join(' AND ') : undefined,
      ExpressionAttributeValues: attrVals,
      Limit: limit * 4,
      ExclusiveStartKey: lastKey,
    }));
    items = (result.Items ?? []) as Record<string, unknown>[];
    nextKey = result.LastEvaluatedKey;
  } else {
    const filterParts: string[] = [];
    const attrNames: Record<string, string> = {};
    const attrVals: Record<string, unknown> = {};

    if (sex) { filterParts.push('sex = :sex'); attrVals[':sex'] = sex; }
    if (min_rank) { filterParts.push('#rnk >= :min_rank'); attrNames['#rnk'] = 'rank'; attrVals[':min_rank'] = Number(min_rank); }
    if (max_rank) { filterParts.push('#rnk <= :max_rank'); attrNames['#rnk'] = 'rank'; attrVals[':max_rank'] = Number(max_rank); }

    const result = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: filterParts.length ? filterParts.join(' AND ') : undefined,
      ExpressionAttributeNames: Object.keys(attrNames).length ? attrNames : undefined,
      ExpressionAttributeValues: Object.keys(attrVals).length ? attrVals : undefined,
      Limit: limit * 4,
      ExclusiveStartKey: lastKey,
    }));
    items = (result.Items ?? []) as Record<string, unknown>[];
    nextKey = result.LastEvaluatedKey;
  }

  if (excluded) items = items.filter(i => !excluded!.has(i.name as string));
  items = items.slice(0, limit);

  return ok({
    names: items.map(formatName),
    cursor: nextKey ? Buffer.from(JSON.stringify(nextKey)).toString('base64url') : null,
  });
}

export async function getName(name: string) {
  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: { name } }));
  if (!result.Item) return err(404, 'Name not found');
  return ok(formatName(result.Item as Record<string, unknown>));
}

export async function searchNames(params: Params) {
  const q = params.q?.trim();
  if (!q) return err(400, 'q is required');

  const prefix = q[0].toUpperCase() + q.slice(1).toLowerCase();
  const result = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'begins_with(#n, :prefix)',
    ExpressionAttributeNames: { '#n': 'name' },
    ExpressionAttributeValues: { ':prefix': prefix },
  }));

  const lq = q.toLowerCase();
  const items = ((result.Items ?? []) as Record<string, unknown>[])
    .filter(i => (i.name as string).toLowerCase().startsWith(lq))
    .sort((a, b) => Number(a.rank ?? 99999) - Number(b.rank ?? 99999))
    .slice(0, 20);

  return ok({ names: items.map(formatName) });
}
