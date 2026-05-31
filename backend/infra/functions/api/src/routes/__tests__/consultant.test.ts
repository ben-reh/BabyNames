/**
 * Unit tests for the consultant session and feedback routes.
 * DB, DynamoDB, and Bedrock are fully mocked — no network.
 */

// ── Mocks (hoisted by Jest before any imports) ────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../../db/postgres', () => ({
  getPool: () => ({ query: (...args: unknown[]) => mockQuery(...args) }),
}));

const mockDdbSend = jest.fn();
jest.mock('../../db/dynamo', () => ({
  ddb: { send: (...args: unknown[]) => mockDdbSend(...args) },
  TABLE: 'Names',
  ORIGIN_INDEX: 'origin-index',
}));

const mockBedrockSend = jest.fn();
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: (...args: unknown[]) => mockBedrockSend(...args) })),
  ConverseCommand: jest.fn((p: unknown) => p),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { consultantSession } from '../consultant/session';
import { recordConsultantFeedback } from '../consultant/feedback';

// ── Constants & helpers ───────────────────────────────────────────────────────

const DEVICE  = 'consultant-test-device';
const FAKE_EMB = '[0.01,0.02,0.03]';

function sqlCalls(): string[] {
  return mockQuery.mock.calls.map((c) => c[0] as string);
}

function retrievalSql(): string | undefined {
  return sqlCalls().find(
    (s) => s.includes('np.count DESC') || s.includes('nv.embedding <=>'),
  );
}

function bedrockResponse(text: string) {
  return Promise.resolve({ output: { message: { content: [{ text }] } } });
}

const VALID_DESCRIPTIONS = '[{"name":"Emma","description":"A perfect fit for your taste."}]';
const VALID_VIBE         = '{"originBoosts":[],"popularityTierShift":0,"syllablePreference":null,"notes":""}';
const PROFILE_PROSE      = 'You seem drawn to elegant vintage names.';

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
  mockDdbSend.mockReset();
  mockBedrockSend.mockReset();

  // Default DB: no taste vector, no swipes, cold-start retrieval returns Emma
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes('FROM user_taste'))       return Promise.resolve({ rows: [] });
    if (sql.includes('liked = true'))          return Promise.resolve({ rows: [] });
    if (sql.includes('liked = false'))         return Promise.resolve({ rows: [] });
    if (sql.includes('np.count DESC'))    return Promise.resolve({ rows: [{ name: 'Emma' }] });
    if (sql.includes('nv.embedding <=>')) return Promise.resolve({ rows: [{ name: 'Emma' }] });
    return Promise.resolve({ rows: [] });
  });

  // Default DDB: BatchGet echoes keys back as name-metadata items; GetCommand returns nothing
  mockDdbSend.mockImplementation((cmd: unknown) => {
    const ri = (cmd as Record<string, unknown> & { input?: Record<string, unknown> }).input?.RequestItems as
      Record<string, { Keys: { name: string }[] }> | undefined;
    if (ri) {
      const [[table, { Keys }]] = Object.entries(ri);
      const items = Keys.map((k) => ({
        name: k.name, sex: 'F', origin: 'French', year_peak: 1920, rank: 50,
      }));
      return Promise.resolve({ Responses: { [table]: items } });
    }
    return Promise.resolve({ Item: undefined });
  });

  // Default Bedrock: discriminate calls by maxTokens
  mockBedrockSend.mockImplementation((cmd: Record<string, unknown>) => {
    const maxTokens = (cmd.inferenceConfig as { maxTokens?: number } | undefined)?.maxTokens;
    if (maxTokens === 700) return bedrockResponse(VALID_DESCRIPTIONS);
    if (maxTokens === 300) return bedrockResponse(VALID_VIBE);
    return bedrockResponse(PROFILE_PROSE); // 200 → profile summary
  });
});

// ── consultantSession ─────────────────────────────────────────────────────────

