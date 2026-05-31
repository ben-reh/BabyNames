/**
 * Unit tests for the pure helpers extracted from recommendations.ts.
 * No DB / network — these run as part of `npm test`.
 */

import {
  computeTasteUpdate,
  pickCentroidQueries,
  boundedShuffle,
  TasteSnapshot,
} from '../recommendations';

// Deterministic RNG so kmeans++/shuffle tests are reproducible.
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ── computeTasteUpdate ────────────────────────────────────────────────────────

describe('computeTasteUpdate', () => {
  const nameVec = [1, 2, 3, 4];

  describe('no prior taste (first-ever swipe)', () => {
    it('like → weight 1.0, liked_count 1, disliked_count 0', () => {
      const r = computeTasteUpdate(null, null, nameVec, true);
      expect(r.newVec).toEqual([1, 2, 3, 4]);
      expect(r.newLiked).toBe(1);
      expect(r.newDisliked).toBe(0);
    });

    it('dislike → weight −0.5, disliked_count 1', () => {
      const r = computeTasteUpdate(null, null, nameVec, false);
      expect(r.newVec).toEqual([-0.5, -1, -1.5, -2]);
      expect(r.newLiked).toBe(0);
      expect(r.newDisliked).toBe(1);
    });
  });

  describe('taste row exists, no prior swipe for this name', () => {
    const current: TasteSnapshot = {
      embedding: [10, 20, 30, 40],
      liked_count: 4,
      disliked_count: 0,
      onboarding_count: 0,
    };

    it('like → adds +1 × nameVec to the running average; liked_count increments', () => {
      const r = computeTasteUpdate(current, null, nameVec, true);
      // (10*4 + 1*1) / 5 = 41/5 = 8.2
      expect(r.newVec[0]).toBeCloseTo(8.2);
      expect(r.newVec[3]).toBeCloseTo((40 * 4 + 4) / 5);
      expect(r.newLiked).toBe(5);
      expect(r.newDisliked).toBe(0);
    });

    it('counts onboarding_count in the denominator', () => {
      const withOnboarding: TasteSnapshot = { ...current, liked_count: 0, onboarding_count: 4 };
      const r = computeTasteUpdate(withOnboarding, null, nameVec, true);
      // total = 0 + 0 + 4 = 4 → (10*4 + 1*1) / 5 = 8.2 (same as above)
      expect(r.newVec[0]).toBeCloseTo(8.2);
    });
  });

  describe('re-swipe same direction (no-op)', () => {
    const current: TasteSnapshot = {
      embedding: [10, 20, 30, 40],
      liked_count: 3,
      disliked_count: 1,
      onboarding_count: 0,
    };

    it('like → like leaves taste vec and counts unchanged', () => {
      const r = computeTasteUpdate(current, true, nameVec, true);
      expect(r.newVec).toBe(current.embedding); // same reference is fine
      expect(r.newLiked).toBe(3);
      expect(r.newDisliked).toBe(1);
    });

    it('dislike → dislike leaves everything unchanged', () => {
      const r = computeTasteUpdate(current, false, nameVec, false);
      expect(r.newVec).toBe(current.embedding);
      expect(r.newLiked).toBe(3);
      expect(r.newDisliked).toBe(1);
    });
  });

  describe('re-swipe flip (reverse prior contribution)', () => {
    // Carefully constructed: previously the user "liked" this name. The current
    // embedding contains its +1.0 contribution. After flipping to dislike, the
    // prior +1.0 should be removed and -0.5 applied — with total unchanged
    // (we're replacing, not adding).
    const current: TasteSnapshot = {
      embedding: [10, 20, 30, 40],
      liked_count: 4,
      disliked_count: 0,
      onboarding_count: 0,
    };

    it('like → dislike: reverses +1 and applies -0.5; liked_count decrements, disliked_count increments', () => {
      const r = computeTasteUpdate(current, true, nameVec, false);
      // total = 4; newVec[i] = (curVec[i]*4 - 1*nameVec[i] + (-0.5)*nameVec[i]) / 4
      //                     = (curVec[i]*4 - 1.5*nameVec[i]) / 4
      expect(r.newVec[0]).toBeCloseTo((10 * 4 - 1.5 * 1) / 4);
      expect(r.newVec[1]).toBeCloseTo((20 * 4 - 1.5 * 2) / 4);
      expect(r.newLiked).toBe(3);   // was 4, decremented
      expect(r.newDisliked).toBe(1); // was 0, incremented
    });

    it('dislike → like: reverses -0.5 and applies +1; disliked_count decrements, liked_count increments', () => {
      const dislikeCurrent: TasteSnapshot = {
        embedding: [10, 20, 30, 40],
        liked_count: 0,
        disliked_count: 2,
        onboarding_count: 0,
      };
      const r = computeTasteUpdate(dislikeCurrent, false, nameVec, true);
      // total = 2; newVec[i] = (curVec[i]*2 - (-0.5)*nameVec[i] + 1*nameVec[i]) / 2
      //                     = (curVec[i]*2 + 1.5*nameVec[i]) / 2
      expect(r.newVec[0]).toBeCloseTo((10 * 2 + 1.5 * 1) / 2);
      expect(r.newLiked).toBe(1);   // was 0, incremented
      expect(r.newDisliked).toBe(1); // was 2, decremented
    });

    it('regression: a flip does NOT double the count (the bug fix #2)', () => {
      // Pre-fix bug: flipping like → dislike would set liked_count = 4 + 0 = 4
      // (unchanged, wrong) and disliked_count = 0 + 1 = 1, leaving the name
      // counted as both liked and disliked.
      const r = computeTasteUpdate(current, true, nameVec, false);
      expect(r.newLiked + r.newDisliked).toBe(4); // total contributions unchanged
    });

    it('regression: a flip preserves total (replacement, not addition)', () => {
      const r = computeTasteUpdate(current, true, nameVec, false);
      expect(r.newLiked + r.newDisliked).toBe(current.liked_count + current.disliked_count);
    });
  });
});

