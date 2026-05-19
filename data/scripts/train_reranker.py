"""
Trains a logistic regression re-ranker on Reddit + Nameberry co-occurrence data.

For each name in a post, treats the other post names as positive candidates
and names from the ANN top-100 that aren't in the post as hard negatives.
Learns to promote the right names from positions 21-100 into the top 20.

Features (per query-candidate pair):
  cos_sim        cosine similarity of full normed vectors
  origin_match   1 if same origin bucket, 0 otherwise
  year_peak_diff |year_peak_q - year_peak_c|
  syl_diff       |syl_q - syl_c|
  gender_diff    |gender_q - gender_c|
  pop_diff       |pop_q - pop_c|

Output: data/processed/reranker.pkl  (sklearn Pipeline: StandardScaler + LogisticRegression)

Run: python3.12 data/scripts/train_reranker.py
"""
import csv
import json
import os
import pickle

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

SCRIPTS_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPTS_DIR, '..')
VECTORS_PATH = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')
MODEL_PATH = os.path.join(DATA_DIR, 'processed', 'reranker.pkl')
SOURCES = {
    'reddit':    os.path.join(DATA_DIR, 'raw', 'reddit', 'name_lists.jsonl'),
    'nameberry': os.path.join(DATA_DIR, 'raw', 'nameberry', 'name_lists.jsonl'),
}

HC_DIMS = 55
EMBED_DIMS = 512
EVAL_SCALE = 4          # must match eval_oracle_recall.py --scale
MIN_COUNT = 200
MAX_SAME_PREFIX = 2
MIN_NAMES = 4
MAX_NAMES = 20
HARD_NEGS_PER_POS = 5  # hard negatives sampled per positive
RETRIEVAL_K = 100       # ANN pool size for hard negative mining

CONSTRAINED_KEYWORDS = [
    'sibling', 'sister', 'brother', 'middle name', 'middle-name',
    'goes with', 'pairs with', 'honor name',
]

ORIGIN_ACTIVE_VALUE = 2.0  # ORIGIN_SCALE=2 was applied at vector build time

# HC field positions (from compute_vectors.py layout)
ORIGIN_END = 36   # dims [0:36]
YEAR_DIM = 36
SYL_DIM = 37
GENDER_DIM = 51   # first of 3 repeated gender dims
POP_DIM = 54


# ── Vector loading ────────────────────────────────────────────────────────────

def load_vectors():
    names, counts, female_pcts, vecs = [], [], [], []
    with open(VECTORS_PATH) as f:
        for row in csv.DictReader(f):
            v = np.array(json.loads(row['vector']), dtype=np.float32)
            names.append(row['name'])
            counts.append(int(row.get('count_2025', 0)))
            female_pcts.append(float(row.get('female_pct', 0.5)))
            vecs.append(v)
    vecs = np.array(vecs)
    hc = vecs[:, :HC_DIMS]
    emb = vecs[:, HC_DIMS:HC_DIMS + EMBED_DIMS]
    scaled = np.concatenate([hc, emb * EVAL_SCALE], axis=1)
    norms = np.linalg.norm(scaled, axis=1, keepdims=True)
    norms[norms == 0] = 1e-9
    normed = scaled / norms
    return names, counts, female_pcts, vecs, normed


# ── Feature extraction ────────────────────────────────────────────────────────

def origin_index(v: np.ndarray) -> int:
    """Return the active origin dim index, or -1 for unknown."""
    for i in range(ORIGIN_END):
        if abs(v[i] - ORIGIN_ACTIVE_VALUE) < 0.01:
            return i
    return -1  # unknown bucket


def features(q_idx: int, c_idx: int, vecs: np.ndarray, normed: np.ndarray) -> list[float]:
    q, c = vecs[q_idx], vecs[c_idx]
    cos = float(normed[q_idx] @ normed[c_idx])
    year_diff = abs(float(q[YEAR_DIM]) - float(c[YEAR_DIM]))
    syl_diff = abs(float(q[SYL_DIM]) - float(c[SYL_DIM]))
    gender_diff = abs(float(q[GENDER_DIM]) - float(c[GENDER_DIM]))
    pop_diff = abs(float(q[POP_DIM]) - float(c[POP_DIM]))
    return [cos, year_diff, syl_diff, gender_diff, pop_diff]


FEATURE_NAMES = ['cos_sim', 'year_diff', 'syl_diff', 'gender_diff', 'pop_diff']


# ── ANN retrieval (for hard negative mining) ─────────────────────────────────

