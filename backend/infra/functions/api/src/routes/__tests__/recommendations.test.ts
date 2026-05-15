import { getRecommendations, recordSwipe } from '../recommendations';

const mockQuery = jest.fn();
jest.mock('../../db/postgres', () => ({
  getPool: () => ({ query: mockQuery }),
}));

const FAKE_USER = 'user-123';
const FAKE_EMBEDDING = '[0.1,0.2,0.3]';
const FAKE_NAMES = ['Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella'];
const FAKE_SIMILARITY_NAMES = Array.from({ length: 17 }, (_, i) => `SimilarName${i}`);
const FAKE_EXPLORATION_NAMES = Array.from({ length: 3 }, (_, i) => `ExploreName${i}`);

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

  it('taste-based — uses ANN similarity + exploration queries and returns 20 merged names', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })                          // user_taste → exists
      .mockResolvedValueOnce({ rows: FAKE_SIMILARITY_NAMES.map(name => ({ name })) })            // similarity ANN query
      .mockResolvedValueOnce({ rows: FAKE_EXPLORATION_NAMES.map(name => ({ name })) });          // exploration ANN query

    const result = await getRecommendations(FAKE_USER, {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.names).toHaveLength(20);

    // All similarity and exploration names should appear in the merged result
    expect(body.names).toEqual(expect.arrayContaining(FAKE_SIMILARITY_NAMES));
    expect(body.names).toEqual(expect.arrayContaining(FAKE_EXPLORATION_NAMES));

    // Taste lookup + similarity query + exploration query = 3 calls
    expect(mockQuery).toHaveBeenCalledTimes(3);

    const similaritySql = mockQuery.mock.calls[1][0] as string;
    expect(similaritySql).toMatch(/<=>/);        // pgvector cosine distance operator
    expect(similaritySql).toMatch(/user_taste/);
    expect(similaritySql).toMatch(/user_swipes/); // excludes already-swiped names

    const explorationSql = mockQuery.mock.calls[2][0] as string;
    expect(explorationSql).toMatch(/<=>/);
    expect(explorationSql).toMatch(/name_popularity/);
    expect(explorationSql).toMatch(/np\.year = 2024/);
    expect(explorationSql).toMatch(/np\.count >= \$2/);
    expect(explorationSql).toMatch(/np\.count < \$3/);
  });

  it('applies F sex filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] })  // similarity
      .mockResolvedValueOnce({ rows: [] }); // exploration

    await getRecommendations(FAKE_USER, { sex: 'F' });

    // Filter is applied to both queries; check similarity query (call index 1)
    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/female_pct >= 0.1/);
  });

  it('applies M sex filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] })  // similarity
      .mockResolvedValueOnce({ rows: [] }); // exploration

    await getRecommendations(FAKE_USER, { sex: 'M' });

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/female_pct <= 0.9/);
  });

  it('applies U sex filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] })  // similarity
      .mockResolvedValueOnce({ rows: [] }); // exploration

    await getRecommendations(FAKE_USER, { sex: 'U' });

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/female_pct > 0.05/);
    expect(sql).toMatch(/female_pct < 0.95/);
  });

  it('applies no sex filter when sex param is omitted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] })  // similarity
      .mockResolvedValueOnce({ rows: [] }); // exploration

    await getRecommendations(FAKE_USER, {});

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).not.toMatch(/female_pct/);
  });

  it('returns empty names array when no candidates match', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ embedding: FAKE_EMBEDDING }] })
      .mockResolvedValueOnce({ rows: [] })  // similarity
      .mockResolvedValueOnce({ rows: [] }); // exploration

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