describe('consultantSession', () => {
  it('returns 400 when deviceId is missing', async () => {
    const r = await consultantSession({});
    expect(r.statusCode).toBe(400);
  });

  it('cold start: no taste row → popularity-order SQL, no ANN', async () => {
    const r = await consultantSession({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);
    expect(sqlCalls().some((s) => s.includes('np.count DESC'))).toBe(true);
    expect(sqlCalls().some((s) => s.includes('<=>'))          ).toBe(false);
  });

  it('with taste vector → ANN SQL, no popularity fallback', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMB, liked_count: 5, disliked_count: 1 }] });
      if (sql.includes('liked = true'))    return Promise.resolve({ rows: [] });
      if (sql.includes('liked = false'))   return Promise.resolve({ rows: [] });
      if (sql.includes('nv.embedding <=>')) return Promise.resolve({ rows: [{ name: 'Emma' }] });
      return Promise.resolve({ rows: [] });
    });

    const r = await consultantSession({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);
    expect(sqlCalls().some((s) => s.includes('<=>'))         ).toBe(true);
    expect(sqlCalls().some((s) => s.includes('np.count DESC'))).toBe(false);
  });

  it('sex=F → retrieval SQL filters by female_count', async () => {
    const r = await consultantSession({ deviceId: DEVICE, sex: 'F' });
    expect(r.statusCode).toBe(200);
    expect(retrievalSql()).toContain('np.female_count >= 100');
  });

  it('sex=M → retrieval SQL filters by male count', async () => {
    const r = await consultantSession({ deviceId: DEVICE, sex: 'M' });
    expect(r.statusCode).toBe(200);
    expect(retrievalSql()).toContain('np.count - np.female_count');
  });

  it('no sex provided → no sex filter in retrieval SQL', async () => {
    const r = await consultantSession({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);
    const sql = retrievalSql() ?? '';
    expect(sql).not.toContain('np.female_count >= 100');
    expect(sql).not.toContain('np.count - np.female_count');
  });

  it('no swipes → default profile summary returned, Bedrock profile model not called', async () => {
    const r = await consultantSession({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);

    const body = JSON.parse(r.body);
    expect(body.profileSummary).toContain("You're just getting started");

    const profileModelCalls = mockBedrockSend.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown> & { inferenceConfig?: { maxTokens?: number } }).inferenceConfig?.maxTokens === 200,
    );
    expect(profileModelCalls).toHaveLength(0);
  });

  it('with liked swipes → Bedrock profile model is called once', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))     return Promise.resolve({ rows: [] });
      if (sql.includes('liked = true'))    return Promise.resolve({ rows: [{ name: 'Eleanor' }] });
      if (sql.includes('liked = false'))   return Promise.resolve({ rows: [] });
      if (sql.includes('np.count DESC'))   return Promise.resolve({ rows: [{ name: 'Emma' }] });
      return Promise.resolve({ rows: [] });
    });

    const r = await consultantSession({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);

    const profileModelCalls = mockBedrockSend.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown> & { inferenceConfig?: { maxTokens?: number } }).inferenceConfig?.maxTokens === 200,
    );
    expect(profileModelCalls).toHaveLength(1);
  });

  it('vibeText present → vibe translation model is called once', async () => {
    const r = await consultantSession({
      deviceId: DEVICE,
      vibeText: 'something unusual with a nature feel',
    });
    expect(r.statusCode).toBe(200);

    const vibeCalls = mockBedrockSend.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown> & { inferenceConfig?: { maxTokens?: number } }).inferenceConfig?.maxTokens === 300,
    );
    expect(vibeCalls).toHaveLength(1);
  });

  it('no vibeText → vibe translation model is not called', async () => {
    const r = await consultantSession({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);

    const vibeCalls = mockBedrockSend.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown> & { inferenceConfig?: { maxTokens?: number } }).inferenceConfig?.maxTokens === 300,
    );
    expect(vibeCalls).toHaveLength(0);
  });

  it('response has correct shape: profileSummary, partnerSummary null, names with required fields', async () => {
    const r = await consultantSession({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);

    const body = JSON.parse(r.body);
    expect(typeof body.profileSummary).toBe('string');
    expect(body.partnerSummary).toBeNull();
    expect(Array.isArray(body.names)).toBe(true);

    if (body.names.length > 0) {
      const first = body.names[0];
      expect(typeof first.name).toBe('string');
      expect(typeof first.gender).toBe('string');
      expect(typeof first.origin).toBe('string');
      expect(typeof first.description).toBe('string');
    }
  });

  it('with listId → DDB GetCommand fires for partner list lookup', async () => {
    const r = await consultantSession({ deviceId: DEVICE, listId: 'list-abc-123' });
    expect(r.statusCode).toBe(200);

    // GetCommand has input.Key (not input.RequestItems)
    const getCalls = mockDdbSend.mock.calls.filter((c) => {
      const input = (c[0] as Record<string, unknown> & { input?: Record<string, unknown> }).input;
      return input?.Key !== undefined && input?.RequestItems === undefined;
    });
    expect(getCalls.length).toBeGreaterThan(0);
  });

  it('Bedrock descriptions model always called, even on cold start', async () => {
    const r = await consultantSession({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);

    const descCalls = mockBedrockSend.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown> & { inferenceConfig?: { maxTokens?: number } }).inferenceConfig?.maxTokens === 700,
    );
    expect(descCalls).toHaveLength(1);
  });
});

// ── recordConsultantFeedback ──────────────────────────────────────────────────

