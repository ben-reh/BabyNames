import { BatchGetCommand, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE, ORIGIN_INDEX } from '../db/dynamo';
import { getPool } from '../db/postgres';
import { ok, err } from '../utils';

const LISTS_TABLE = 'Lists';

type Params = Record<string, string | undefined>;

export function formatName(item: Record<string, unknown>) {
  return {
    name: item.name,
    sex: item.sex,
    rank: item.rank ? Number(item.rank) : null,
    origin: item.origin || null,
    meaning: item.meaning || null,
    year_peak: item.year_peak ? Number(item.year_peak) : null,
    total_count: item.total_count ? Number(item.total_count) : null,
    female_pct: item.female_pct ? Number(item.female_pct) : null,
    vibe_names: (item.vibe_names as string[]) || [],
    phonetic_names: (item.phonetic_names as string[]) || [],
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
  // 'U' (unisex) means no DynamoDB sex filter — female_pct filtering handled by recommendations engine
  const sex = params.sex === 'U' ? undefined : params.sex;
  const { origin, listId, deviceId, exclude_top, years_back, min_rank, max_rank, cursor } = params;
  const limit = Math.min(parseInt(params.limit || '20', 10), 100);

  let excluded: Set<string> | null = null;
  if (exclude_top || years_back) {
    excluded = await getExcludedNames(
      parseInt(exclude_top || '25', 10),
      parseInt(years_back || '10', 10),
      sex,
    );
  }

  // Fetch list context for personalised scoring
  let similarityScores = new Map<string, number>();
  let partnerSet = new Set<string>();

  if (listId && deviceId) {
    const listResult = await ddb.send(new GetCommand({ TableName: LISTS_TABLE, Key: { listId } }));
    const list = listResult.Item as Record<string, any> | undefined;
    if (list) {
      const isA = list.partnerA?.deviceId === deviceId;
      const myNames: string[] = isA ? (list.partnerA?.names ?? []) : (list.partnerB?.names ?? []);
      const theirNames: string[] = isA ? (list.partnerB?.names ?? []) : (list.partnerA?.names ?? []);
      partnerSet = new Set(theirNames);

      if (myNames.length > 0) {
        const keys = myNames.slice(-20).map((n) => ({ name: n }));
        const batch = await ddb.send(new BatchGetCommand({
          RequestItems: {
            [TABLE]: {
              Keys: keys,
              ProjectionExpression: '#n, vibe_names',
              ExpressionAttributeNames: { '#n': 'name' },
            },
          },
        }));
        const liked = (batch.Responses?.[TABLE] ?? []) as Array<{ name: string; vibe_names?: string[] }>;
        for (const item of liked) {
          for (const s of item.vibe_names ?? []) {
            similarityScores.set(s, (similarityScores.get(s) ?? 0) + 1);
          }
        }
      }
    }
  }

  const lastKey = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : undefined;
  let items: Record<string, unknown>[] = [];
  let nextKey: unknown;

  const origins = origin ? origin.split(',').map((o) => o.trim()).filter(Boolean) : [];

  if (origins.length === 1) {
    const filterParts: string[] = [];
    const attrVals: Record<string, unknown> = { ':origin': origins[0] };
    if (sex) { filterParts.push('sex = :sex'); attrVals[':sex'] = sex; }

    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: ORIGIN_INDEX,
      KeyConditionExpression: 'origin = :origin',
      FilterExpression: filterParts.length ? filterParts.join(' AND ') : undefined,
      ExpressionAttributeValues: attrVals,
      Limit: limit * 8,
      ExclusiveStartKey: lastKey,
    }));
    items = (result.Items ?? []) as Record<string, unknown>[];
    nextKey = result.LastEvaluatedKey;
  } else if (origins.length > 1) {
    // Parallel GSI queries per origin — avoids full table scan with low hit rate
    const perOriginLimit = Math.max(60, limit * 3);
    const results = await Promise.all(
      origins.map((o) => {
        const filterParts: string[] = [];
        const attrVals: Record<string, unknown> = { ':origin': o };
        if (sex) { filterParts.push('sex = :sex'); attrVals[':sex'] = sex; }
        return ddb.send(new QueryCommand({
          TableName: TABLE,
          IndexName: ORIGIN_INDEX,
          KeyConditionExpression: 'origin = :origin',
          FilterExpression: filterParts.length ? filterParts.join(' AND ') : undefined,
          ExpressionAttributeValues: attrVals,
          Limit: perOriginLimit,
        }));
      }),
    );
    const merged = results.flatMap((r) => (r.Items ?? []) as Record<string, unknown>[]);
    // Shuffle to interleave origins
    for (let i = merged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [merged[i], merged[j]] = [merged[j], merged[i]];
    }
    items = merged;
    nextKey = undefined; // no cursor for multi-origin parallel queries
  } else {
    const filterParts: string[] = [];
    const attrNames: Record<string, string> = {};
    const attrVals: Record<string, unknown> = {};

    if (sex) { filterParts.push('sex = :sex'); attrVals[':sex'] = sex; }
    if (min_rank) { filterParts.push('#rnk >= :min_rank'); attrNames['#rnk'] = 'rank'; attrVals[':min_rank'] = Number(min_rank); }
    // Apply cold-start cap: no personalization signal → restrict scan to top-ranked names
    // so sorting by rank produces genuinely popular results, not a random scan subset.
    const effectiveMaxRank = max_rank ?? (similarityScores.size === 0 && partnerSet.size === 0 ? '300' : undefined);
    if (effectiveMaxRank) { filterParts.push('#rnk <= :max_rank'); attrNames['#rnk'] = 'rank'; attrVals[':max_rank'] = Number(effectiveMaxRank); }

    const result = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: filterParts.length ? filterParts.join(' AND ') : undefined,
      ExpressionAttributeNames: Object.keys(attrNames).length ? attrNames : undefined,
      ExpressionAttributeValues: Object.keys(attrVals).length ? attrVals : undefined,
      // Cold-start cap bounds results to ~300 names — skip Limit so the full table
      // is scanned and all matching top-ranked names are found regardless of sex filter.
      Limit: effectiveMaxRank ? undefined : limit * 8,
      ExclusiveStartKey: lastKey,
    }));
    items = (result.Items ?? []) as Record<string, unknown>[];
    nextKey = result.LastEvaluatedKey;
  }

  if (excluded) items = items.filter(i => !excluded!.has(i.name as string));

  // Batch-fetch 2025 SSA ranks before sorting so cold start can order by them
  const rank2025Map = new Map<string, number>();
  const femalePctMap = new Map<string, number>();
  if (items.length > 0) {
    const nameList = items.map((i) => i.name as string);
    const { rows } = await getPool().query<{ name: string; gender: string; rank_2025: number; female_pct: number }>(
      `SELECT name, gender, rank_2025,
              female_count::float / NULLIF(total_count, 0) AS female_pct
       FROM (
         SELECT name, gender,
                RANK() OVER (PARTITION BY gender ORDER BY count DESC) AS rank_2025,
                SUM(count) OVER (PARTITION BY name) AS total_count,
                SUM(CASE WHEN gender = 'F' THEN count ELSE 0 END) OVER (PARTITION BY name) AS female_count
         FROM name_popularity WHERE year = 2025
       ) all_ranked
       WHERE name = ANY($1::text[])`,
      [nameList],
    );
    for (const row of rows) {
      rank2025Map.set(`${row.name}-${row.gender}`, Number(row.rank_2025));
      femalePctMap.set(row.name, Number(row.female_pct));
    }
  }

  // Score and sort: partner-liked first, then similarity-boosted, then popularity + jitter
  if (partnerSet.size > 0 || similarityScores.size > 0) {
    const scored = items.map((item) => {
      const name = item.name as string;
      let score: number;
      if (partnerSet.has(name)) {
        score = 10000;
      } else {
        const simScore = (similarityScores.get(name) ?? 0) * 15;
        const rank = rank2025Map.get(`${item.name as string}-${item.sex as string}`) ?? Number(item.rank ?? 99999);
        const popScore = 100 / Math.sqrt(rank);
        score = simScore + popScore + Math.random() * 3;
      }
      return { item, score };
    });
    scored.sort((a, b) => b.score - a.score);
    items = scored.map((s) => s.item);
  } else {
    // Cold start: sort by 2025 rank with small jitter to avoid identical ordering every session
    items.sort((a, b) => {
      const ra = rank2025Map.get(`${a.name as string}-${a.sex as string}`) ?? Number(a.rank ?? 99999);
      const rb = rank2025Map.get(`${b.name as string}-${b.sex as string}`) ?? Number(b.rank ?? 99999);
      return (ra + Math.random() * 5) - (rb + Math.random() * 5);
    });
  }

  items = items.slice(0, limit);

  return ok({
    names: items.map((item) => {
      const formatted = formatName(item);
      return {
        ...formatted,
        female_pct: femalePctMap.has(item.name as string) ? femalePctMap.get(item.name as string)! : formatted.female_pct,
        rank_2025: rank2025Map.get(`${item.name as string}-${item.sex as string}`) ?? null,
      };
    }),
    cursor: nextKey ? Buffer.from(JSON.stringify(nextKey)).toString('base64url') : null,
  });
}

