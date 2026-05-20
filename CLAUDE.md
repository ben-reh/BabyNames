# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Before Writing Any Code

**Always check with the user before writing any code.** Describe what you plan to build — the approach, files affected, and any architectural decisions — and wait for approval before proceeding.

## Project Overview

BabyNames is a React Native iOS app that helps couples find the right baby name. Core features:
- Browse and swipe on names (Tinder-style)
- Partner pairing — share a code to sync swipes and see matches
- View popularity trends over time
- Filter and explore names by origin, popularity, gender

## Commands

### React Native App (`app/`)
```bash
cd app
npx expo start          # start dev server
npx expo run:ios        # build and run on iOS simulator
```
No test suite for the app currently.

### Backend (`backend/infra/`)
```bash
cd backend/infra
npm run build           # tsc compile
npm test                # unit tests (Jest, excludes e2e)
npm run test:e2e        # e2e tests
npx cdk deploy          # deploy stack to AWS
npx cdk diff            # diff against deployed stack
```

### Data Scripts (`data/scripts/`)
All scripts use `python3.12`. Key ones:
```bash
# Rebuild name vectors (uses cached OpenAI embeddings — no API cost if cache warm)
python3.12 data/scripts/compute_vectors.py --model large --output name_vectors.csv

# Eval pipeline (run in this order after any vector or model change)
python3.12 data/scripts/eval_oracle_recall.py --split dev --top-k 20 --scale 7
python3.12 data/scripts/eval_oracle_recall.py --split dev --top-k 100 --scale 7
python3.12 data/scripts/eval_reddit_recall.py          # regression gate: recall@20 ≥ 0.035
python3.12 data/scripts/eval_recommendations.py        # LLM judge (costs API $, run sparingly)

# Reranker
python3.12 data/scripts/generate_training_set.py       # generate LLM training oracle (costs API $)
python3.12 data/scripts/train_reranker.py --llm-only --use-dev-oracle

# Retrieval tuning
python3.12 data/scripts/sweep_retrieval_k.py           # recall@K table across scales
python3.12 data/scripts/hill_climb_retrieval.py        # tune scale + origin_weight
```

## Architecture

### Monorepo Structure

```
/
├── app/                  # React Native (Expo) iOS app
│   └── src/
│       ├── api/client.ts      # axios client; API_BASE points to API Gateway
│       ├── store/index.ts     # zustand stores (session, filter, match banner)
│       ├── hooks/             # useDeviceId, useName, etc.
│       └── components/        # shared UI components
├── backend/
│   └── infra/
│       ├── lib/baby-names-stack.ts   # CDK stack (all AWS resources)
│       ├── functions/api/src/
│       │   ├── handler.ts            # single Lambda, routes all API Gateway traffic
│       │   └── routes/               # names, recommendations, tags, lists, popularity, ai
│       └── schema.sql                # PostgreSQL schema (pgvector)
└── data/
    ├── scripts/           # vector build, eval, reranker training
    ├── processed/         # name_vectors.csv, oracle_sets.json, training_oracle.json, reranker.pkl
    └── raw/               # SSA data, Reddit/Nameberry shortlists, origins.csv
```

### AWS Backend Services

| Service | Role |
|---|---|
| **API Gateway** | REST API — single entry point; all traffic hits one Lambda |
| **Lambda** | `handler.ts` routes by method+path; separate `ai` Lambda for chat |
| **DynamoDB** | Name metadata, user lists (`Lists` table), name tags (`NameTags` table) |
| **RDS (PostgreSQL + pgvector)** | `name_vectors`, `user_taste`, `user_swipes` tables; ANN via `<=>` operator |
| **S3** | Raw datasets |
| **Cognito** | Planned — guest browsing works now via `deviceId`; auth not yet wired |

### User Identity (Current State)

The app identifies users by a `deviceId` (UUID stored in AsyncStorage, generated on first launch via `useDeviceId.ts`). Every API call passes `deviceId` as a query param or body field. **Cognito is not yet integrated** — all routes are unauthenticated. The plan is to migrate `deviceId` → Cognito `sub` at sign-up time.

### Recommendation Model

Two-stage pipeline: ANN retrieval → GBC reranker.

**Vectors** (`data/processed/name_vectors.csv`):
- 567 dims: 55 hand-crafted (HC) + 512 OpenAI `text-embedding-3-large` (Matryoshka, `dimensions=512`)
- HC layout: `[0:36]` origin one-hot (stored at `ORIGIN_SCALE=1.5`), `[36]` year_peak, `[37]` syllables, `[38:49]` stress pattern, `[49]` vowel ratio, `[50]` phoneme length, `[51:54]` gender ×3, `[54]` popularity tier, `[55:567]` embedding
- `ORIGIN_ACTIVE_VALUE = 1.5` — used by eval scripts to detect active origin dim

**Retrieval**: cosine ANN via pgvector `<=>`, K=100, eval scale=7. Three modes in `handler.py`: cold start (0 swipes) → single taste vector (1–7 swipes) → k-means multi-vector (8+ swipes, k=2; k=3 at 20+).

**Reranker** (`data/processed/reranker.pkl`): sklearn Pipeline (StandardScaler + GBC). Features: `cos_sim`, `emb_cos`, `origin_match`, `year_diff`, `syl_diff`, `pop_diff`. Blended at inference: `0.2 × cosine_rank + 0.8 × reranker_score`. **Must retrain reranker if vectors are rebuilt** — features are scale-dependent.

**Eval discipline**:
- Dev oracle (`oracle_sets.json`, 10 anchors) — tune against this
- Test oracle (9 anchors, `--split test`) — reveal only once per session, never tune against it
- Reddit gate (`eval_reddit_recall.py`) — soft regression gate, require recall@20 ≥ 0.035 before committing model changes

### App State

`useSessionStore` (persisted to AsyncStorage):
- `deviceId`, `listId`, `code`, `partnerRole` ('A'|'B'), `onboardingDone`, `defaultSex`

`useFilterStore` (persisted): `sex`, `origins`, `popularity`

### Partner Flow

Two users pair by one creating a list (gets a 6-char `code`) and the other joining with that code. Both get `listId` and different `partnerRole`. The `listId` is the DynamoDB partition key for shared state. Partner swipes and matches are fetched by querying with both `deviceId` and `listId`.

## Key Design Decisions

- **No Amplify** — raw AWS SDK calls for full control; using `axios` directly against API Gateway
- **Single Lambda handler** — `handler.ts` pattern-matches on `method + path` and delegates to route modules; avoids Lambda cold-start sprawl
- **DynamoDB for metadata, RDS for vectors/trends** — pgvector ANN requires PostgreSQL; time-series and ANN queries don't fit DynamoDB
- **Guest mode first** — `deviceId` works everywhere now; Cognito `sub` will replace it at sign-up without breaking the data model
- **Eval-only test set** — `oracle_sets.json` has `split: dev|test`; test anchors are held out until final validation
