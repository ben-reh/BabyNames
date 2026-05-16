import { BatchGetCommand, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { ddb } from '../db/dynamo';
import { ok, err } from '../utils';

const MODEL_ID = 'amazon.nova-lite-v1:0';
const NAMES_TABLE = process.env.NAMES_TABLE ?? 'Names';
const LISTS_TABLE = process.env.LISTS_TABLE ?? 'Lists';
const ORIGIN_INDEX = 'origin-index';
const MAX_TOOL_ROUNDS = 5;

const bedrock = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION,
});

interface NameResult {
  name: string;
  sex: string;
  rank: number | null;
  origin: string | null;
  year_peak: number | null;
  similar_names: string[];
}

function toNameResult(item: Record<string, unknown>): NameResult {
  return {
    name: item.name as string,
    sex: item.sex as string,
    rank: item.rank ? Number(item.rank) : null,
    origin: (item.origin as string) || null,
    year_peak: item.year_peak ? Number(item.year_peak) : null,
    similar_names: (item.similar_names as string[]) || [],
  };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

async function toolGetNameInfo(input: { name: string }): Promise<unknown> {
  const result = await ddb.send(
    new GetCommand({ TableName: NAMES_TABLE, Key: { name: capitalize(input.name) } }),
  );
  if (!result.Item) return { error: `Name '${input.name}' not found in database.` };
  const r = toNameResult(result.Item as Record<string, unknown>);
  // Cap similar_names so the model doesn't dump a 20-name list into its prose
  return { ...r, similar_names: r.similar_names.slice(0, 5) };
}

async function toolSearchNames(input: {
  sex?: string;
  origins?: string[];
  min_rank?: number;
  max_rank?: number;
  prefix?: string;
  similar_to?: string;
  max_name_length?: number;
  limit?: number;
}): Promise<unknown> {
  const limit = Math.min(input.limit ?? 20, 50);

  if (input.similar_to) {
    const result = await ddb.send(
      new GetCommand({ TableName: NAMES_TABLE, Key: { name: capitalize(input.similar_to) } }),
    );
    if (!result.Item) return { error: `Name '${input.similar_to}' not found.`, names: [] };

    const similarNames = (result.Item.similar_names as string[]) || [];
    if (similarNames.length === 0) return { names: [] };

    const batchResult = await ddb.send(
      new BatchGetCommand({
        RequestItems: { [NAMES_TABLE]: { Keys: similarNames.slice(0, 50).map((n) => ({ name: n })) } },
      }),
    );

    let items = (batchResult.Responses?.[NAMES_TABLE] ?? []) as Record<string, unknown>[];
    if (input.sex && input.sex !== 'U') items = items.filter((i) => i.sex === input.sex);
    if (input.min_rank) items = items.filter((i) => !i.rank || Number(i.rank) >= input.min_rank!);
    if (input.max_rank) items = items.filter((i) => !i.rank || Number(i.rank) <= input.max_rank!);
    items = items.sort((a, b) => Number(a.rank ?? 99999) - Number(b.rank ?? 99999)).slice(0, limit);

    return { names: items.map(toNameResult) };
  }

  if (input.origins && input.origins.length > 0) {
    const allItems: Record<string, unknown>[] = [];

    for (const origin of input.origins.slice(0, 5)) {
      const filterParts: string[] = [];
      const keyCondParts = ['origin = :origin'];
      const attrNames: Record<string, string> = {};
      const attrVals: Record<string, unknown> = { ':origin': origin };

      // rank is the GSI sort key — must go in KeyConditionExpression, not FilterExpression
      if (input.min_rank && input.max_rank) {
        attrNames['#rnk'] = 'rank';
        keyCondParts.push('#rnk BETWEEN :min_rank AND :max_rank');
        attrVals[':min_rank'] = input.min_rank;
        attrVals[':max_rank'] = input.max_rank;
      } else if (input.min_rank) {
        attrNames['#rnk'] = 'rank';
        keyCondParts.push('#rnk >= :min_rank');
        attrVals[':min_rank'] = input.min_rank;
      } else if (input.max_rank) {
        attrNames['#rnk'] = 'rank';
        keyCondParts.push('#rnk <= :max_rank');
        attrVals[':max_rank'] = input.max_rank;
      }

      if (input.sex && input.sex !== 'U') { filterParts.push('sex = :sex'); attrVals[':sex'] = input.sex; }
      if (input.prefix) { filterParts.push('begins_with(#n, :prefix)'); attrNames['#n'] = 'name'; attrVals[':prefix'] = capitalize(input.prefix); }
      if (input.max_name_length) { filterParts.push('size(#n) <= :max_len'); attrNames['#n'] = 'name'; attrVals[':max_len'] = input.max_name_length; }

      const result = await ddb.send(
        new QueryCommand({
          TableName: NAMES_TABLE,
          IndexName: ORIGIN_INDEX,
          KeyConditionExpression: keyCondParts.join(' AND '),
          FilterExpression: filterParts.length ? filterParts.join(' AND ') : undefined,
          ExpressionAttributeNames: attrNames,
          ExpressionAttributeValues: attrVals,
          Limit: limit * 3,
        }),
      );
      allItems.push(...((result.Items ?? []) as Record<string, unknown>[]));
    }

    const seen = new Set<string>();
    const deduped = allItems
      .filter((i) => { const n = i.name as string; if (seen.has(n)) return false; seen.add(n); return true; })
      .sort((a, b) => Number(a.rank ?? 99999) - Number(b.rank ?? 99999))
      .slice(0, limit);

    return { names: deduped.map(toNameResult) };
  }

  // General scan with filters
  const filterParts: string[] = [];
  const attrNames: Record<string, string> = {};
  const attrVals: Record<string, unknown> = {};

  if (input.sex && input.sex !== 'U') { filterParts.push('sex = :sex'); attrVals[':sex'] = input.sex; }
  if (input.min_rank) { filterParts.push('#rnk >= :min_rank'); attrNames['#rnk'] = 'rank'; attrVals[':min_rank'] = input.min_rank; }
  if (input.max_rank) { filterParts.push('#rnk <= :max_rank'); attrNames['#rnk'] = 'rank'; attrVals[':max_rank'] = input.max_rank; }
  if (input.prefix) { filterParts.push('begins_with(#n, :prefix)'); attrNames['#n'] = 'name'; attrVals[':prefix'] = capitalize(input.prefix); }
  if (input.max_name_length) { filterParts.push('size(#n) <= :max_len'); attrNames['#n'] = 'name'; attrVals[':max_len'] = input.max_name_length; }

  const result = await ddb.send(
    new ScanCommand({
      TableName: NAMES_TABLE,
      FilterExpression: filterParts.length ? filterParts.join(' AND ') : undefined,
      ExpressionAttributeNames: Object.keys(attrNames).length ? attrNames : undefined,
      ExpressionAttributeValues: Object.keys(attrVals).length ? attrVals : undefined,
      Limit: limit * 15,
    }),
  );

  const items = ((result.Items ?? []) as Record<string, unknown>[])
    .sort((a, b) => Number(a.rank ?? 99999) - Number(b.rank ?? 99999))
    .slice(0, limit);

  return { names: items.map(toNameResult) };
}

async function toolGetLikedNames(input: { listId: string }): Promise<unknown> {
  const result = await ddb.send(
    new GetCommand({ TableName: LISTS_TABLE, Key: { listId: input.listId } }),
  );
  if (!result.Item) return { error: 'List not found.', names: [] };

  const partnerA = (result.Item.partnerA as { names?: string[] })?.names ?? [];
  const partnerB = (result.Item.partnerB as { names?: string[] })?.names ?? [];
  const matches = (result.Item.matches as string[]) ?? [];

  return { your_names: partnerA, partner_names: partnerB, matches };
}

async function executeTool(
  name: string,
  input: unknown,
): Promise<{ result: unknown; names: NameResult[] }> {
  let result: unknown;

  if (name === 'get_name_info') {
    result = await toolGetNameInfo(input as { name: string });
  } else if (name === 'search_names') {
    result = await toolSearchNames(input as Parameters<typeof toolSearchNames>[0]);
  } else if (name === 'get_liked_names') {
    result = await toolGetLikedNames(input as { listId: string });
  } else {
    result = { error: `Unknown tool: ${name}` };
  }

  const names: NameResult[] = [];
  if (result && typeof result === 'object' && !('error' in (result as object))) {
    const r = result as Record<string, unknown>;
    if ('name' in r && typeof r.name === 'string') {
      names.push(result as NameResult);
    } else if ('names' in r && Array.isArray(r.names)) {
      names.push(...(r.names as NameResult[]));
    }
  }

  return { result, names };
}

const TOOLS = [
  {
    toolSpec: {
      name: 'get_name_info',
      description: 'Fetch detailed data for a specific baby name: rank, origin, peak year, and similar names.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The baby name (case-insensitive)' },
          },
          required: ['name'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'search_names',
      description:
        'Search the database for names matching style criteria. Use for requests like "southern vintage girl names" or "short Hebrew boy names". Returns up to 50 names sorted by popularity.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            sex: { type: 'string', enum: ['M', 'F', 'U'], description: 'M=boy, F=girl, U=any gender' },
            origins: {
              type: 'array',
              items: { type: 'string' },
              description: 'Cultural origins, e.g. ["Latin", "Greek", "Hebrew", "English", "French"]',
            },
            min_rank: { type: 'number', description: 'Min SSA rank (1=most popular). For popular names.' },
            max_rank: { type: 'number', description: 'Max SSA rank. For rarer names use 3000+.' },
            prefix: { type: 'string', description: 'Name prefix, e.g. "El" matches Eleanor, Eliza' },
            similar_to: { type: 'string', description: 'Return precomputed similar names for this name' },
            max_name_length: { type: 'number', description: 'Max character length of name. Use 4 for one-syllable, 7 for two-syllable.' },
            limit: { type: 'number', description: 'Max results (default 20, max 50)' },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_liked_names',
      description: "Fetch the names the user and their partner have already saved, to understand their taste and avoid suggesting duplicates.",
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            listId: { type: 'string', description: "The user's list ID" },
          },
          required: ['listId'],
        },
      },
    },
  },
];

