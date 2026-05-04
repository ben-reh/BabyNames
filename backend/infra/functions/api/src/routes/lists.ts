import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { ddb } from '../db/dynamo';
import { ok, err } from '../utils';

const LISTS_TABLE = 'Lists';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
const TTL_DAYS = 90;

function generateCode(): string {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

function ttlTimestamp(): number {
  return Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
}

function computeMatches(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter(name => setB.has(name));
}

function partnerRole(item: Record<string, any>, deviceId: string): 'A' | 'B' | null {
  if (item.partnerA?.deviceId === deviceId) return 'A';
  if (item.partnerB?.deviceId === deviceId) return 'B';
  return null;
}

export async function createList(body: Record<string, unknown>) {
  const { deviceId, filters } = body as { deviceId: string; filters?: Record<string, unknown> };
  if (!deviceId) return err(400, 'deviceId is required');

  const listId = randomUUID();
  const code = generateCode();

  await ddb.send(new PutCommand({
    TableName: LISTS_TABLE,
    Item: {
      listId,
      code,
      partnerA: { deviceId, names: [] },
      partnerB: null,
      filters: filters ?? {},
      createdAt: Date.now(),
      ttl: ttlTimestamp(),
    },
  }));

  return ok({ listId, code });
}

export async function joinList(body: Record<string, unknown>) {
  const { code, deviceId } = body as { code: string; deviceId: string };
  if (!code || !deviceId) return err(400, 'code and deviceId are required');

  const result = await ddb.send(new QueryCommand({
    TableName: LISTS_TABLE,
    IndexName: 'code-index',
    KeyConditionExpression: 'code = :code',
    ExpressionAttributeValues: { ':code': code.toUpperCase() },
    Limit: 1,
  }));

  const item = result.Items?.[0];
  if (!item) return err(404, 'List not found');

  // Already joined as partner A
  if (item.partnerA?.deviceId === deviceId) {
    return ok({ listId: item.listId, role: 'A' });
  }

  // Partner B slot already taken by a different device
  if (item.partnerB && item.partnerB.deviceId !== deviceId) {
    return err(409, 'This list already has two partners');
  }

  // Partner B slot taken by this same device (re-joining)
  if (item.partnerB?.deviceId === deviceId) {
    return ok({ listId: item.listId, role: 'B' });
  }

  await ddb.send(new UpdateCommand({
    TableName: LISTS_TABLE,
    Key: { listId: item.listId },
    UpdateExpression: 'SET partnerB = :pb',
    ExpressionAttributeValues: { ':pb': { deviceId, names: [] } },
  }));

  return ok({ listId: item.listId, role: 'B' });
}

export async function getList(listId: string) {
  const result = await ddb.send(new GetCommand({ TableName: LISTS_TABLE, Key: { listId } }));
  const item = result.Item;
  if (!item) return err(404, 'List not found');

  const aNamesRaw = item.partnerA?.names;
  const bNamesRaw = item.partnerB?.names;
  const aNames: string[] = Array.isArray(aNamesRaw) ? aNamesRaw : [];
  const bNames: string[] = Array.isArray(bNamesRaw) ? bNamesRaw : [];

  return ok({
    listId: item.listId,
    code: item.code,
    partnerA: { names: aNames },
    partnerB: item.partnerB ? { names: bNames } : null,
    matches: item.partnerB ? computeMatches(aNames, bNames) : [],
    partnerCount: item.partnerB ? 2 : 1,
    filters: item.filters ?? {},
  });
}

export async function addName(listId: string, name: string, body: Record<string, unknown>) {
  const { deviceId } = body as { deviceId: string };
  if (!deviceId || !name) return err(400, 'deviceId and name are required');

  const result = await ddb.send(new GetCommand({ TableName: LISTS_TABLE, Key: { listId } }));
  const item = result.Item;
  if (!item) return err(404, 'List not found');

  const role = partnerRole(item, deviceId);
  if (!role) return err(403, 'Device is not a partner in this list');

  const field = role === 'A' ? 'partnerA' : 'partnerB';
  const partner = item[field];
  const names: string[] = Array.isArray(partner?.names) ? partner.names : [];
  if (names.includes(name)) return ok({ listId, name, action: 'already_added' });

  await ddb.send(new UpdateCommand({
    TableName: LISTS_TABLE,
    Key: { listId },
    UpdateExpression: `SET ${field}.#names = list_append(${field}.#names, :n)`,
    ExpressionAttributeNames: { '#names': 'names' },
    ExpressionAttributeValues: { ':n': [name] },
  }));

  return ok({ listId, name, action: 'added' });
}

export async function removeName(listId: string, name: string, body: Record<string, unknown>) {
  const { deviceId } = body as { deviceId: string };
  if (!deviceId || !name) return err(400, 'deviceId and name are required');

  const result = await ddb.send(new GetCommand({ TableName: LISTS_TABLE, Key: { listId } }));
  const item = result.Item;
  if (!item) return err(404, 'List not found');

  const role = partnerRole(item, deviceId);
  if (!role) return err(403, 'Device is not a partner in this list');

  const field = role === 'A' ? 'partnerA' : 'partnerB';
  const partner = item[field];
  const names: string[] = Array.isArray(partner?.names) ? partner.names : [];
  const idx = names.indexOf(name);
  if (idx === -1) return ok({ listId, name, action: 'not_found' });

  await ddb.send(new UpdateCommand({
    TableName: LISTS_TABLE,
    Key: { listId },
    UpdateExpression: `REMOVE ${field}.#names[${idx}]`,
    ExpressionAttributeNames: { '#names': 'names' },
  }));

  return ok({ listId, name, action: 'removed' });
}