def levenshtein(a: str, b: str) -> int:
    a, b = a.lower(), b.lower()
    if abs(len(a) - len(b)) > 2:
        return 3
    dp = list(range(len(b) + 1))
    for ca in a:
        ndp = [dp[0] + 1]
        for j, cb in enumerate(b):
            ndp.append(min(dp[j] + (ca != cb), dp[j + 1] + 1, ndp[j] + 1))
        dp = ndp
    return dp[-1]


def sex_matches(fp: float, sex: str) -> bool:
    if sex == 'F': return fp >= 0.10
    if sex == 'M': return fp <= 0.90
    return True


def infer_sex(fp: float) -> str:
    if fp >= 0.70: return 'F'
    if fp <= 0.30: return 'M'
    return 'U'


def get_top_k(q_idx: int, names: list, counts: list, female_pcts: list,
              normed: np.ndarray, k: int) -> list[int]:
    query_sex = infer_sex(female_pcts[q_idx])
    query_name = names[q_idx]
    sims = normed @ normed[q_idx]
    results, prefix_counts = [], {}
    for i in np.argsort(sims)[::-1]:
        if len(results) >= k:
            break
        if i == q_idx:
            continue
        if counts[i] < MIN_COUNT:
            continue
        if levenshtein(query_name, names[i]) <= 3:
            continue
        if not sex_matches(female_pcts[i], query_sex):
            continue
        prefix = names[i][:2].lower()
        if prefix_counts.get(prefix, 0) >= MAX_SAME_PREFIX:
            continue
        prefix_counts[prefix] = prefix_counts.get(prefix, 0) + 1
        results.append(i)
    return results


# ── Post loading ──────────────────────────────────────────────────────────────

def load_posts(name_set: set) -> list[dict]:
    posts = []
    for source, path in SOURCES.items():
        if not os.path.exists(path):
            continue
        count = 0
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                post = json.loads(line)
                title = post.get('title', '').lower()
                if any(kw in title for kw in CONSTRAINED_KEYWORDS):
                    continue
                matched = [n for n in post.get('names', []) if n in name_set]
                if MIN_NAMES <= len(matched) <= MAX_NAMES:
                    posts.append({**post, 'names': matched})
                    count += 1
        print(f"  {source}: {count} usable posts")
    return posts


# ── Training ──────────────────────────────────────────────────────────────────

def build_training_data(posts, names, counts, female_pcts, vecs, normed):
    name_to_idx = {n: i for i, n in enumerate(names)}
    X, y = [], []
    rng = np.random.default_rng(42)

    for pi, post in enumerate(posts):
        if pi % 200 == 0:
            print(f"  building examples: {pi}/{len(posts)} posts, "
                  f"{len(X)} examples so far")
        post_names = post['names']
        post_idx_set = {name_to_idx[n] for n in post_names if n in name_to_idx}

        for query_name in post_names:
            if query_name not in name_to_idx:
                continue
            q_idx = name_to_idx[query_name]
            top_k = get_top_k(q_idx, names, counts, female_pcts, normed, RETRIEVAL_K)

            # Positives: other post names that were retrieved in top-100
            positives = [i for i in top_k if i in post_idx_set and i != q_idx]
            for c_idx in positives:
                X.append(features(q_idx, c_idx, vecs, normed))
                y.append(1)

            # Hard negatives: top-100 names NOT in the post
            neg_pool = [i for i in top_k if i not in post_idx_set]
            sampled_negs = rng.choice(neg_pool,
                                      size=min(HARD_NEGS_PER_POS, len(neg_pool)),
                                      replace=False) if neg_pool else []
            for c_idx in sampled_negs:
                X.append(features(q_idx, c_idx, vecs, normed))
                y.append(0)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32)


def main():
    print(f"Loading vectors...")
    names, counts, female_pcts, vecs, normed = load_vectors()
    name_set = set(names)
    print(f"Loaded {len(names):,} names\n")

    print("Loading posts...")
    posts = load_posts(name_set)
    print(f"Total: {len(posts)} posts\n")

    print("Building training examples...")
    X, y = build_training_data(posts, names, counts, female_pcts, vecs, normed)
    pos = y.sum()
    print(f"\nTraining set: {len(X):,} examples ({pos:,} positive, {len(X)-pos:,} negative)")
    print(f"Positive rate: {pos/len(X):.1%}\n")

    print("Training logistic regression re-ranker...")
    model = Pipeline([
        ('scaler', StandardScaler()),
        ('clf', LogisticRegression(class_weight='balanced', max_iter=1000, C=1.0)),
    ])
    model.fit(X, y)

    clf = model.named_steps['clf']
    print("\nFeature coefficients:")
    for name, coef in zip(FEATURE_NAMES, clf.coef_[0]):
        print(f"  {name:16}: {coef:+.3f}")

    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    print(f"\nSaved to {MODEL_PATH}")


if __name__ == '__main__':
    main()
