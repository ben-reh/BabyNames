import { getRecommendations, recordSwipe } from '../recommendations';

const mockQuery = jest.fn();
jest.mock('../../db/postgres', () => ({
  getPool: () => ({ query: mockQuery }),
}));

const FAKE_USER = 'user-123';
const FAKE_EMBEDDING = '[0.1,0.2,0.3]';
const FAKE_NAMES = ['Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella'];

beforeEach(() => {
  mockQuery.mockReset();
});

// ─── getRecommendations ────────────────────────────────────────────────────

describe('getRecommendations', () => {
  it('cold start — returns popularity-ordered names when no taste vector exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                          // user_taste lookup → none
      .mockResolvedValueOnce({ rows: FAKE_NAMES.map(name => ({ name })) }); // cold start query

    const result = await getRecommendations(FAKE_USER, {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.names).toEqual(FAKE_NAMES);
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Cold start query should join name_popularity for ordering
    const coldStartSql = mockQuery.mock.calls[1][0] as string;
    expect(coldStartSql).toMatch(/name_popularity/);
    expect(coldStartSql).toMatch(/2025/);
  });

  it('taste-based — uses ANN query when user has a taste vector', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] }) // user_taste → exists
      .mockResolvedValueOnce({ rows: FAKE_NAMES.map(name => ({ name })) }); // ANN query

    const result = await getRecommendations(FAKE_USER, {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.names).toEqual(FAKE_NAMES);

    const annSql = mockQuery.mock.calls[1][0] as string;
    expect(annSql).toMatch(/<=>/);       // pgvector cosine distance operator
    expect(annSql).toMatch(/user_taste/);
    expect(annSql).toMatch(/user_swipes/); // excludes already-swiped names
  });

  it('applies F sex filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] });

    await getRecommendations(FAKE_USER, { sex: 'F' });

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/female_pct >= 0.1/);
  });

  it('applies M sex filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] });

    await getRecommendations(FAKE_USER, { sex: 'M' });

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/female_pct <= 0.9/);
  });

  it('applies U sex filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] });

    await getRecommendations(FAKE_USER, { sex: 'U' });

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/female_pct > 0.05/);
    expect(sql).toMatch(/female_pct < 0.95/);
  });

  it('applies no sex filter when sex param is omitted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] });

    await getRecommendations(FAKE_USER, {});

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).not.toMatch(/female_pct/);
  });

  it('returns empty names array when no candidates match', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] });

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
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when liked is missing', async () => {
    const result = await recordSwipe(FAKE_USER, { name: 'Emma' });
    expect(result.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when liked is not a boolean', async () => {
    const result = await recordSwipe(FAKE_USER, { name: 'Emma', liked: 'yes' });
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when name is not in name_vectors', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // name_vectors lookup → not found

    const result = await recordSwipe(FAKE_USER, { name: 'NotAName', liked: true });
    expect(result.statusCode).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('records a like and returns ok', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] }) // name_vectors
      .mockResolvedValueOnce({ rows: [] })                               // insert user_swipes
      .mockResolvedValueOnce({ rows: [] });                              // upsert user_taste

    const result = await recordSwipe(FAKE_USER, { name: 'Emma', liked: true });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // taste upsert should use weight +1 for a like
    const tasteArgs = mockQuery.mock.calls[2][1] as unknown[];
    expect(tasteArgs).toContain(1.0);  // weight
    expect(tasteArgs).toContain(1);    // liked_count increment
    expect(tasteArgs).toContain(0);    // disliked_count increment
  });

  it('records a dislike with -0.5 weight', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await recordSwipe(FAKE_USER, { name: 'Emma', liked: false });

    const tasteArgs = mockQuery.mock.calls[2][1] as unknown[];
    expect(tasteArgs).toContain(-0.5); // weight
    expect(tasteArgs).toContain(0);    // liked_count increment
    expect(tasteArgs).toContain(1);    // disliked_count increment
  });

  it('upsert SQL handles both insert and conflict update', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await recordSwipe(FAKE_USER, { name: 'Emma', liked: true });

    const tasteSql = mockQuery.mock.calls[2][0] as string;
    expect(tasteSql).toMatch(/ON CONFLICT/);
    expect(tasteSql).toMatch(/DO UPDATE/);
    expect(tasteSql).toMatch(/liked_count/);
    expect(tasteSql).toMatch(/disliked_count/);
  });
});
