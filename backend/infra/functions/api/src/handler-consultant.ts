import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { consultantSession } from './routes/consultant/session';
import { err } from './utils';

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { httpMethod: method, path } = event;

  try {
    if (method === 'POST' && path === '/consultant/session') {
      return await consultantSession(parseBody(event));
    }
    return err(404, 'Not found');
  } catch (e) {
    console.error(e);
    return err(500, 'Internal server error');
  }
}
