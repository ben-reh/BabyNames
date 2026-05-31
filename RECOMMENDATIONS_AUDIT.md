# Recommendation system audit — 2026-05-30

A code-review pass on `backend/infra/functions/api/src/routes/recommendations.ts`
found five correctness bugs. All were fixed, tested, deployed, and pushed in the
same session. This doc captures the *what* and *why* so future work on this
file has the context.

Commits: `958718e` (fixes + tests).

---

## Bugs fixed

### #1 — Partner blending silently dropped at k > 1

**Where:** `getRecommendations`, k-means branch (formerly inline; now
`pickCentroidQueries`).

**Symptom:** As soon as a user crossed `CLUSTER_MIN_LIKES = 8`, the k>1 branch
built ANN query vectors from the user's liked-name vectors only — `blendedVec`
(which carries the 50/50 user+partner blend) was constructed and then ignored.
Pairing silently stopped influencing retrieval for any active user. No log, no
indication.

**Fix:** Hoisted `partnerTasteVec` to outer scope. Each centroid's
representative liked vector is now blended 50/50 with partner taste before
being passed to ANN, matching the single-vector path's behavior.

**Test coverage:**
- Unit: `pickCentroidQueries` — "regression: partner blending is NOT silently
  dropped at k > 1".
- e2e: limited — partner pairing smoke test only confirms the endpoints
  respond when paired. Direct partner-blend effects aren't observable through
  the API surface.

### #2 — Re-swipe count / embedding leak

**Where:** `recordSwipe` (now `computeTasteUpdate` for the math).

**Symptom:** When a user flipped a like → dislike (or vice versa), the
`user_swipes` row updated correctly (UNIQUE constraint + ON CONFLICT), but
`user_taste` did the wrong thing in two ways:

1. `liked_count` / `disliked_count` only *incremented*; the prior direction's
   count was never decremented. After flipping one like to a dislike,
   `liked_count` stayed at 1 *and* `disliked_count` became 1 — the name was
   counted in both buckets.
2. The taste vector's running average folded in the *new* contribution on top
   of the *old* one. The original `+1.0 × nameVec` stayed baked in; a
   `-0.5 × nameVec` was added.

**Fix:** Read the prior swipe row in parallel with the taste row before
mutating either. Four cases:

| Case | Action |
|---|---|
| No taste row | First-ever swipe; produce `weight × nameVec`. |
| No prior swipe | Add new contribution to running average. |
| Prior same direction | No-op (counts and vec unchanged). |
| Prior opposite direction (flip) | Subtract `oldWeight × nameVec`, add `newWeight × nameVec`, denominator unchanged. Counts adjusted by replacement. |

**Test coverage:**
- Unit: `computeTasteUpdate` covers all four cases plus regression assertions
  that total contributions stay bounded on flip.
- e2e: limited — `/swipes` reads `user_swipes` which was always correct;
  the leak lived in `user_taste` counts (not API-visible). The bug is best
  caught at the unit level.

### #3 — Reranker's "cosine rank" wasn't cosine rank

**Where:** `rerankPool` + round-robin merge.

**Symptom:** A variable called `cosScore` was computed as `1 - rank / n` where
`rank` was the candidate's index in the post-pop-blend pool — *not* its ANN
similarity rank. The reranker was being trained against a feature that didn't
measure what its name claimed.

**Fix:** Each candidate now carries `bestAnnRank` = its minimum rank across
k-means centroids during retrieval. `rerankPool` uses
`rankScore = 1 - bestAnnRank / ANN_FETCH_K`. Variable renamed.

**Test coverage:** No direct test (the function takes a learned model as a
dependency). Build typechecks and existing recommendation flow tests still
pass; behavior change is visible in the deployed recommender output.

### #4 — Final shuffle scrambled the rerank order

**Where:** End of `getRecommendations` (now `boundedShuffle`).

**Symptom:** Uniform Fisher–Yates on the merged 20-name deck. The
top-reranked candidate was just as likely to land at position 19 as at
position 0 — defeating the rerank entirely.

**Fix:** Bounded-window swap (`SHUFFLE_WINDOW = 3`). Each position swaps with
a random `j ∈ [i-3, i+3]`. Local variety, top items stay near the top.
Note: chained forward swaps mean an item can drift slightly beyond ±3.

**Test coverage:** Unit tests for `boundedShuffle` cover the permutation
property, window=0 identity, and movement under a non-trivial window.

### #5 — DDL in the request path (minimal fix)

**Where:** `ensureSchema`.

**Symptom:** Schema migrations run on every Lambda cold start. A bare
`catch { /* already applied */ }` swallowed *every* error, not just
idempotency ones. The `TRUNCATE user_taste` branch on dimension mismatch
would silently wipe every user's taste vector if `VECTOR_DIM` was ever wrong.

**Fix (intentionally minimal):**
- `run()` only swallows PG codes `42701`, `42710`, `42P07` (duplicate column /
  object / table). Everything else logs `migration_failed` and rethrows.
- TRUNCATE branch now requires `ALLOW_TASTE_TRUNCATE=true` env var. Default
  is to throw with a clear message.

