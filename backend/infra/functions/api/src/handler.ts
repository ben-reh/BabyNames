import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getNames, getName, searchNames } from './routes/names';
import { getPopularity } from './routes/popularity';
import { createList, joinList, getList, addName, removeName } from './routes/lists';
import { err } from './utils';

type Params = Record<string, string | undefined>;

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { httpMethod: method, path, queryStringParameters } = event;
  const params = (queryStringParameters ?? {}) as Params;

  try {
    // --- Names routes ---
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

    // --- Lists routes ---
    if (method === 'POST' && path === '/lists') {
      return await createList(parseBody(event));
    }

    if (method === 'POST' && path === '/lists/join') {
      return await joinList(parseBody(event));
    }

    const listMatch = path.match(/^\/lists\/([^/]+)$/);
    if (method === 'GET' && listMatch) {
      return await getList(decodeURIComponent(listMatch[1]));
    }

    const listNamesMatch = path.match(/^\/lists\/([^/]+)\/names$/);
    if (method === 'POST' && listNamesMatch) {
      const body = parseBody(event);
      return await addName(decodeURIComponent(listNamesMatch[1]), body.name as string, body);
    }

    const listNameMatch = path.match(/^\/lists\/([^/]+)\/names\/([^/]+)$/);
    if (method === 'DELETE' && listNameMatch) {
      return await removeName(
        decodeURIComponent(listNameMatch[1]),
        decodeURIComponent(listNameMatch[2]),
        parseBody(event),
      );
    }

    return err(404, 'Not found');
  } catch (e) {
    console.error(e);
    return err(500, 'Internal server error');
  }
}
