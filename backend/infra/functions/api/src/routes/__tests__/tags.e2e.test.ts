/**
 * E2E tests for the name tags API. Runs against the deployed API.
 * Uses a unique deviceId per run so test data never touches real users.
 *
 * Run with: npm run test:e2e
 */

jest.setTimeout(30_000);

const BASE = process.env.API_BASE ?? 'https://2e5o06c9e6.execute-api.us-east-1.amazonaws.com/prod';
const DEVICE = `e2e-tags-${Date.now()}`;

interface ApiResponse {
  status: number;
  body: Record<string, any>;
}

async function api(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

// ── Tag CRUD lifecycle ────────────────────────────────────────────────────────

describe('tag CRUD lifecycle', () => {
  let tagId1: string;
  let tagId2: string;

  it('GET /tags is empty for a fresh device', async () => {
    const r = await api('GET', `/tags?deviceId=${DEVICE}`);
    expect(r.status).toBe(200);
    expect(r.body.tags).toEqual([]);
  });

  it('POST /tags creates a tag with an explicit palette color', async () => {
    const r = await api('POST', '/tags', { deviceId: DEVICE, label: 'E2E Blue', color: '#5B8DEF' });
    expect(r.status).toBe(200);
    expect(r.body.label).toBe('E2E Blue');
    expect(r.body.color).toBe('#5B8DEF');
    expect(typeof r.body.id).toBe('string');
    tagId1 = r.body.id;
  });

  it('POST /tags auto-assigns a color when none is provided', async () => {
    const r = await api('POST', '/tags', { deviceId: DEVICE, label: 'E2E Auto' });
    expect(r.status).toBe(200);
    expect(r.body.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    tagId2 = r.body.id;
  });

  it('GET /tags returns both created tags', async () => {
    const r = await api('GET', `/tags?deviceId=${DEVICE}`);
    expect(r.status).toBe(200);
    const ids = r.body.tags.map((t: any) => t.id);
    expect(ids).toContain(tagId1);
    expect(ids).toContain(tagId2);
  });

  it('GET /tags/assignments is empty before any assignments', async () => {
    const r = await api('GET', `/tags/assignments?deviceId=${DEVICE}`);
    expect(r.status).toBe(200);
    expect(r.body.assignments).toEqual({});
  });

  it('PUT /names/Emma/tags assigns custom and predefined tags', async () => {
    const r = await api('PUT', '/names/Emma/tags', {
      deviceId: DEVICE,
      tagIds: [tagId1, 'favorite'],
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('GET /tags/assignments reflects the assignment', async () => {
    const r = await api('GET', `/tags/assignments?deviceId=${DEVICE}`);
    expect(r.status).toBe(200);
    expect(r.body.assignments.Emma).toEqual(expect.arrayContaining([tagId1, 'favorite']));
  });

  it('PUT /names/Emma/tags replaces (not appends) assignments', async () => {
    const r = await api('PUT', '/names/Emma/tags', {
      deviceId: DEVICE,
      tagIds: ['family-name'],
    });
    expect(r.status).toBe(200);

    const check = await api('GET', `/tags/assignments?deviceId=${DEVICE}`);
    expect(check.body.assignments.Emma).toEqual(['family-name']);
  });

  it('DELETE /tags cascades: removes tag def and its assignment from Emma', async () => {
    // First re-assign tagId1 so it appears in Emma's assignments
    await api('PUT', '/names/Emma/tags', { deviceId: DEVICE, tagIds: [tagId1, 'favorite'] });

    const r = await api('DELETE', `/tags/${tagId1}?deviceId=${DEVICE}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    // tagId1 gone from defs
    const defs = await api('GET', `/tags?deviceId=${DEVICE}`);
    expect(defs.body.tags.map((t: any) => t.id)).not.toContain(tagId1);

    // tagId1 gone from assignments; predefined 'favorite' still present
    const assigns = await api('GET', `/tags/assignments?deviceId=${DEVICE}`);
    const emma = assigns.body.assignments.Emma ?? [];
    expect(emma).not.toContain(tagId1);
    expect(emma).toContain('favorite');
  });

  it('PUT /names/Emma/tags with empty array clears all assignments', async () => {
    const r = await api('PUT', '/names/Emma/tags', { deviceId: DEVICE, tagIds: [] });
    expect(r.status).toBe(200);

    const check = await api('GET', `/tags/assignments?deviceId=${DEVICE}`);
    expect(check.body.assignments.Emma ?? []).toHaveLength(0);
  });

  afterAll(async () => {
    if (tagId2) await api('DELETE', `/tags/${tagId2}?deviceId=${DEVICE}`);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('validation', () => {
  it('POST /tags returns 400 when label is missing', async () => {
    const r = await api('POST', '/tags', { deviceId: DEVICE });
    expect(r.status).toBe(400);
  });

  it('POST /tags returns 400 when deviceId is missing', async () => {
    const r = await api('POST', '/tags', { label: 'Oops' });
    expect(r.status).toBe(400);
  });

  it('PUT /names/{name}/tags returns 400 when tagIds is not an array', async () => {
    const r = await api('PUT', '/names/Emma/tags', { deviceId: DEVICE, tagIds: 'favorite' });
    expect(r.status).toBe(400);
  });
});

// ── Partner tags ──────────────────────────────────────────────────────────────

describe('partner tags', () => {
  it('returns 403 when deviceId is not a member of the list', async () => {
    const r = await api('GET', `/lists/non-existent-list/partner-tags?deviceId=${DEVICE}`);
    // either 404 (list not found) or 403 (not a partner) — both are correct rejections
    expect([403, 404]).toContain(r.status);
  });
});
