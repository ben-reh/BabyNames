import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getBatchNames, getNames, getName, getRankings, searchNames } from './routes/names';
import { getNameRank, getPopularity } from './routes/popularity';
import { createList, joinList, getList, addName, removeName } from './routes/lists';
import { getRecommendations, getUserSwipes, recordSwipe } from './routes/recommendations';
import { listTagDefs, listTagAssignments, createTag, deleteTag, setNameTags } from './routes/tags';
import { err } from './utils';

type Params = Record<string, string | undefined>;

function log(event: string, props: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...props }));
}

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
  const t0 = Date.now();

  const respond = (result: APIGatewayProxyResult, extra?: Record<string, unknown>) => {
    log('request', { method, path, status: result.statusCode, duration_ms: Date.now() - t0, ...extra });
    return result;
  };

  try {
    // --- Recommendations routes ---
    if (method === 'GET' && path === '/recommendations') {
      if (!params.deviceId) return respond(err(400, 'deviceId is required'));
      return respond(await getRecommendations(params.deviceId, params), { device_id: params.deviceId, sex: params.sex });
    }

    if (method === 'GET' && path === '/swipes') {
      if (!params.deviceId) return respond(err(400, 'deviceId is required'));
      const liked = params.liked !== 'false';
      return respond(await getUserSwipes(params.deviceId, liked, params.sex));
    }

    if (method === 'POST' && path === '/swipe') {
      const body = parseBody(event);
      if (!body.deviceId) return respond(err(400, 'deviceId is required'));
      return respond(await recordSwipe(body.deviceId as string, body), { name: body.name, liked: body.liked, sex_context: body.sex_context });
    }

    // --- Names routes ---
    if (method === 'GET' && path === '/names/search') {
      return respond(await searchNames(params), { q: params.q });
    }

    if (method === 'GET' && path === '/names/rankings') {
      return respond(await getRankings(params));
    }

    if (method === 'GET' && path === '/names/batch') {
      return respond(await getBatchNames(params));
    }

    const popularityMatch = path.match(/^\/names\/([^/]+)\/popularity$/);
    if (method === 'GET' && popularityMatch) {
      return respond(await getPopularity(decodeURIComponent(popularityMatch[1]), params));
    }

    const rankMatch = path.match(/^\/names\/([^/]+)\/rank$/);
    if (method === 'GET' && rankMatch) {
      return respond(await getNameRank(decodeURIComponent(rankMatch[1]), params));
    }

    const nameTagsMatch = path.match(/^\/names\/([^/]+)\/tags$/);
    if (method === 'PUT' && nameTagsMatch) {
      return respond(await setNameTags(decodeURIComponent(nameTagsMatch[1]), parseBody(event)));
    }

    const nameMatch = path.match(/^\/names\/([^/]+)$/);
    if (method === 'GET' && nameMatch) {
      return respond(await getName(decodeURIComponent(nameMatch[1])));
    }

    if (method === 'GET' && path === '/names') {
      return respond(await getNames(params));
    }

    // --- Tags routes ---
    if (method === 'GET' && path === '/tags') {
      return respond(await listTagDefs(params));
    }

    if (method === 'GET' && path === '/tags/assignments') {
      return respond(await listTagAssignments(params));
    }

    if (method === 'POST' && path === '/tags') {
      return respond(await createTag(parseBody(event)));
    }

    const tagIdMatch = path.match(/^\/tags\/([^/]+)$/);
    if (method === 'DELETE' && tagIdMatch) {
      return respond(await deleteTag(decodeURIComponent(tagIdMatch[1]), params));
    }

    // --- Lists routes ---
    if (method === 'POST' && path === '/lists') {
      return respond(await createList(parseBody(event)));
    }

    if (method === 'POST' && path === '/lists/join') {
      return respond(await joinList(parseBody(event)));
    }

    const listMatch = path.match(/^\/lists\/([^/]+)$/);
    if (method === 'GET' && listMatch) {
      return respond(await getList(decodeURIComponent(listMatch[1])));
    }

    const listNamesMatch = path.match(/^\/lists\/([^/]+)\/names$/);
    if (method === 'POST' && listNamesMatch) {
      const body = parseBody(event);
      return respond(await addName(decodeURIComponent(listNamesMatch[1]), body.name as string, body), { name: body.name });
    }

    const listNameMatch = path.match(/^\/lists\/([^/]+)\/names\/([^/]+)$/);
    if (method === 'DELETE' && listNameMatch) {
      return respond(await removeName(
        decodeURIComponent(listNameMatch[1]),
        decodeURIComponent(listNameMatch[2]),
        parseBody(event),
      ));
    }

    return respond(err(404, 'Not found'));
  } catch (e) {
    console.error(e);
    log('request', { method, path, status: 500, duration_ms: Date.now() - t0, error: String(e) });
    return err(500, 'Internal server error');
  }
}