// ── pickCentroidQueries ───────────────────────────────────────────────────────

describe('pickCentroidQueries', () => {
  // 4-D vectors are enough to test the blending and selection logic.
  const v1 = [1, 0, 0, 0];
  const v2 = [0, 1, 0, 0];
  const v3 = [0, 0, 1, 0];
  const partner = [10, 10, 10, 10];

  it('returns [] when fewer liked vectors than k', () => {
    expect(pickCentroidQueries([v1], 2, null)).toEqual([]);
    expect(pickCentroidQueries([], 1, null)).toEqual([]);
  });

  it('with n === k and no partner, returns the liked vectors themselves', () => {
    // kmeanspp short-circuits when n <= k: returns vectors.slice() → centroids
    // ARE the liked vectors → each centroid's "closest liked vector" is itself.
    const out = pickCentroidQueries([v1, v2], 2, null);
    expect(out).toHaveLength(2);
    // Order may differ but content should match the input set.
    expect(out).toEqual(expect.arrayContaining([v1, v2]));
  });

  it('with partner present, blends each centroid representative 50/50 with partner', () => {
    const out = pickCentroidQueries([v1, v2], 2, partner);
    expect(out).toHaveLength(2);
    // Both outputs should be 0.5*input + 0.5*partner.
    const expectedFromV1 = [0.5 * 1 + 0.5 * 10, 0.5 * 0 + 0.5 * 10, 5, 5];
    const expectedFromV2 = [5, 0.5 * 1 + 0.5 * 10, 5, 5];
    expect(out).toEqual(expect.arrayContaining([expectedFromV1, expectedFromV2]));
  });

  it('regression: partner blending is NOT silently dropped at k > 1 (the bug fix #1)', () => {
    // Pre-fix bug: when k > 1, partnerTasteVec was ignored — only the user's
    // liked vectors were returned. With partner=[10,10,10,10], any output
    // dimension should be >= 5 if blending happened.
    const out = pickCentroidQueries([v1, v2], 2, partner);
    for (const vec of out) {
      // Without partner blending, v1 and v2 have max coord 1.
      // With blending, the partner contributes 5 to every coord.
      expect(Math.max(...vec)).toBeGreaterThanOrEqual(5);
    }
  });

  it('with n > k, returns k vectors selected from the liked pool', () => {
    const rng = seededRng(42);
    const out = pickCentroidQueries([v1, v2, v3], 2, null, rng);
    expect(out).toHaveLength(2);
    for (const vec of out) {
      // Each output must be one of the actual liked vectors (style preservation).
      expect([v1, v2, v3]).toContainEqual(vec);
    }
  });
});

// ── boundedShuffle ────────────────────────────────────────────────────────────

describe('boundedShuffle', () => {
  it('window=0 leaves the array unchanged', () => {
    const arr = [0, 1, 2, 3, 4];
    const original = [...arr];
    const out = boundedShuffle(arr, 0);
    expect(out).toBe(arr); // in-place
    expect(arr).toEqual(original);
  });

  it('length=1 is a no-op', () => {
    const arr = [42];
    boundedShuffle(arr, 3);
    expect(arr).toEqual([42]);
  });

  it('preserves length and is a permutation of input', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const before = [...arr];
    boundedShuffle(arr, 3, seededRng(123));
    expect(arr).toHaveLength(20);
    expect([...arr].sort((a, b) => a - b)).toEqual(before); // same multiset
  });

  it('produces some movement with a non-trivial window and random seed', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const before = [...arr];
    boundedShuffle(arr, 3, seededRng(7));
    // At least one position should differ from the identity arrangement.
    let moved = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] !== before[i]) moved++;
    expect(moved).toBeGreaterThan(0);
  });

  it('with window >= length, behaves like a full shuffle (still a permutation)', () => {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7];
    const before = [...arr];
    boundedShuffle(arr, 100, seededRng(99));
    expect([...arr].sort((a, b) => a - b)).toEqual(before);
  });
});
