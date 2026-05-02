import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getNames, getName, searchNames } from './routes/names';
import { getPopularity } from './routes/popularity';
import { err } from './utils';

type Params = Record<string, string | undefined>;

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { httpMethod: method, path, queryStringParameters } = event;
  const params = (queryStringParameters ?? {}) as Params;

  try {
    if (method === 'GET' && path === '/names/search') {
      return await searchNames(params);
    }

    const popularityMatch = path.match(/^\/names\/([^/]+)\/popularity$/);
    if (method === 'GET' && popularityMatch) {
      return await getPopularity(decodeURIComponent(popularityMatch[1]), params);
    }

    const nameMatch = path.match(/^\/names\/([^/]+)$/);
    if (method === 'GET' && nameMatch) {
      return await getName(decodeURIComponent(nameMatch[1]));
    }

    if (method === 'GET' && path === '/names') {
      return await getNames(params);
    }

    return err(404, 'Not found');
  } catch (e) {
    console.error(e);
    return err(500, 'Internal server error');
  }
}
