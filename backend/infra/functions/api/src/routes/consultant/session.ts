import { BatchGetCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { ddb, TABLE, ORIGIN_INDEX } from '../../db/dynamo';
import { getPool } from '../../db/postgres';
import { ok, err } from '../../utils';
import { buildProfileSummaryPrompt, buildVibeTranslationPrompt, buildNameDescriptionsPrompt } from './prompts';

const LISTS_TABLE = 'Lists';
const MODEL_SUMMARY      = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'; // profile prose — quality matters
const MODEL_VIBE         = 'amazon.nova-micro-v1:0';                       // JSON extraction only
const MODEL_DESCRIPTIONS = 'amazon.nova-micro-v1:0';                      // personalized copy, high volume
const RESULT_SIZE = 15;

const UNISEX_MIN = 0.05;
const UNISEX_MAX = 0.95;
const SEX_FILTER_F = 0.05;
const SEX_FILTER_M = 0.95;

const NP_AGG = `(SELECT name, SUM(count) AS count, SUM(CASE WHEN gender='F' THEN count ELSE 0 END)::float / NULLIF(SUM(count),0) AS female_pct FROM name_popularity WHERE year = 2025 GROUP BY name) np`;

function sexClause(sex: string | undefined): string {
  const pct = `COALESCE(np.female_pct, nv.female_pct, 0.5)`;
  if (sex === 'F') return `AND ${pct} >= ${SEX_FILTER_F}`;
  if (sex === 'M') return `AND ${pct} <= ${SEX_FILTER_M}`;
  if (sex === 'U') return `AND ${pct} > ${UNISEX_MIN} AND ${pct} < ${UNISEX_MAX}`;
  return '';
}

interface VibeAdjustments {
  originBoosts: string[];
  popularityTierShift: number;
  syllablePreference: number | null;
  notes: string;
}

interface NameMeta {
  name: string;
  sex: string;
  origin: string | null;
  year_peak: number | null;
  rank: number | null;
}

const bedrock = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION,
});

async function callModel(modelId: string, system: string, user: string, maxTokens: number): Promise<string> {
  const response = await bedrock.send(new ConverseCommand({
    modelId,
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: user }] }],
    inferenceConfig: { maxTokens },
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = (response.output?.message?.content ?? []).find((b: any) => 'text' in b) as any;
  return block?.text?.trim() ?? '';
}

function parseJsonSafe<T>(text: string): T | null {
  const arrMatch = text.match(/\[[\s\S]*\]/);
  const objMatch = text.match(/\{[\s\S]*\}/);
  const raw = arrMatch ?? objMatch;
  if (!raw) return null;
  try { return JSON.parse(raw[0]); } catch { return null; }
}

async function getNamesMeta(names: string[]): Promise<NameMeta[]> {
  if (names.length === 0) return [];
  const CHUNK = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < names.length; i += CHUNK) chunks.push(names.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) =>
      ddb.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: chunk.map((n) => ({ name: n })) } } })),
    ),
  );
  const items = results.flatMap((r) => (r.Responses?.[TABLE] ?? []) as Record<string, unknown>[]);
  return items.map((item) => ({
    name: item.name as string,
    sex: (item.sex as string) ?? 'U',
    origin: (item.origin as string) || null,
    year_peak: item.year_peak ? Number(item.year_peak) : null,
    rank: item.rank ? Number(item.rank) : null,
  }));
}

async function getOriginNamesList(origins: string[]): Promise<string[]> {
  const results = await Promise.all(
    origins.map((origin) =>
      ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: ORIGIN_INDEX,
        KeyConditionExpression: 'origin = :o',
        ExpressionAttributeValues: { ':o': origin },
        ProjectionExpression: '#n',
        ExpressionAttributeNames: { '#n': 'name' },
        Limit: 200,
      })),
    ),
  );
  const names: string[] = [];
  for (const r of results) for (const item of (r.Items ?? [])) names.push(item.name as string);
  return [...new Set(names)];
}

