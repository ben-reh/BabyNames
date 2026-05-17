import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { ddb } from '../db/dynamo';
import { err, ok } from '../utils';

const TAGS_TABLE = process.env.TAGS_TABLE!;

const TAG_COLORS = ['#E8608A', '#5B8DEF', '#4CAF72', '#FF9800', '#9C27B0', '#00BCD4'];

type Params = Record<string, string | undefined>;

export async function listTagDefs(params: Params) {
  const { deviceId } = params;
  if (!deviceId) return err(400, 'deviceId is required');

  const result = await ddb.send(new QueryCommand({
    TableName: TAGS_TABLE,
    KeyConditionExpression: 'deviceId = :d AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':d': deviceId, ':prefix': 'DEF#' },
  }));

  return ok({
    tags: (result.Items ?? []).map(item => ({
      id: item.tagId as string,
      label: item.label as string,
      color: item.color as string,
    })),
  });
}

export async function listTagAssignments(params: Params) {
  const { deviceId } = params;
  if (!deviceId) return err(400, 'deviceId is required');

  const result = await ddb.send(new QueryCommand({
    TableName: TAGS_TABLE,
    KeyConditionExpression: 'deviceId = :d AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':d': deviceId, ':prefix': 'ASSIGN#' },
  }));

  const assignments: Record<string, string[]> = {};
  for (const item of result.Items ?? []) {
    const sk = item.sk as string; // ASSIGN#<name>#<tagId>
    const withoutPrefix = sk.slice('ASSIGN#'.length);
    const lastHash = withoutPrefix.lastIndexOf('#');
    const name = withoutPrefix.slice(0, lastHash);
    const tagId = withoutPrefix.slice(lastHash + 1);
    if (!assignments[name]) assignments[name] = [];
    assignments[name].push(tagId);
  }

  return ok({ assignments });
}

export async function createTag(body: unknown) {
  const { deviceId, label, color: requestedColor } = body as { deviceId?: string; label?: string; color?: string };
  if (!deviceId || !label) return err(400, 'deviceId and label are required');

  let color = requestedColor && TAG_COLORS.includes(requestedColor) ? requestedColor : null;
  if (!color) {
    const existing = await ddb.send(new QueryCommand({
      TableName: TAGS_TABLE,
      KeyConditionExpression: 'deviceId = :d AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':d': deviceId, ':prefix': 'DEF#' },
      Select: 'COUNT',
    }));
    color = TAG_COLORS[(existing.Count ?? 0) % TAG_COLORS.length];
  }
  const tagId = randomUUID();

  await ddb.send(new PutCommand({
    TableName: TAGS_TABLE,
    Item: { deviceId, sk: `DEF#${tagId}`, tagId, label, color },
  }));

  return ok({ id: tagId, label, color });
}

export async function deleteTag(tagId: string, params: Params) {
  const { deviceId } = params;
  if (!deviceId) return err(400, 'deviceId is required');

  const result = await ddb.send(new QueryCommand({
    TableName: TAGS_TABLE,
    KeyConditionExpression: 'deviceId = :d',
    ExpressionAttributeValues: { ':d': deviceId },
  }));

  const toDelete = (result.Items ?? []).filter(item => {
    const sk = item.sk as string;
    return sk === `DEF#${tagId}` || sk.endsWith(`#${tagId}`);
  });

  for (const item of toDelete) {
    await ddb.send(new DeleteCommand({
      TableName: TAGS_TABLE,
      Key: { deviceId, sk: item.sk as string },
    }));
  }

  return ok({ ok: true });
}

export async function setNameTags(name: string, body: unknown) {
  const { deviceId, tagIds } = body as { deviceId?: string; tagIds?: string[] };
  if (!deviceId || !Array.isArray(tagIds)) return err(400, 'deviceId and tagIds[] are required');

  const existing = await ddb.send(new QueryCommand({
    TableName: TAGS_TABLE,
    KeyConditionExpression: 'deviceId = :d AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':d': deviceId, ':prefix': `ASSIGN#${name}#` },
  }));

  for (const item of existing.Items ?? []) {
    await ddb.send(new DeleteCommand({
      TableName: TAGS_TABLE,
      Key: { deviceId, sk: item.sk as string },
    }));
  }

  for (const tagId of tagIds) {
    await ddb.send(new PutCommand({
      TableName: TAGS_TABLE,
      Item: { deviceId, sk: `ASSIGN#${name}#${tagId}`, name, tagId },
    }));
  }

  return ok({ ok: true });
}
