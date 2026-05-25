import { getRecommendations, recordSwipe } from '../recommendations';

const mockQuery = jest.fn();
jest.mock('../../db/postgres', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// Return requested items from BatchGet; ignore other DDB commands
jest.mock('../../db/dynamo', () => ({
  ddb: { send: jest.fn() },
  TABLE: 'Names',
  ORIGIN_INDEX: 'origin-index',
}));
const mockDdbSend = (jest.requireMock('../../db/dynamo') as { ddb: { send: jest.Mock } }).ddb.send;

jest.mock('../names', () => ({
  formatName: (item: Record<string, unknown>) => item,
}));

const FAKE_USER   = 'user-123';
const DIM         = 567;
const fakeEmb     = () => `[${Array(DIM).fill('0.01').join(',')}]`;
const FAKE_EMBEDDING = fakeEmb();

function sqlCalls() {
  return mockQuery.mock.calls.map(c => c[0] as string);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockDdbSend.mockReset();

  // Default pool.query returns empty (ensureSchema try/catch swallows errors)
  mockQuery.mockResolvedValue({ rows: [] });

  // DynamoDB BatchGet returns the requested keys as-is
  mockDdbSend.mockImplementation((cmd: { input?: { RequestItems?: Record<string, { Keys: { name: string }[] }> } }) => {
    const ri = cmd.input?.RequestItems;
    if (ri) {
      const [[table, { Keys }]] = Object.entries(ri);
      return Promise.resolve({ Responses: { [table]: Keys } });
    }
    return Promise.resolve({ Items: [] });
  });
});

// ─── getRecommendations ────────────────────────────────────────────────────

describe('getRecommendations', () => {
  it('phase 0 — log-weighted sample (no ANN) when no taste vector exists', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [] }); // no taste → phase 0
      if (sql.includes('LOG(np.count + 1)'))
        return Promise.resolve({ rows: [{ name: 'Emma' }, { name: 'Olivia' }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await getRecommendations(FAKE_USER, {});
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.names.length).toBeGreaterThan(0);

    expect(sqlCalls().some(s => s.includes('LOG(np.count + 1)'))).toBe(true);
    // ANN (<=> operator) must NOT appear — phase 0 never hits pgvector
    expect(sqlCalls().some(s => s.includes('<=>'))).toBe(false);
  });

  it('phase 0 — log-weighted sample (no ANN) when liked_count < 3', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING, liked_count: 2 }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await getRecommendations(FAKE_USER, {});
    expect(result.statusCode).toBe(200);

    expect(sqlCalls().some(s => s.includes('LOG(np.count + 1)'))).toBe(true);
    expect(sqlCalls().some(s => s.includes('<=>'))).toBe(false);
  });

  it('warm path — ANN query selects embedding column for reranker', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING, liked_count: 5 }] });
      // ANN query
      if (sql.includes('nv.embedding') && sql.includes('<=>'))
        return Promise.resolve({ rows: [{ name: 'Emma', embedding: FAKE_EMBEDDING }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await getRecommendations(FAKE_USER, {});

    expect(result.statusCode).toBe(200);
    const annSql = sqlCalls().find(s => s.includes('<=>') && s.includes('nv.embedding'));
    expect(annSql).toBeDefined();
    expect(annSql).toMatch(/nv\.embedding/);   // embedding fetched for reranking
    expect(annSql).toMatch(/user_swipes/);      // excludes already-swiped names
    expect(annSql).toMatch(/LIMIT/);
  });

  it('warm path — ANN query fetches ANN_FETCH_K=400 as SQL literal', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING, liked_count: 5 }] });
      return Promise.resolve({ rows: [] });
    });

    await getRecommendations(FAKE_USER, {});

    const annSql = sqlCalls().find(s => s.includes('<=>') && s.includes('nv.embedding'));
    expect(annSql).toBeDefined();
    // ANN_FETCH_K=400 is embedded as a literal (avoids $-param numbering conflict)
    expect(annSql).toMatch(/LIMIT\s+400/);
  });

  it('warm path — applies F sex filter in ANN query', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING, liked_count: 5 }] });
      return Promise.resolve({ rows: [] });
    });

    await getRecommendations(FAKE_USER, { sex: 'F' });

    const annSql = sqlCalls().find(s => s.includes('<=>') && s.includes('nv.embedding'));
    expect(annSql).toMatch(/female_pct/);
    expect(annSql).toMatch(/>=/);
  });

  it('warm path — applies M sex filter in ANN query', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING, liked_count: 5 }] });
      return Promise.resolve({ rows: [] });
    });

    await getRecommendations(FAKE_USER, { sex: 'M' });

    const annSql = sqlCalls().find(s => s.includes('<=>') && s.includes('nv.embedding'));
    expect(annSql).toMatch(/female_pct/);
    expect(annSql).toMatch(/<=/);
  });

  it('warm path — no sex filter when sex param omitted (treated as U)', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING, liked_count: 5 }] });
      return Promise.resolve({ rows: [] });
    });

    await getRecommendations(FAKE_USER, {});

    // sex = undefined → vSex returns 'U' → unisex filter applied
    const annSql = sqlCalls().find(s => s.includes('<=>') && s.includes('nv.embedding'));
    expect(annSql).toMatch(/female_pct/);
  });

  it('warm path — fetches liked-name vectors for k-means when liked_count >= 8', async () => {
    const likedVecs = Array.from({ length: 10 }, () => ({ embedding: fakeEmb() }));
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING, liked_count: 10 }] });
      if (sql.includes('user_swipes us JOIN name_vectors'))
        return Promise.resolve({ rows: likedVecs });
      return Promise.resolve({ rows: [] });
    });

    await getRecommendations(FAKE_USER, {});

    expect(sqlCalls().some(s =>
      s.includes('user_swipes us JOIN name_vectors') && s.includes('liked = true'),
    )).toBe(true);
  });

  it('returns empty names array when no candidates match', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_taste'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING, liked_count: 5 }] });
      return Promise.resolve({ rows: [] });
    });
    mockDdbSend.mockResolvedValue({ Responses: {} });

    const result = await getRecommendations(FAKE_USER, {});
    const body = JSON.parse(result.body);
    expect(body.names).toEqual([]);
  });
});

