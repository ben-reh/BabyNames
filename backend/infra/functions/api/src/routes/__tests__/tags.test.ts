import {
  listTagDefs,
  listTagAssignments,
  createTag,
  deleteTag,
  setNameTags,
  getPartnerTags,
} from '../tags';

// ── DynamoDB mock ─────────────────────────────────────────────────────────────

const mockSend = jest.fn();
// Forward through a function so the closure resolves mockSend at call-time,
// not at jest.mock factory-construction time (which is hoisted above the const).
jest.mock('../../db/dynamo', () => ({
  ddb: { send: (...args: unknown[]) => mockSend(...args) },
}));

process.env.TAGS_TABLE = 'NameTags';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEVICE = 'device-abc';
const TAG_ID = 'tag-uuid-1';

function queryItems(items: Record<string, unknown>[], count?: number) {
  return { Items: items, Count: count ?? items.length };
}

function getItem(item: Record<string, unknown> | undefined) {
  return { Item: item };
}

function parseBody(result: { statusCode: number; body: string }) {
  return JSON.parse(result.body);
}

beforeEach(() => mockSend.mockReset());

// ── listTagDefs ───────────────────────────────────────────────────────────────

describe('listTagDefs', () => {
  it('returns 400 when deviceId is missing', async () => {
    const r = await listTagDefs({});
    expect(r.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns empty array when no DEF items exist', async () => {
    mockSend.mockResolvedValueOnce(queryItems([]));
    const r = await listTagDefs({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);
    expect(parseBody(r).tags).toEqual([]);
  });

  it('maps DynamoDB items to tag defs', async () => {
    mockSend.mockResolvedValueOnce(queryItems([
      { tagId: 'id-1', label: 'Favorite', color: '#E8608A', sk: 'DEF#id-1', deviceId: DEVICE },
      { tagId: 'id-2', label: 'Family', color: '#5B8DEF', sk: 'DEF#id-2', deviceId: DEVICE },
    ]));
    const r = await listTagDefs({ deviceId: DEVICE });
    expect(r.statusCode).toBe(200);
    expect(parseBody(r).tags).toEqual([
      { id: 'id-1', label: 'Favorite', color: '#E8608A' },
      { id: 'id-2', label: 'Family', color: '#5B8DEF' },
    ]);
  });

  it('queries with DEF# prefix for the correct device', async () => {
    mockSend.mockResolvedValueOnce(queryItems([]));
    await listTagDefs({ deviceId: DEVICE });
    const input = (mockSend.mock.calls[0][0] as any).input;
    expect(input.ExpressionAttributeValues[':d']).toBe(DEVICE);
    expect(input.ExpressionAttributeValues[':prefix']).toBe('DEF#');
  });
});

// ── listTagAssignments ────────────────────────────────────────────────────────

describe('listTagAssignments', () => {
  it('returns 400 when deviceId is missing', async () => {
    const r = await listTagAssignments({});
    expect(r.statusCode).toBe(400);
  });

  it('returns empty assignments when no ASSIGN items exist', async () => {
    mockSend.mockResolvedValueOnce(queryItems([]));
    const r = await listTagAssignments({ deviceId: DEVICE });
    expect(parseBody(r).assignments).toEqual({});
  });

  it('parses ASSIGN#<name>#<tagId> sk correctly', async () => {
    mockSend.mockResolvedValueOnce(queryItems([
      { sk: 'ASSIGN#Emma#favorite', deviceId: DEVICE },
    ]));
    const r = await listTagAssignments({ deviceId: DEVICE });
    expect(parseBody(r).assignments).toEqual({ Emma: ['favorite'] });
  });

  it('groups multiple tags under the same name', async () => {
    mockSend.mockResolvedValueOnce(queryItems([
      { sk: `ASSIGN#Emma#${TAG_ID}`, deviceId: DEVICE },
      { sk: 'ASSIGN#Emma#family-name', deviceId: DEVICE },
      { sk: 'ASSIGN#Oliver#favorite', deviceId: DEVICE },
    ]));
    const r = await listTagAssignments({ deviceId: DEVICE });
    const { assignments } = parseBody(r);
    expect(assignments.Emma).toEqual(expect.arrayContaining([TAG_ID, 'family-name']));
    expect(assignments.Oliver).toEqual(['favorite']);
  });

  it('handles names that contain hyphens by using lastIndexOf to split', async () => {
    // sk: ASSIGN#Jean-Paul#<uuid> — lastIndexOf ensures correct split
    mockSend.mockResolvedValueOnce(queryItems([
      { sk: `ASSIGN#Jean-Paul#${TAG_ID}`, deviceId: DEVICE },
    ]));
    const r = await listTagAssignments({ deviceId: DEVICE });
    expect(parseBody(r).assignments['Jean-Paul']).toEqual([TAG_ID]);
  });
});

// ── createTag ─────────────────────────────────────────────────────────────────

describe('createTag', () => {
  it('returns 400 when deviceId is missing', async () => {
    const r = await createTag({ label: 'Fave' });
    expect(r.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when label is missing', async () => {
    const r = await createTag({ deviceId: DEVICE });
    expect(r.statusCode).toBe(400);
  });

  it('uses provided color when it is a valid palette color', async () => {
    mockSend.mockResolvedValueOnce({ ok: true }); // PutCommand
    const r = await createTag({ deviceId: DEVICE, label: 'Blue Tag', color: '#5B8DEF' });
    expect(r.statusCode).toBe(200);
    const body = parseBody(r);
    expect(body.color).toBe('#5B8DEF');
    expect(body.label).toBe('Blue Tag');
    expect(body.id).toBeDefined();
    // Should skip COUNT query and go straight to PutCommand
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('auto-assigns a color when no color provided', async () => {
    mockSend
      .mockResolvedValueOnce(queryItems([], 0)) // COUNT query
      .mockResolvedValueOnce({ ok: true });     // PutCommand
    const r = await createTag({ deviceId: DEVICE, label: 'Auto Color' });
    expect(r.statusCode).toBe(200);
    expect(parseBody(r).color).toMatch(/^#/);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('auto-assigns color when provided color is not in the palette', async () => {
    mockSend
      .mockResolvedValueOnce(queryItems([], 1)) // COUNT = 1 → second palette color
      .mockResolvedValueOnce({ ok: true });
    const r = await createTag({ deviceId: DEVICE, label: 'Weird Color', color: '#123456' });
    expect(r.statusCode).toBe(200);
    expect(parseBody(r).color).toBe('#5B8DEF'); // palette index 1
  });

  it('cycles through palette colors based on existing count', async () => {
    // COUNT = 6 → wraps back to index 0
    mockSend
      .mockResolvedValueOnce(queryItems([], 6))
      .mockResolvedValueOnce({ ok: true });
    const r = await createTag({ deviceId: DEVICE, label: 'Wrap Around' });
    expect(parseBody(r).color).toBe('#E8608A'); // palette index 0
  });
});

// ── deleteTag ─────────────────────────────────────────────────────────────────

describe('deleteTag', () => {
  it('returns 400 when deviceId is missing', async () => {
    const r = await deleteTag(TAG_ID, {});
    expect(r.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('deletes the DEF item and all ASSIGN items for the tag', async () => {
    mockSend.mockResolvedValueOnce(queryItems([
      { sk: `DEF#${TAG_ID}`, deviceId: DEVICE },
      { sk: `ASSIGN#Emma#${TAG_ID}`, deviceId: DEVICE },
      { sk: `ASSIGN#Oliver#${TAG_ID}`, deviceId: DEVICE },
    ]));
    mockSend.mockResolvedValue({ ok: true }); // DeleteCommands

    const r = await deleteTag(TAG_ID, { deviceId: DEVICE });
    expect(r.statusCode).toBe(200);
    // 1 Query + 3 Deletes
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('does not delete items belonging to other tags', async () => {
    const OTHER_TAG = 'other-tag-uuid';
    mockSend.mockResolvedValueOnce(queryItems([
      { sk: `DEF#${TAG_ID}`, deviceId: DEVICE },
      { sk: `DEF#${OTHER_TAG}`, deviceId: DEVICE },           // different tag — leave alone
      { sk: `ASSIGN#Emma#${TAG_ID}`, deviceId: DEVICE },
      { sk: `ASSIGN#Emma#${OTHER_TAG}`, deviceId: DEVICE },   // different tag — leave alone
    ]));
    mockSend.mockResolvedValue({ ok: true });

    await deleteTag(TAG_ID, { deviceId: DEVICE });
    // 1 Query + 2 Deletes (DEF#TAG_ID and ASSIGN#Emma#TAG_ID only)
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('returns ok even when no items exist for the tag', async () => {
    mockSend.mockResolvedValueOnce(queryItems([]));
    const r = await deleteTag(TAG_ID, { deviceId: DEVICE });
    expect(r.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1); // only the Query
  });
});

// ── setNameTags ───────────────────────────────────────────────────────────────

describe('setNameTags', () => {
  it('returns 400 when deviceId is missing', async () => {
    const r = await setNameTags('Emma', { tagIds: ['favorite'] });
    expect(r.statusCode).toBe(400);
  });

  it('returns 400 when tagIds is not an array', async () => {
    const r = await setNameTags('Emma', { deviceId: DEVICE, tagIds: 'favorite' });
    expect(r.statusCode).toBe(400);
  });

  it('deletes existing assignments then creates new ones', async () => {
    mockSend
      .mockResolvedValueOnce(queryItems([           // existing assignments query
        { sk: `ASSIGN#Emma#old-tag`, deviceId: DEVICE },
      ]))
      .mockResolvedValueOnce({ ok: true })           // delete old-tag
      .mockResolvedValueOnce({ ok: true })           // put favorite
      .mockResolvedValueOnce({ ok: true });          // put family-name

    const r = await setNameTags('Emma', { deviceId: DEVICE, tagIds: ['favorite', 'family-name'] });
    expect(r.statusCode).toBe(200);
    // 1 Query + 1 Delete + 2 Puts
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('clears all assignments when tagIds is empty', async () => {
    mockSend
      .mockResolvedValueOnce(queryItems([
        { sk: `ASSIGN#Emma#favorite`, deviceId: DEVICE },
      ]))
      .mockResolvedValueOnce({ ok: true }); // delete

    const r = await setNameTags('Emma', { deviceId: DEVICE, tagIds: [] });
    expect(r.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(2); // Query + 1 Delete, no Puts
  });

  it('queries using the correct name prefix', async () => {
    mockSend.mockResolvedValueOnce(queryItems([])).mockResolvedValue({ ok: true });
    await setNameTags('Oliver', { deviceId: DEVICE, tagIds: ['favorite'] });
    const queryInput = (mockSend.mock.calls[0][0] as any).input;
    expect(queryInput.ExpressionAttributeValues[':prefix']).toBe('ASSIGN#Oliver#');
  });
});

// ── getPartnerTags ────────────────────────────────────────────────────────────

describe('getPartnerTags', () => {
  const LIST_ID = 'list-xyz';
  const MY_DEVICE = 'my-device';
  const PARTNER_DEVICE = 'partner-device';

  const listWithBothPartners = {
    listId: LIST_ID,
    partnerA: { deviceId: MY_DEVICE, names: [] },
    partnerB: { deviceId: PARTNER_DEVICE, names: [] },
  };

  it('returns 400 when deviceId is missing', async () => {
    const r = await getPartnerTags(LIST_ID, {});
    expect(r.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 404 when list is not found', async () => {
    mockSend.mockResolvedValueOnce(getItem(undefined));
    const r = await getPartnerTags(LIST_ID, { deviceId: MY_DEVICE });
    expect(r.statusCode).toBe(404);
  });

  it('returns 403 when deviceId is not a partner in the list', async () => {
    mockSend.mockResolvedValueOnce(getItem({
      listId: LIST_ID,
      partnerA: { deviceId: 'someone-else', names: [] },
      partnerB: { deviceId: 'another-device', names: [] },
    }));
    const r = await getPartnerTags(LIST_ID, { deviceId: MY_DEVICE });
    expect(r.statusCode).toBe(403);
  });

  it('returns empty data when partnerB has not joined yet', async () => {
    mockSend.mockResolvedValueOnce(getItem({
      listId: LIST_ID,
      partnerA: { deviceId: MY_DEVICE, names: [] },
      partnerB: null,
    }));
    const r = await getPartnerTags(LIST_ID, { deviceId: MY_DEVICE });
    expect(r.statusCode).toBe(200);
    const body = parseBody(r);
    expect(body.customDefs).toEqual([]);
    expect(body.assignments).toEqual({});
    // Only one send (the list GetCommand)
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('resolves partner from partnerA perspective', async () => {
    mockSend
      .mockResolvedValueOnce(getItem(listWithBothPartners)) // GetCommand
      .mockResolvedValueOnce(queryItems([]))                // partner DEF query
      .mockResolvedValueOnce(queryItems([]));               // partner ASSIGN query

    await getPartnerTags(LIST_ID, { deviceId: MY_DEVICE });

    const defsQueryInput = (mockSend.mock.calls[1][0] as any).input;
    expect(defsQueryInput.ExpressionAttributeValues[':d']).toBe(PARTNER_DEVICE);
  });

  it('resolves partner from partnerB perspective', async () => {
    mockSend
      .mockResolvedValueOnce(getItem(listWithBothPartners))
      .mockResolvedValueOnce(queryItems([]))
      .mockResolvedValueOnce(queryItems([]));

    await getPartnerTags(LIST_ID, { deviceId: PARTNER_DEVICE });

    const defsQueryInput = (mockSend.mock.calls[1][0] as any).input;
    expect(defsQueryInput.ExpressionAttributeValues[':d']).toBe(MY_DEVICE);
  });

  it('returns partner custom defs and assignments', async () => {
    mockSend
      .mockResolvedValueOnce(getItem(listWithBothPartners))
      .mockResolvedValueOnce(queryItems([
        { tagId: 'p-tag-1', label: 'Partner Fave', color: '#FF9800', sk: `DEF#p-tag-1`, deviceId: PARTNER_DEVICE },
      ]))
      .mockResolvedValueOnce(queryItems([
        { sk: `ASSIGN#Emma#p-tag-1`, deviceId: PARTNER_DEVICE },
        { sk: `ASSIGN#Emma#favorite`, deviceId: PARTNER_DEVICE },
      ]));

    const r = await getPartnerTags(LIST_ID, { deviceId: MY_DEVICE });
    expect(r.statusCode).toBe(200);
    const body = parseBody(r);
    expect(body.customDefs).toEqual([{ id: 'p-tag-1', label: 'Partner Fave', color: '#FF9800' }]);
    expect(body.assignments.Emma).toEqual(expect.arrayContaining(['p-tag-1', 'favorite']));
  });
});
