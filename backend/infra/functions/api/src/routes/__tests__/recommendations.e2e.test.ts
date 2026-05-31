/**
 * E2E tests for the swipe + recommendations API. Runs against the deployed API.
 * Uses a unique deviceId per run so test data never touches real users.
 *
 * Run with: npm run test:e2e
 */

export {}; // make this a module so top-level consts don't collide with tags.e2e.test.ts

jest.setTimeout(60_000);

const BASE   = process.env.API_BASE ?? 'https://2e5o06c9e6.execute-api.us-east-1.amazonaws.com/prod';
const DEVICE = `e2e-rec-${Date.now()}`;
const SEX    = 'F';

// Common 2025-popular names that should reliably exist in name_vectors.
const NAME_A = 'Emma';
const NAME_B = 'Olivia';
const NAME_C = 'Ava';

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

const swipedNames = async (deviceId: string, liked: boolean): Promise<string[]> => {
  const r = await api('GET', `/swipes?deviceId=${deviceId}&liked=${liked}&sex=${SEX}`);
  expect(r.status).toBe(200);
  return r.body.names as string[];
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe('swipe and recommendation lifecycle', () => {
  it('GET /recommendations on a cold device returns names (phase 0 path)', async () => {
    const r = await api('GET', `/recommendations?deviceId=${DEVICE}&sex=${SEX}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.names)).toBe(true);
    expect(r.body.names.length).toBeGreaterThan(0);
  });

  it('POST /swipe (like) is persisted to /swipes?liked=true', async () => {
    const r = await api('POST', '/swipe', {
      deviceId: DEVICE, name: NAME_A, liked: true, sex_context: SEX,
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    const liked = await swipedNames(DEVICE, true);
    expect(liked).toContain(NAME_A);
  });

  it('POST /swipe (dislike) is persisted to /swipes?liked=false', async () => {
    const r = await api('POST', '/swipe', {
      deviceId: DEVICE, name: NAME_B, liked: false, sex_context: SEX,
    });
    expect(r.status).toBe(200);

    const disliked = await swipedNames(DEVICE, false);
    expect(disliked).toContain(NAME_B);
  });

  it('regression #2: flipping like → dislike moves the name between lists (no double-count)', async () => {
    // NAME_A was liked above; flip to dislike.
    const r = await api('POST', '/swipe', {
      deviceId: DEVICE, name: NAME_A, liked: false, sex_context: SEX,
    });
    expect(r.status).toBe(200);

    const liked    = await swipedNames(DEVICE, true);
    const disliked = await swipedNames(DEVICE, false);
    // Must appear in exactly one list (the new direction), not both.
    expect(liked).not.toContain(NAME_A);
    expect(disliked).toContain(NAME_A);
  });

  it('regression #2: flipping dislike → like moves the name back', async () => {
    // NAME_B was disliked above; flip to like.
    const r = await api('POST', '/swipe', {
      deviceId: DEVICE, name: NAME_B, liked: true, sex_context: SEX,
    });
    expect(r.status).toBe(200);

    const liked    = await swipedNames(DEVICE, true);
    const disliked = await swipedNames(DEVICE, false);
    expect(liked).toContain(NAME_B);
    expect(disliked).not.toContain(NAME_B);
  });

  it('same-direction re-swipe is idempotent (no duplicate rows)', async () => {
    // Re-like NAME_B (already liked from previous test).
    await api('POST', '/swipe', { deviceId: DEVICE, name: NAME_B, liked: true, sex_context: SEX });
    await api('POST', '/swipe', { deviceId: DEVICE, name: NAME_B, liked: true, sex_context: SEX });

    const liked = await swipedNames(DEVICE, true);
    const occurrences = liked.filter(n => n === NAME_B).length;
    expect(occurrences).toBe(1);
  });

  it('swiped names are excluded from /recommendations', async () => {
    // Swipe NAME_C, then verify it doesn't reappear in subsequent recommendation calls.
    await api('POST', '/swipe', { deviceId: DEVICE, name: NAME_C, liked: true, sex_context: SEX });
    // Multiple calls reduce flakiness: even if a particular call's randomness would
    // include NAME_C, the swipe-exclusion filter is deterministic.
    for (let i = 0; i < 3; i++) {
      const r = await api('GET', `/recommendations?deviceId=${DEVICE}&sex=${SEX}`);
      expect(r.status).toBe(200);
      const names = r.body.names.map((n: { name: string }) => n.name);
      expect(names).not.toContain(NAME_C);
    }
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('swipe validation', () => {
  const VALIDATION_DEVICE = `e2e-rec-val-${Date.now()}`;

  it('POST /swipe returns 400 when name is missing', async () => {
    const r = await api('POST', '/swipe', {
      deviceId: VALIDATION_DEVICE, liked: true, sex_context: SEX,
    });
    expect(r.status).toBe(400);
  });

  it('POST /swipe returns 400 when liked is missing', async () => {
    const r = await api('POST', '/swipe', {
      deviceId: VALIDATION_DEVICE, name: NAME_A, sex_context: SEX,
    });
    expect(r.status).toBe(400);
  });

  it('POST /swipe returns 400 when liked is not a boolean', async () => {
    const r = await api('POST', '/swipe', {
      deviceId: VALIDATION_DEVICE, name: NAME_A, liked: 'yes', sex_context: SEX,
    });
    expect(r.status).toBe(400);
  });

  it('POST /swipe returns 404 for a non-existent name', async () => {
    const r = await api('POST', '/swipe', {
      deviceId: VALIDATION_DEVICE, name: 'Zzzqqqxxx', liked: true, sex_context: SEX,
    });
    expect(r.status).toBe(404);
  });

  it('GET /recommendations returns 400 when deviceId is missing', async () => {
    const r = await api('GET', `/recommendations?sex=${SEX}`);
    expect(r.status).toBe(400);
  });
});

// ── Partner pairing ──────────────────────────────────────────────────────────

describe('partner pairing smoke test', () => {
  const DEVICE_A = `e2e-rec-pair-A-${Date.now()}`;
  const DEVICE_B = `e2e-rec-pair-B-${Date.now()}`;
  let listId: string;
  let code: string;

  it('partner A creates a list', async () => {
    const r = await api('POST', '/lists', { deviceId: DEVICE_A });
    expect(r.status).toBe(200);
    listId = r.body.listId;
    code   = r.body.code;
    expect(typeof listId).toBe('string');
    expect(typeof code).toBe('string');
  });

  it('partner B joins via code', async () => {
    const r = await api('POST', '/lists/join', { code, deviceId: DEVICE_B });
    expect(r.status).toBe(200);
    expect(r.body.listId).toBe(listId);
  });

  it('both partners can record swipes', async () => {
    const rA = await api('POST', '/swipe', {
      deviceId: DEVICE_A, name: NAME_A, liked: true, sex_context: SEX,
    });
    const rB = await api('POST', '/swipe', {
      deviceId: DEVICE_B, name: NAME_B, liked: true, sex_context: SEX,
    });
    expect(rA.status).toBe(200);
    expect(rB.status).toBe(200);
  });

  it('both partners get recommendations while paired (regression #1: partner blend stays on)', async () => {
    // With only 1 like each, both are still on the phase-0 path — this isn't a
    // direct test of the partner blend, but it confirms the paired endpoints
    // respond cleanly. The deep partner-blend logic is covered by the unit
    // test "regression: partner blending is NOT silently dropped at k > 1".
    const rA = await api('GET', `/recommendations?deviceId=${DEVICE_A}&sex=${SEX}&listId=${listId}`);
    const rB = await api('GET', `/recommendations?deviceId=${DEVICE_B}&sex=${SEX}&listId=${listId}`);
    expect(rA.status).toBe(200);
    expect(rB.status).toBe(200);
    expect(rA.body.names.length).toBeGreaterThan(0);
    expect(rB.body.names.length).toBeGreaterThan(0);
  });
});