// ─── recordSwipe ──────────────────────────────────────────────────────────

describe('recordSwipe', () => {
  it('returns 400 when name is missing', async () => {
    const result = await recordSwipe(FAKE_USER, { liked: true });
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when liked is missing', async () => {
    const result = await recordSwipe(FAKE_USER, { name: 'Emma' });
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when liked is not a boolean', async () => {
    const result = await recordSwipe(FAKE_USER, { name: 'Emma', liked: 'yes' });
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when name is not in name_vectors', async () => {
    // name_vectors lookup → not found; everything else → default []
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM name_vectors WHERE name'))
        return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const result = await recordSwipe(FAKE_USER, { name: 'NotAName', liked: true });
    expect(result.statusCode).toBe(404);
    expect(sqlCalls().some(s => s.includes('FROM name_vectors WHERE name'))).toBe(true);
  });

  it('records a like and upserts taste with +1 weight', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM name_vectors WHERE name'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING }] });
      if (sql.includes('FROM user_taste WHERE user_id'))
        return Promise.resolve({ rows: [] }); // no existing taste
      return Promise.resolve({ rows: [] });
    });

    const result = await recordSwipe(FAKE_USER, { name: 'Emma', liked: true });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ ok: true });

    expect(sqlCalls().some(s => s.includes('INSERT INTO user_swipes'))).toBe(true);

    const tasteUpsertSql = sqlCalls().find(s => s.includes('INSERT INTO user_taste'));
    expect(tasteUpsertSql).toBeDefined();
    expect(tasteUpsertSql).toMatch(/ON CONFLICT/);
    expect(tasteUpsertSql).toMatch(/DO UPDATE/);
    expect(tasteUpsertSql).toMatch(/liked_count/);
    expect(tasteUpsertSql).toMatch(/disliked_count/);

    // liked: true → weight 1.0, liked_count incremented, disliked_count = 0
    const tasteArgs = mockQuery.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO user_taste'),
    )?.[1] as unknown[];
    expect(tasteArgs).toContain(1);   // liked_count
    expect(tasteArgs).toContain(0);   // disliked_count
  });

  it('records a dislike with -0.5 weight', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM name_vectors WHERE name'))
        return Promise.resolve({ rows: [{ embedding: FAKE_EMBEDDING }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await recordSwipe(FAKE_USER, { name: 'Emma', liked: false });

    expect(result.statusCode).toBe(200);
    const tasteArgs = mockQuery.mock.calls.find(c =>
      (c[0] as string).includes('INSERT INTO user_taste'),
    )?.[1] as unknown[];
    expect(tasteArgs).toContain(0);   // liked_count = 0
    expect(tasteArgs).toContain(1);   // disliked_count = 1
  });
});