function buildSystemPrompt(sex: string | null, listId: string | null | undefined): string {
  const sexContext = sex === 'F' ? 'girl names' : sex === 'M' ? 'boy names' : 'names of any gender';
  const listContext = listId
    ? ''
    : '\nThe user has not set up a partner list yet, so get_liked_names will not work. If asked about their list, tell them they can save names by swiping or searching, then come back to ask for personalized suggestions.';
  const today = new Date().toISOString().split('T')[0];
  return `${listContext}You are an expert baby name advisor helping parents explore and choose names. You have access to a US baby name database with SSA popularity rankings (1=most popular), cultural origins, and precomputed similar-name relationships.

IMPORTANT FORMATTING RULES:
- Do NOT use XML tags like <response>, <answer>, <thinking>, or any other tags in your responses
- Write plain, conversational prose only
- Be concise — parents are reading on a phone

Use your tools proactively:
- For a specific name → call get_name_info
- For style/vibe requests → call search_names. Style mappings: "Southern" → origins=["English","Hebrew"] max_rank=2000, "classic/vintage" → origins=["Latin","Greek","English"] max_rank=1000, "nature" → origins=["English"] max_rank=5000, "biblical" → origins=["Hebrew"] max_rank=3000
- For one-syllable names → use max_name_length=4 (most one-syllable names are 3-4 chars: Rex, Hank, Jack, Lee, Cole)
- For personalized suggestions → call get_liked_names first if listId is available
- Try multiple search_names calls with different parameters if the first returns few results

When you find names, they appear as tappable cards in the UI automatically — do not list them again in your prose. Write a 1–2 sentence intro only, then let the cards do the work.
Keep all replies concise — parents are reading on a phone.
If a name isn't in the database, say so rather than inventing data.

The user's current sex filter is ${sexContext}. Apply as default.
Today: ${today}. Most recent SSA data: 2025.`;
}