describe('recordConsultantFeedback', () => {
  it('returns 400 when deviceId is missing', async () => {
    const r = await recordConsultantFeedback({ likes: [], passes: [] });
    expect(r.statusCode).toBe(400);
  });

  it('returns 400 when likes is not an array', async () => {
    const r = await recordConsultantFeedback({ deviceId: DEVICE, likes: 'Emma', passes: [] });
    expect(r.statusCode).toBe(400);
  });

  it('returns 400 when passes is not an array', async () => {
    const r = await recordConsultantFeedback({ deviceId: DEVICE, likes: [], passes: 'Olivia' });
    expect(r.statusCode).toBe(400);
  });

  it('returns 200 immediately when both arrays are empty — no DB calls', async () => {
    const r = await recordConsultantFeedback({ deviceId: DEVICE, likes: [], passes: [] });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('names absent from name_vectors are silently skipped — no swipe upsert or taste update', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM name_vectors')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const r = await recordConsultantFeedback({ deviceId: DEVICE, likes: ['Xzqjvp'], passes: [] });
    expect(r.statusCode).toBe(200);
    expect(sqlCalls().some((s) => s.includes('INSERT INTO user_swipes'))).toBe(false);
    expect(sqlCalls().some((s) => s.includes('INSERT INTO user_taste'))).toBe(false);
  });

  it('like: swipe upsert fires and liked_count reaches 1 from cold start', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM name_vectors'))
        return Promise.resolve({ rows: [{ name: 'Emma', embedding: FAKE_EMB }] });
      if (sql.includes('FROM user_taste')) return Promise.resolve({ rows: [] }); // no prior taste
      return Promise.resolve({ rows: [] });
    });

    const r = await recordConsultantFeedback({ deviceId: DEVICE, likes: ['Emma'], passes: [] });
    expect(r.statusCode).toBe(200);

    expect(sqlCalls().some((s) => s.includes('INSERT INTO user_swipes'))).toBe(true);

    const tasteCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO user_taste'),
    );
    expect(tasteCall).toBeDefined();
    expect(tasteCall![1][3]).toBe(1); // likedCount = 1
    expect(tasteCall![1][4]).toBe(0); // dislikedCount = 0
  });

  it('pass: disliked_count reaches 1 from cold start', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM name_vectors'))
        return Promise.resolve({ rows: [{ name: 'Olivia', embedding: FAKE_EMB }] });
      if (sql.includes('FROM user_taste')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const r = await recordConsultantFeedback({ deviceId: DEVICE, likes: [], passes: ['Olivia'] });
    expect(r.statusCode).toBe(200);

    const tasteCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO user_taste'),
    );
    expect(tasteCall).toBeDefined();
    expect(tasteCall![1][3]).toBe(0); // likedCount = 0
    expect(tasteCall![1][4]).toBe(1); // dislikedCount = 1
  });

  it('mixed likes + passes: both are counted correctly', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM name_vectors'))
        return Promise.resolve({
          rows: [
            { name: 'Emma', embedding: FAKE_EMB },
            { name: 'Olivia', embedding: FAKE_EMB },
          ],
        });
      if (sql.includes('FROM user_taste')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const r = await recordConsultantFeedback({
      deviceId: DEVICE,
      likes: ['Emma'],
      passes: ['Olivia'],
    });
    expect(r.statusCode).toBe(200);

    const tasteCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO user_taste'),
    );
    expect(tasteCall).toBeDefined();
    expect(tasteCall![1][3]).toBe(1); // likedCount
    expect(tasteCall![1][4]).toBe(1); // dislikedCount
  });

  it('uses the provided sex as sex_context', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM name_vectors'))
        return Promise.resolve({ rows: [{ name: 'Emma', embedding: FAKE_EMB }] });
      if (sql.includes('FROM user_taste')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await recordConsultantFeedback({ deviceId: DEVICE, likes: ['Emma'], passes: [], sex: 'F' });

    const swipeCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO user_swipes'),
    );
    expect(swipeCall).toBeDefined();
    const params = swipeCall![1] as unknown[];
    expect(params).toContain('F');
    expect(params).not.toContain('U');
  });

  it('defaults sex_context to "U" when no sex is provided', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM name_vectors'))
        return Promise.resolve({ rows: [{ name: 'Emma', embedding: FAKE_EMB }] });
      if (sql.includes('FROM user_taste')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await recordConsultantFeedback({ deviceId: DEVICE, likes: ['Emma'], passes: [] });

    const swipeCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO user_swipes'),
    );
    expect(swipeCall).toBeDefined();
    const params = swipeCall![1] as unknown[];
    expect(params).toContain('U');
  });
});