export async function getBatchNames(params: Params) {
  const names = params.names?.split(',').map((n) => n.trim()).filter(Boolean) ?? [];
  if (names.length === 0) return ok({ names: [] });

  const keys = names.slice(0, 100).map((n) => ({ name: n }));
  const result = await ddb.send(new BatchGetCommand({
    RequestItems: {
      [TABLE]: {
        Keys: keys,
        ProjectionExpression: '#n, sex, female_pct',
        ExpressionAttributeNames: { '#n': 'name' },
      },
    },
  }));

  const items = (result.Responses?.[TABLE] ?? []) as Array<{ name: string; sex: string; female_pct?: number }>;
  return ok({ names: items.map((i) => ({ name: i.name, sex: i.sex, female_pct: i.female_pct ? Number(i.female_pct) : null })) });
}

export async function getRankings(params: Params) {
  const { sex, year } = params;
  const limit = Math.min(parseInt(params.limit || '50', 10), 100);
  const offset = parseInt(params.offset || '0', 10);

  if (!sex || !year) return err(400, 'sex and year are required');

  const { rows } = await getPool().query<{ name: string; count: string; rank: string }>(
    `SELECT name, count,
            RANK() OVER (ORDER BY count DESC) AS rank
     FROM name_popularity
     WHERE year = $1 AND gender = $2
     ORDER BY count DESC
     LIMIT $3 OFFSET $4`,
    [parseInt(year, 10), sex, limit, offset],
  );

  return ok({
    rankings: rows.map((r: { name: string; count: string | number; rank: string | number }) => ({ name: r.name, count: Number(r.count), rank: Number(r.rank) })),
    offset: offset + rows.length,
    hasMore: rows.length === limit,
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
  const lq = q.toLowerCase();

  // Paginate the full scan. ProjectionExpression drops etymology_raw / vibe_names / phonetic_names,
  // shrinking items from ~2KB to ~40 bytes so the whole table fits in 3-4 pages.
  const allMatches: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(#n, :prefix) OR contains(#sv, :prefix)',
      ExpressionAttributeNames: { '#n': 'name', '#rnk': 'rank', '#sv': 'spelling_variants' },
      ExpressionAttributeValues: { ':prefix': prefix },
      ProjectionExpression: '#n, sex, #rnk, origin, #sv',
      ExclusiveStartKey: lastKey,
    }));
    allMatches.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  const items = allMatches
    .filter(i => {
      if ((i.name as string).toLowerCase().startsWith(lq)) return true;
      const variants = ((i.spelling_variants as string) || '').split(' ').filter(Boolean);
      return variants.some(v => v.toLowerCase().startsWith(lq));
    })
    .sort((a, b) => {
      const aNameMatch = (a.name as string).toLowerCase().startsWith(lq);
      const bNameMatch = (b.name as string).toLowerCase().startsWith(lq);
      if (aNameMatch !== bNameMatch) return aNameMatch ? -1 : 1;
      return Number(a.rank ?? 99999) - Number(b.rank ?? 99999);
    })
    .slice(0, 20);

  return ok({ names: items.map(formatName) });
}