**Not done:** Moving migrations out of the request path entirely (would need
a CDK custom resource or separate migrate Lambda). At current scale the
in-request cost is one-time-per-container and not a real problem.

---

## Refactor — pure helpers extracted

To make the bug fixes testable without DB mocks, three pure helpers were
extracted as exports from `recommendations.ts`:

| Export | Inputs | Returns |
|---|---|---|
| `computeTasteUpdate` | `current`, `priorLiked`, `nameVec`, `liked` | `{ newVec, newLiked, newDisliked }` |
| `pickCentroidQueries` | `likedVecs`, `k`, `partnerTasteVec`, `rng?` | `number[][]` (per-centroid query vectors) |
| `boundedShuffle` | `arr`, `window`, `rng?` | in-place shuffled `arr` |

`kmeanspp` also gained an optional `rng` parameter for deterministic tests.

---

## Tests added

- `functions/api/src/routes/__tests__/recommendations.math.test.ts` — 20
  unit tests, no DB. Run via `npm test`.
- `functions/api/src/routes/__tests__/recommendations.e2e.test.ts` — 14
  tests against the deployed API (same pattern as `tags.e2e.test.ts`).
  Run via `npm run test:e2e`.

Full suite now: 66 unit tests, 30 e2e tests (incl. tags), all green.

---

## Deploy notes

- The `ALLOW_TASTE_TRUNCATE` env var is **not** set in the CDK stack. If
  `VECTOR_DIM` ever changes and you need to wipe `user_taste`, set it on the
  Lambda env temporarily, deploy, hit any request, then unset and redeploy.
- Migrations still run on cold start. If you add a non-idempotent migration
  that produces a non-listed PG error code, the cold start will surface it
  as a `migration_failed` log entry and a 500 to the user — which is the
  intended behavior (fail loud).

---

## Learnings — patterns to watch in this file

1. **Branching code paths can silently drop dependencies.** Bug #1 happened
   because the partner blend was constructed in one place but consumed in
   only one of two branches. When you add a new branch in `getRecommendations`
   (e.g. a new `k` tier), grep for everything `blendedVec` / `partnerTasteVec`
   should flow through.

2. **`ON CONFLICT DO UPDATE` masks state drift.** The user_swipes table's
   UNIQUE constraint kept `user_swipes` self-consistent, which hid the
   `user_taste` drift in bug #2 for a long time. If you write code that
   maintains derived state across two tables (here: swipes ⟶ taste row),
   you need to handle the *update* case explicitly, not just the insert.

3. **Variable names lie when refactors move the data underneath.** Bug #3 —
   `cosScore` was probably correct when first written, then the pop-prior
   blend was added between retrieval and reranking. The name didn't get
   updated. Treat misleading names as a smell, not a style issue.

4. **Fisher–Yates is a hammer.** Bug #4 — uniform shuffles erase a lot of
   work. Anywhere you're trying to add "variety" to a ranked list, ask
   whether a bounded swap is what you really want. Similar consideration
   for any post-rerank reordering.

5. **Catch-all blocks hide bugs proportional to how silent they are.** Bug #5
   — `catch { /* already applied */ }` was lying about both the *reason*
   it caught and the *scope* of what it caught. PG ships error codes for a
   reason; use them.

6. **e2e tests through the public API don't catch all classes of bugs.**
   Bug #2 wasn't visible through `/swipes`. Bug #1 needs >=8 likes to even
   reach the k>1 branch. When a bug lives in derived/internal state, you
   need either (a) unit tests on extracted pure logic, or (b) an admin
   endpoint that exposes that state. The former is cheaper.

7. **`recordSwipe` no longer treats onboarding swipes specially.** Onboarding
   inserts into `user_swipes` with `liked=true` *and* contributes to the
   onboarding-weighted average in `user_taste.embedding`. A later flip of
   that name in the main deck reverses it as if it were a regular swipe.
   This is consistent but imperfect — the original onboarding contribution
   was weighted by `onboarding_count`, not by the running-average count. If
   you ever change onboarding semantics, revisit `computeTasteUpdate`.

---

## Open / deferred

These came up in the audit but weren't fixed:

- **POP_PRIOR_ALPHA = 0.40 is high.** Could be reduced or made adaptive based
  on the user's expressed popularity preference. Not changed because tuning
  it should be eval-driven.
- **K-means runs on every request and is non-deterministic.** Centroids
  drift across requests for the same user. Caching on `user_taste` (refresh
  when `liked_count` crosses a threshold) would stabilize the deck.
- **Anti-centroid exploration only flips embedding dims.** HC dims (origin,
  year, syllables, popularity tier) are unchanged, so "exploration" stays
  in the same style cluster.
- **Origin filter ships large name arrays to PG on every request.** Cache
  origin → names in Lambda module scope, or denormalize `origin` onto
  `name_vectors`.
- **`enrichNames` window function** ranks every name in 2025 just to look
  up ~20. Pre-materialize a `name_rank_yearly` table.
- **Migrations still run on cold start.** Full fix would move them to a
  CDK custom resource or dedicated migrate Lambda.
