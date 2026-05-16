import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { chatHandler } from './routes/ai';
import { err } from './utils';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { httpMethod: method, path } = event;

  try {
    if (method === 'POST' && path === '/ai/chat') {
      const body = event.body ? JSON.parse(event.body) : {};
      return await chatHandler(body);
    }
    return err(404, 'Not found');
  } catch (e) {
    console.error(e);
    return err(500, 'Internal server error');
  }
}