export interface ChatRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  context?: { listId?: string | null; sex?: string | null };
}

export async function chatHandler(body: ChatRequest) {
  const { messages, context } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return err(400, 'messages array is required');
  }

  const history = messages.slice(-20);

  if (history[0].role !== 'user') {
    return err(400, 'First message must be from user');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bedrockMessages: any[] = history.map((m) => ({
    role: m.role,
    content: [{ text: m.content }],
  }));

  const allNameResults: NameResult[] = [];
  const seenNames = new Set<string>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: buildSystemPrompt(context?.sex ?? null, context?.listId) }],
        messages: bedrockMessages,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        toolConfig: { tools: TOOLS as any },
        inferenceConfig: { maxTokens: 512 },
      }),
    );

    const message = response.output?.message;
    if (!message) break;

    if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textBlock = (message.content ?? []).find((b: any) => 'text' in b) as any;
      const raw: string = textBlock?.text ?? '';
      // Nova Lite sometimes wraps output in XML tags — strip/unwrap them
      const cleaned = raw
        .replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, '')
        .replace(/^<response>\n?([\s\S]*?)\n?<\/response>$/s, '$1')
        .replace(/^<answer>\n?([\s\S]*?)\n?<\/answer>$/s, '$1')
        .trim();

      // For lists (>1 name card), trim prose to intro line only — cards show the names
      // For single-name lookups, the full description is valuable
      const reply = allNameResults.length > 1
        ? (() => {
            const nlIdx = cleaned.indexOf('\n');
            const sentMatch = cleaned.match(/^.+?[.!?:](?=\s|$)/s);
            const sentEnd = sentMatch ? sentMatch[0].length : Infinity;
            const cut = nlIdx > 0 ? Math.min(nlIdx, sentEnd) : sentEnd;
            return cut < Infinity ? cleaned.slice(0, cut).trim() : cleaned;
          })()
        : cleaned;

      return ok({ reply, names: allNameResults });
    }

    if (response.stopReason === 'tool_use') {
      bedrockMessages = [...bedrockMessages, { role: 'assistant', content: message.content }];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUseBlocks = (message.content ?? []).filter((b: any) => 'toolUse' in b) as any[];

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block: any) => {
          const { result, names } = await executeTool(block.toolUse.name, block.toolUse.input);
          for (const n of names) {
            if (!seenNames.has(n.name)) {
              seenNames.add(n.name);
              allNameResults.push(n);
            }
          }
          return {
            toolResult: {
              toolUseId: block.toolUse.toolUseId,
              content: [{ json: result }],
            },
          };
        }),
      );

      bedrockMessages = [...bedrockMessages, { role: 'user', content: toolResults }];
      continue;
    }

    break;
  }

  return ok({ reply: "Sorry, I couldn't complete that. Please try again.", names: [] });
}