export async function consultantSession(body: Record<string, unknown>) {
  const deviceId = body.deviceId as string | undefined;
  const listId = body.listId as string | undefined;
  const vibeText = (body.vibeText as string | undefined)?.trim();
  const sex = body.sex as string | undefined;
  const sexCtx = (sex === 'F' || sex === 'M' || sex === 'U') ? sex : 'U';

  if (!deviceId) return err(400, 'deviceId is required');

  const pool = getPool();

  // --- 1. Fetch taste context ---
  const [tasteResult, likedSwipesResult, passedSwipesResult] = await Promise.all([
    pool.query<{ embedding: string; liked_count: number; disliked_count: number }>(
      'SELECT embedding, liked_count, disliked_count FROM user_taste WHERE user_id = $1 AND sex_context = $2',
      [deviceId, sexCtx],
    ),
    pool.query<{ name: string }>(
      'SELECT name FROM user_swipes WHERE user_id = $1 AND liked = true AND sex_context = $2 ORDER BY swiped_at DESC LIMIT 50',
      [deviceId, sexCtx],
    ),
    pool.query<{ name: string }>(
      'SELECT name FROM user_swipes WHERE user_id = $1 AND liked = false AND sex_context = $2 ORDER BY swiped_at DESC LIMIT 50',
      [deviceId, sexCtx],
    ),
  ]);

  const tasteRow = tasteResult.rows[0] ?? null;
  const likedNames = likedSwipesResult.rows.map((r) => r.name);
  const passedNames = passedSwipesResult.rows.map((r) => r.name);

  const [likedMeta, passedMeta, partnerData] = await Promise.all([
    getNamesMeta(likedNames),
    getNamesMeta(passedNames),
    (async () => {
      if (!listId) return null;
      const listResult = await ddb.send(new GetCommand({ TableName: LISTS_TABLE, Key: { listId } }));
      const list = listResult.Item as
        | { partnerA?: { deviceId: string }; partnerB?: { deviceId: string } }
        | undefined;
      if (!list) return null;
      const partnerDeviceId =
        list.partnerA?.deviceId === deviceId
          ? list.partnerB?.deviceId
          : list.partnerA?.deviceId;
      if (!partnerDeviceId) return null;
      const { rows } = await pool.query<{ name: string }>(
        'SELECT name FROM user_swipes WHERE user_id = $1 AND liked = true AND sex_context = $2 ORDER BY swiped_at DESC LIMIT 8',
        [partnerDeviceId, sexCtx],
      );
      return rows.map((r) => r.name);
    })(),
  ]);

  const partnerLikedMeta = partnerData ? await getNamesMeta(partnerData) : null;

  // --- 2. Generate profile summary ---
  const fmt = (meta: NameMeta[]) =>
    meta
      .map((n) => `${n.name}${n.origin ? ` (${n.origin})` : ''}${n.year_peak ? `, peak ${n.year_peak}` : ''}`)
      .join(', ') || 'none yet';

  const { profileSystem, profileUser } = buildProfileSummaryPrompt({
    likedNames: fmt(likedMeta),
    passedNames: fmt(passedMeta),
    likedCount: tasteRow?.liked_count ?? 0,
    dislikedCount: tasteRow?.disliked_count ?? 0,
    hasPartner: !!partnerLikedMeta,
    partnerLikedNames: partnerLikedMeta ? fmt(partnerLikedMeta) : '',
  });

  let profileSummary = "You're just getting started — swipe on a few names and your taste profile will come to life.";
  let partnerSummary: string | null = null;

  if (likedNames.length > 0 || passedNames.length > 0) {
    const rawSummary = await callModel(MODEL_SUMMARY, profileSystem, profileUser, 200);
    if (partnerLikedMeta && partnerLikedMeta.length > 0) {
      const sentences = rawSummary.split(/(?<=[.!?])\s+/);
      if (sentences.length >= 2) {
        profileSummary = sentences.slice(0, -1).join(' ');
        partnerSummary = sentences[sentences.length - 1];
      } else {
        profileSummary = rawSummary;
      }
    } else {
      profileSummary = rawSummary;
    }
  }

  // --- 3. Translate vibe (if provided) ---
  let vibeAdjustments: VibeAdjustments = {
    originBoosts: [],
    popularityTierShift: 0,
    syllablePreference: null,
    notes: '',
  };

  if (vibeText) {
    const { vibeSystem, vibeUser } = buildVibeTranslationPrompt({ vibeText, profileSummary });
    const vibeRaw = await callModel(MODEL_VIBE, vibeSystem, vibeUser, 300);
    const parsed = parseJsonSafe<VibeAdjustments>(vibeRaw);
    if (parsed) vibeAdjustments = { ...vibeAdjustments, ...parsed };
  }

  // --- 4. ANN retrieval ---
  const queryVec = tasteRow
    ? `[${(tasteRow.embedding as unknown as string).slice(1, -1)}]`
    : null;

  let originArr: string[] | null = null;
  if (vibeAdjustments.originBoosts.length > 0) {
    const names = await getOriginNamesList(vibeAdjustments.originBoosts);
    if (names.length > 0) originArr = names;
  }

  const shift = Math.max(-2, Math.min(2, Math.round(vibeAdjustments.popularityTierShift ?? 0)));
  const popularityFilter =
    shift <= -2 ? 'AND np.count >= 10000'
    : shift === -1 ? 'AND np.count >= 3000'
    : shift === 1 ? 'AND np.count < 1500'
    : shift >= 2 ? 'AND np.count < 500'
    : '';

  const originSql = (idx: number) =>
    originArr ? `AND nv.name = ANY($${idx}::text[])` : '';
  const sexFilter = sexClause(sex);

  let retrievedNames: string[];

  if (queryVec) {
    const params: unknown[] = [deviceId, queryVec];
    if (originArr) params.push(originArr);
    const { rows } = await pool.query<{ name: string }>(
      `SELECT nv.name
       FROM   name_vectors nv
       JOIN   ${NP_AGG} ON np.name = nv.name
       WHERE  nv.name NOT IN (SELECT name FROM user_swipes WHERE user_id = $1)
       ${popularityFilter}
       ${sexFilter}
       ${originSql(3)}
       ORDER  BY nv.embedding <=> $2::vector
       LIMIT  ${RESULT_SIZE}`,
      params,
    );
    retrievedNames = rows.map((r) => r.name);
  } else {
    const params: unknown[] = [deviceId];
    if (originArr) params.push(originArr);
    const { rows } = await pool.query<{ name: string }>(
      `SELECT nv.name
       FROM   name_vectors nv
       JOIN   ${NP_AGG} ON np.name = nv.name
       WHERE  nv.name NOT IN (SELECT name FROM user_swipes WHERE user_id = $1)
       ${popularityFilter}
       ${sexFilter}
       ${originSql(2)}
       ORDER  BY np.count DESC
       LIMIT  ${RESULT_SIZE}`,
      params,
    );
    retrievedNames = rows.map((r) => r.name);
  }

  // Preserve retrieval order when fetching metadata
  const resultMeta = await getNamesMeta(retrievedNames);
  const metaMap = new Map(resultMeta.map((m) => [m.name, m]));
  const orderedMeta = retrievedNames.map((n) => metaMap.get(n)).filter(Boolean) as NameMeta[];

  // --- 5. Generate personalized descriptions ---
  const nameListText = orderedMeta
    .map((n) =>
      `- ${n.name}: ${n.sex === 'F' ? 'girl' : n.sex === 'M' ? 'boy' : 'unisex'}, ${n.origin ?? 'origin unknown'}${n.year_peak ? `, peak ${n.year_peak}` : ''}`,
    )
    .join('\n');

  const { descSystem, descUser } = buildNameDescriptionsPrompt({
    profileSummary,
    vibeText: vibeText ?? '',
    nameList: nameListText,
  });

  const descriptionsRaw = await callModel(MODEL_DESCRIPTIONS, descSystem, descUser, 700);
  const descriptions =
    parseJsonSafe<{ name: string; description: string }[]>(descriptionsRaw) ?? [];
  const descMap = new Map(descriptions.map((d) => [d.name, d.description]));

  // --- 6. Build response ---
  const names = orderedMeta.map((n) => ({
    name: n.name,
    gender: n.sex === 'F' ? 'girl' : n.sex === 'M' ? 'boy' : 'unisex',
    origin: n.origin ?? '',
    description:
      descMap.get(n.name) ??
      `A${n.origin ? ` ${n.origin}` : ''} name${n.year_peak ? ` that peaked in ${n.year_peak}` : ''}.`,
  }));

  return ok({ profileSummary, partnerSummary, names });
}
