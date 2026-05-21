import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../db/dynamo';
import { getPool } from '../db/postgres';
import { ok, err } from '../utils';

const TAGS_TABLE = process.env.TAGS_TABLE!;

/**
 * POST /auth/migrate
 * Reassigns all guest data (deviceId) to a Cognito user (cognitoSub).
 * Called once after the user's first sign-in. Idempotent.
 */
export async function migrateGuestData(body: Record<string, unknown>) {
  const { deviceId, cognitoSub } = body as { deviceId?: string; cognitoSub?: string };
  if (!deviceId || !cognitoSub) return err(400, 'deviceId and cognitoSub required');
  if (deviceId === cognitoSub) return ok({ migrated: false, reason: 'already migrated' });

  const pool = getPool();

  // RDS: UPDATE works because user_id is not a primary key column
  await Promise.all([
    pool.query('UPDATE user_swipes SET user_id = $1 WHERE user_id = $2', [cognitoSub, deviceId]),
    pool.query('UPDATE user_taste  SET user_id = $1 WHERE user_id = $2', [cognitoSub, deviceId]),
  ]);

  // DynamoDB NameTags: partition key cannot be updated — must copy then delete
  const { Items: tagItems = [] } = await ddb.send(new QueryCommand({
    TableName: TAGS_TABLE,
    KeyConditionExpression: 'deviceId = :d',
    ExpressionAttributeValues: { ':d': deviceId },
  }));

  if (tagItems.length > 0) {
    await Promise.all(
      tagItems.flatMap(item => [
        ddb.send(new PutCommand({
          TableName: TAGS_TABLE,
          Item: { ...item, deviceId: cognitoSub },
        })),
        ddb.send(new DeleteCommand({
          TableName: TAGS_TABLE,
          Key: { deviceId, sk: item.sk },
        })),
      ]),
    );
  }

  return ok({ migrated: true, tagsMigrated: tagItems.length });
}
