/**
 * E2E tests for the consultant session and feedback API endpoints.
 * Runs against the deployed API (hits real Bedrock Nova models).
 *
 * Run with: npm run test:e2e
 */

export {}; // prevent top-level consts from colliding with other e2e files

jest.setTimeout(60_000);

const BASE   = process.env.API_BASE ?? 'https://2e5o06c9e6.execute-api.us-east-1.amazonaws.com/prod';
const DEVICE = `e2e-consultant-${Date.now()}`;

// Common names with reliable name_vectors entries
const NAME_A = 'Emma';
const NAME_B = 'Olivia';
const NAME_C = 'Ava';

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

async function api(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// ── /consultant/session ────────────────────────────────────────────────────────

describe('POST /consultant/session', () => {
  it('cold device returns 200 with correct shape', async () => {
    const r = await api('POST', '/consultant/session', { deviceId: DEVICE });
    expect(r.status).toBe(200);

    const { profileSummary, partnerSummary, names } = r.body as {
      profileSummary: string;
      partnerSummary: string | null;
      names: { name: string; gender: string; origin: string; description: string }[];
    };

    expect(typeof profileSummary).toBe('string');
    expect(profileSummary.length).toBeGreaterThan(0);
    expect(partnerSummary === null || typeof partnerSummary === 'string').toBe(true);
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);

    const first = names[0];
    expect(typeof first.name).toBe('string');
    expect(['girl', 'boy', 'unisex']).toContain(first.gender);
    expect(typeof first.origin).toBe('string');
    expect(typeof first.description).toBe('string');
  });

  it('cold device with no swipes → default profile summary', async () => {
    const freshDevice = `e2e-consultant-fresh-${Date.now()}`;
    const r = await api('POST', '/consultant/session', { deviceId: freshDevice });
    expect(r.status).toBe(200);

    const { profileSummary } = r.body as { profileSummary: string };
    expect(profileSummary).toContain("You're just getting started");
  });

  it('sex=F returns 200 with no boy-only names in results', async () => {
    const r = await api('POST', '/consultant/session', { deviceId: DEVICE, sex: 'F' });
    expect(r.status).toBe(200);

    const names = r.body.names as { name: string; gender: string }[];
    expect(names.length).toBeGreaterThan(0);
    // sex=F filter (female_pct >= 0.05) should exclude strongly male names
    const boyNames = names.filter((n) => n.gender === 'boy');
    expect(boyNames).toHaveLength(0);
  });

  it('sex=M returns 200 with no girl-only names in results', async () => {
    const r = await api('POST', '/consultant/session', { deviceId: DEVICE, sex: 'M' });
    expect(r.status).toBe(200);

    const names = r.body.names as { name: string; gender: string }[];
    expect(names.length).toBeGreaterThan(0);
    const girlNames = names.filter((n) => n.gender === 'girl');
    expect(girlNames).toHaveLength(0);
  });

  it('vibeText provided → returns 200 with populated names list', async () => {
    const r = await api('POST', '/consultant/session', {
      deviceId: DEVICE,
      vibeText: 'something timeless and classic',
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.names)).toBe(true);
    expect((r.body.names as unknown[]).length).toBeGreaterThan(0);
  });

  it('missing deviceId → 400', async () => {
    const r = await api('POST', '/consultant/session', {});
    expect(r.status).toBe(400);
  });
});

// ── /consultant/feedback ───────────────────────────────────────────────────────

describe('POST /consultant/feedback', () => {
  it('likes and passes recorded successfully → 200 ok', async () => {
    const r = await api('POST', '/consultant/feedback', {
      deviceId: DEVICE,
      likes: [NAME_A],
      passes: [NAME_B],
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('empty arrays → 200 ok', async () => {
    const r = await api('POST', '/consultant/feedback', {
      deviceId: DEVICE,
      likes: [],
      passes: [],
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('missing deviceId → 400', async () => {
    const r = await api('POST', '/consultant/feedback', {
      likes: [NAME_A],
      passes: [],
    });
    expect(r.status).toBe(400);
  });
});

// ── Lifecycle: feedback → session ─────────────────────────────────────────────

describe('consultant lifecycle', () => {
  const lifecycleDevice = `e2e-consultant-lifecycle-${Date.now()}`;

  it('after recording likes via feedback, session returns a model-generated profile summary', async () => {
    // Seed taste with three liked names, sex='F' so session can find them
    const feedbackRes = await api('POST', '/consultant/feedback', {
      deviceId: lifecycleDevice,
      likes: [NAME_A, NAME_B, NAME_C],
      passes: [],
      sex: 'F',
    });
    expect(feedbackRes.status).toBe(200);

    // Session with sex='F' → sexCtx='F' → finds swipes seeded above
    const sessionRes = await api('POST', '/consultant/session', {
      deviceId: lifecycleDevice,
      sex: 'F',
    });
    expect(sessionRes.status).toBe(200);

    const { profileSummary } = sessionRes.body as { profileSummary: string };
    expect(typeof profileSummary).toBe('string');
    expect(profileSummary).not.toContain("You're just getting started");
  });

  it('liked names from feedback do not reappear in subsequent session results', async () => {
    const sessionRes = await api('POST', '/consultant/session', {
      deviceId: lifecycleDevice,
      sex: 'F',
    });
    expect(sessionRes.status).toBe(200);

    const names = (sessionRes.body.names as { name: string }[]).map((n) => n.name);
    expect(names).not.toContain(NAME_A);
    expect(names).not.toContain(NAME_B);
    expect(names).not.toContain(NAME_C);
  });
});
