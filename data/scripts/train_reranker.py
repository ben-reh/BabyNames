"""
Trains a GradientBoostingClassifier re-ranker for baby name recommendations.

Primary training signal: LLM-generated training oracle (training_oracle.json).
  — Completely separate from the eval oracle (oracle_sets.json). No data leakage.
  — Weighted 10× to dominate over the noisier co-occurrence auxiliary.

Auxiliary signal: Nameberry co-occurrence shortlists (lower weight=1×).
  — Broadens the training distribution; prevents overfitting to the 50 training anchors.

Features (6):
  cos_sim        cosine similarity of full normed vectors (scale-dependent — must match EVAL_SCALE)
  emb_cos        embedding-only cosine (scale-invariant, captures pure vibe similarity)
  origin_match   1 if same origin bucket, 0 otherwise
  year_diff      |year_peak_q - year_peak_c|
  syl_diff       |syllables_q - syllables_c|
  pop_diff       |popularity_q - popularity_c| (log-normalized SSA count)

EVAL_SCALE must match the --scale flag used in eval_oracle_recall.py when --rerank is active.
If you retune the retrieval scale, retrain this reranker.

Output: data/processed/reranker.pkl  (sklearn Pipeline: StandardScaler + GBC)

Run: python3.12 data/scripts/train_reranker.py
"""
import csv
import json
import os
import pickle

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

SCRIPTS_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPTS_DIR, '..')
VECTORS_PATH = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')
TRAINING_ORACLE_PATH = os.path.join(DATA_DIR, 'processed', 'training_oracle.json')
DEV_ORACLE_PATH = os.path.join(DATA_DIR, 'processed', 'oracle_sets.json')
MODEL_PATH = os.path.join(DATA_DIR, 'processed', 'reranker.pkl')
NAMEBERRY_PATH = os.path.join(DATA_DIR, 'raw', 'nameberry', 'name_lists.jsonl')

HC_DIMS = 55
EMBED_DIMS = 512
EVAL_SCALE = 7           # must match --scale in eval_oracle_recall.py --rerank
MIN_COUNT = 200
MAX_SAME_PREFIX = 2
MIN_NAMES = 4
MAX_NAMES = 20
HARD_NEGS_PER_POS = 5   # hard negatives sampled per positive example
RETRIEVAL_K = 100        # ANN pool size for hard negative mining

LLM_WEIGHT = 10.0        # sample weight for LLM training oracle examples
NAMEBERRY_WEIGHT = 1.0   # sample weight for Nameberry co-occurrence examples

ORIGIN_END = 36
ORIGIN_ACTIVE_VALUE = 1.5
YEAR_DIM = 36
SYL_DIM = 37
POP_DIM = 54

FEATURE_NAMES = ['cos_sim', 'emb_cos', 'origin_match', 'year_diff', 'syl_diff', 'pop_diff']
FEATURE_COUNT = len(FEATURE_NAMES)

CONSTRAINED_KEYWORDS = [
    'sibling', 'sister', 'brother', 'middle name', 'middle-name',
    'goes with', 'pairs with', 'honor name',
]


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

    emb_norms = np.linalg.norm(emb, axis=1, keepdims=True)
    emb_norms[emb_norms == 0] = 1e-9
    emb_normed = emb / emb_norms

    return names, counts, female_pcts, vecs, normed, emb_normed


# ── Feature extraction ────────────────────────────────────────────────────────

def origin_index(v: np.ndarray) -> int:
    for i in range(ORIGIN_END):
        if abs(v[i] - ORIGIN_ACTIVE_VALUE) < 0.01:
            return i
    return -1


def feature_vector(q_idx: int, c_idx: int,
                   vecs: np.ndarray, normed: np.ndarray, emb_normed: np.ndarray) -> list[float]:
    q, c = vecs[q_idx], vecs[c_idx]
    cos = float(normed[q_idx] @ normed[c_idx])
    emb_cos = float(emb_normed[q_idx] @ emb_normed[c_idx])
    qi, ci = origin_index(q), origin_index(c)
    origin_match = 1.0 if (qi == ci and qi != -1) else 0.0
    year_diff = abs(float(q[YEAR_DIM]) - float(c[YEAR_DIM]))
    syl_diff = abs(float(q[SYL_DIM]) - float(c[SYL_DIM]))
    pop_diff = abs(float(q[POP_DIM]) - float(c[POP_DIM]))
    return [cos, emb_cos, origin_match, year_diff, syl_diff, pop_diff]


# ── Retrieval helpers ─────────────────────────────────────────────────────────

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
              normed: np.ndarray, sex: str, k: int = RETRIEVAL_K) -> list[int]:
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
        if not sex_matches(female_pcts[i], sex):
            continue
        prefix = names[i][:2].lower()
        if prefix_counts.get(prefix, 0) >= MAX_SAME_PREFIX:
            continue
        prefix_counts[prefix] = prefix_counts.get(prefix, 0) + 1
        results.append(i)
    return results


# ── Training data: LLM oracle ─────────────────────────────────────────────────

def build_llm_training_data(training_oracle: dict, names: list, counts: list,
                             female_pcts: list, vecs: np.ndarray, normed: np.ndarray,
                             emb_normed: np.ndarray) -> tuple[np.ndarray, np.ndarray, list[float]]:
    name_to_idx = {n: i for i, n in enumerate(names)}
    count_by_name = dict(zip(names, counts))
    X, y, weights = [], [], []
    rng = np.random.default_rng(42)

    for anchor, data in training_oracle.items():
        if anchor not in name_to_idx:
            print(f"  warning: anchor '{anchor}' not in vectors — skipping")
            continue
        q_idx = name_to_idx[anchor]
        sex = data.get('sex', 'U')
        top_k = get_top_k(q_idx, names, counts, female_pcts, normed, sex)
        top_k_set = set(top_k)

        eligible_gold = {
            n for n in data['gold']
            if n in name_to_idx
            and count_by_name.get(n, 0) >= MIN_COUNT
            and sex_matches(female_pcts[name_to_idx[n]], sex)
        }
        positives = [i for i in top_k if names[i] in eligible_gold]
        negatives_pool = [i for i in top_k if i not in {name_to_idx[n] for n in eligible_gold}]

        for c_idx in positives:
            X.append(feature_vector(q_idx, c_idx, vecs, normed, emb_normed))
            y.append(1)
            weights.append(LLM_WEIGHT)

        sampled_negs = rng.choice(negatives_pool,
                                  size=min(HARD_NEGS_PER_POS * len(positives), len(negatives_pool)),
                                  replace=False) if negatives_pool else []
        for c_idx in sampled_negs:
            X.append(feature_vector(q_idx, c_idx, vecs, normed, emb_normed))
            y.append(0)
            weights.append(LLM_WEIGHT)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32), weights


# ── Training data: Nameberry co-occurrence ────────────────────────────────────

def load_nameberry_posts(name_set: set) -> list[dict]:
    if not os.path.exists(NAMEBERRY_PATH):
        print(f"  Nameberry data not found at {NAMEBERRY_PATH} — skipping auxiliary signal")
        return []
    posts = []
    with open(NAMEBERRY_PATH) as f:
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
    return posts


def build_nameberry_training_data(posts: list, names: list, counts: list,
                                   female_pcts: list, vecs: np.ndarray, normed: np.ndarray,
                                   emb_normed: np.ndarray) -> tuple[np.ndarray, np.ndarray, list[float]]:
    name_to_idx = {n: i for i, n in enumerate(names)}
    X, y, weights = [], [], []
    rng = np.random.default_rng(123)

    for pi, post in enumerate(posts):
        if pi % 400 == 0:
            print(f"  nameberry examples: {pi}/{len(posts)} posts, {len(X)} examples so far")
        post_names = post['names']
        post_idx_set = {name_to_idx[n] for n in post_names if n in name_to_idx}

        for query_name in post_names:
            if query_name not in name_to_idx:
                continue
            q_idx = name_to_idx[query_name]
            sex = infer_sex(female_pcts[q_idx])
            top_k = get_top_k(q_idx, names, counts, female_pcts, normed, sex)

            positives = [i for i in top_k if i in post_idx_set and i != q_idx]
            for c_idx in positives:
                X.append(feature_vector(q_idx, c_idx, vecs, normed, emb_normed))
                y.append(1)
                weights.append(NAMEBERRY_WEIGHT)

            neg_pool = [i for i in top_k if i not in post_idx_set]
            sampled_negs = rng.choice(neg_pool,
                                      size=min(HARD_NEGS_PER_POS, len(neg_pool)),
                                      replace=False) if neg_pool else []
            for c_idx in sampled_negs:
                X.append(feature_vector(q_idx, c_idx, vecs, normed, emb_normed))
                y.append(0)
                weights.append(NAMEBERRY_WEIGHT)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32), weights


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--llm-only', action='store_true',
                        help='Train on LLM oracle only, skip Nameberry auxiliary')
    parser.add_argument('--use-dev-oracle', action='store_true',
                        help='Add oracle dev set (oracle_sets.json) as training data. '
                             'Note: dev oracle recall numbers become training-set metrics. '
                             'Test set remains the honest eval. Weight=LLM_WEIGHT.')
    parser.add_argument('--loo-anchor', default=None,
                        help='Leave this dev oracle anchor out of training (for LOO-CV). '
                             'Only used with --use-dev-oracle.')
    parser.add_argument('--nameberry-weight', type=float, default=NAMEBERRY_WEIGHT,
                        help=f'Sample weight for Nameberry examples (default: {NAMEBERRY_WEIGHT})')
    args = parser.parse_args()

    if not os.path.exists(TRAINING_ORACLE_PATH):
        print(f"ERROR: {TRAINING_ORACLE_PATH} not found.")
        print("Run: python3.12 data/scripts/generate_training_set.py")
        return

    print(f"Loading vectors (scale={EVAL_SCALE}x)...")
    names, counts, female_pcts, vecs, normed, emb_normed = load_vectors()
    name_set = set(names)
    print(f"Loaded {len(names):,} names\n")

    print("Building LLM oracle training examples...")
    with open(TRAINING_ORACLE_PATH) as f:
        training_oracle = json.load(f)
    print(f"  {len(training_oracle)} training anchors")
    X_llm, y_llm, w_llm = build_llm_training_data(
        training_oracle, names, counts, female_pcts, vecs, normed, emb_normed)
    pos_llm = y_llm.sum()
    print(f"  {len(X_llm):,} examples ({pos_llm:,} positive, {len(X_llm)-pos_llm:,} negative, weight={LLM_WEIGHT}x)\n")

    if args.use_dev_oracle:
        print("Loading oracle dev set as additional training data...")
        with open(DEV_ORACLE_PATH) as f:
            dev_oracle_all = json.load(f)
        dev_oracle = {n: d for n, d in dev_oracle_all.items() if d.get('split') == 'dev'}
        if args.loo_anchor and args.loo_anchor in dev_oracle:
            del dev_oracle[args.loo_anchor]
            print(f"  LOO-CV: leaving out '{args.loo_anchor}'")
        print(f"  {len(dev_oracle)} dev oracle anchors")
        X_dev, y_dev, w_dev = build_llm_training_data(
            dev_oracle, names, counts, female_pcts, vecs, normed, emb_normed)
        pos_dev = y_dev.sum()
        print(f"  {len(X_dev):,} examples ({pos_dev:,} positive, {len(X_dev)-pos_dev:,} negative, "
              f"weight={LLM_WEIGHT}x)\n")
        X_llm = np.concatenate([X_llm, X_dev], axis=0)
        y_llm = np.concatenate([y_llm, y_dev], axis=0)
        w_llm = w_llm + w_dev

    if args.llm_only:
        print("Nameberry auxiliary: skipped (--llm-only)\n")
        X = X_llm
        y = y_llm
        weights = np.array(w_llm, dtype=np.float32)
    else:
        nb_weight = args.nameberry_weight
        print(f"Building Nameberry auxiliary examples (weight={nb_weight}x)...")
        posts = load_nameberry_posts(name_set)
        print(f"  {len(posts)} usable posts")
        X_nb, y_nb, w_nb_raw = build_nameberry_training_data(
            posts, names, counts, female_pcts, vecs, normed, emb_normed)
        w_nb = [nb_weight if w > 0 else 0.0 for w in w_nb_raw]
        pos_nb = y_nb.sum()
        print(f"  {len(X_nb):,} examples ({pos_nb:,} positive, {len(X_nb)-pos_nb:,} negative, "
              f"weight={nb_weight}x)\n")

        X = np.concatenate([X_llm, X_nb], axis=0)
        y = np.concatenate([y_llm, y_nb], axis=0)
        weights = np.array(w_llm + w_nb, dtype=np.float32)

        total_pos = y.sum()
        print(f"Combined: {len(X):,} examples ({total_pos:,} positive, {len(X)-total_pos:,} negative)")
        llm_eff = len(X_llm) * LLM_WEIGHT
        nb_eff = len(X_nb) * nb_weight
        print(f"Effective weight: LLM={llm_eff:.0f} ({llm_eff/(llm_eff+nb_eff):.0%}), "
              f"Nameberry={nb_eff:.0f} ({nb_eff/(llm_eff+nb_eff):.0%})\n")

    # ── Pairwise training ─────────────────────────────────────────────────────
    # Build (gold_features - non_gold_features) difference vectors.
    # At inference, individual candidate features are scored directly —
    # the GBC approximates the pairwise objective pointwise.
    print("Building pairwise training examples from LLM oracle...")
    rng2 = np.random.default_rng(99)
    name_to_idx_pw = {n: i for i, n in enumerate(names)}
    with open(TRAINING_ORACLE_PATH) as f:
        training_oracle_data = json.load(f)

    Xp, yp_list, wp = [], [], []
    for anchor, data in training_oracle_data.items():
        if anchor not in name_to_idx_pw:
            continue
        q_idx_pw = name_to_idx_pw[anchor]
        sex = data.get('sex', 'U')
        top_k_pw = get_top_k(q_idx_pw, names, counts, female_pcts, normed, sex)
        eligible_gold = {
            n for n in data['gold']
            if n in name_to_idx_pw
            and counts[name_to_idx_pw[n]] >= MIN_COUNT
            and sex_matches(female_pcts[name_to_idx_pw[n]], sex)
        }
        pos_idxs = [i for i in top_k_pw if names[i] in eligible_gold]
        neg_idxs = [i for i in top_k_pw if names[i] not in eligible_gold]
        if not pos_idxs or not neg_idxs:
            continue
        for p_idx in pos_idxs:
            sampled = rng2.choice(neg_idxs, size=min(HARD_NEGS_PER_POS, len(neg_idxs)), replace=False)
            for n_idx in sampled:
                fp = feature_vector(q_idx_pw, p_idx, vecs, normed, emb_normed)
                fn = feature_vector(q_idx_pw, n_idx, vecs, normed, emb_normed)
                diff = [a - b for a, b in zip(fp, fn)]
                Xp.append(diff);   yp_list.append(1); wp.append(LLM_WEIGHT)
                Xp.append([-d for d in diff]); yp_list.append(0); wp.append(LLM_WEIGHT)

    Xp = np.array(Xp, dtype=np.float32)
    yp = np.array(yp_list, dtype=np.int32)
    wp = np.array(wp, dtype=np.float32)
    print(f"  {len(Xp):,} pairwise examples\n")

    print("Training re-ranker (pointwise + pairwise)...")
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    Xp_scaled = scaler.transform(Xp)

    from sklearn.linear_model import LogisticRegression as LR
    clf_lr = LR(C=1.0, max_iter=1000, random_state=42)
    clf_lr.fit(X_scaled, y, sample_weight=weights)
    lr_model = Pipeline([('scaler', scaler), ('clf', clf_lr)])

    from sklearn.ensemble import GradientBoostingClassifier as GBC
    # Pointwise GBC (baseline)
    clf_gbc_pt = GBC(n_estimators=100, max_depth=2, learning_rate=0.1, random_state=42)
    clf_gbc_pt.fit(X_scaled, y, sample_weight=weights)
    gbc_pt_model = Pipeline([('scaler', scaler), ('clf', clf_gbc_pt)])

    # Pairwise GBC — trained on difference vectors
    clf_gbc_pw = GBC(n_estimators=100, max_depth=2, learning_rate=0.1, random_state=42)
    clf_gbc_pw.fit(Xp_scaled, yp, sample_weight=wp)
    gbc_pw_model = Pipeline([('scaler', scaler), ('clf', clf_gbc_pw)])

    print("\nLR coefficients (pointwise):")
    for fname, coef in zip(FEATURE_NAMES, clf_lr.coef_[0]):
        bar = '█' * int(abs(coef) * 5)
        sign = '+' if coef >= 0 else '-'
        print(f"  {fname:16}: {coef:+.3f}  {sign}{bar}")

    print("\nGBC feature importances (pointwise):")
    for fname, imp in zip(FEATURE_NAMES, clf_gbc_pt.feature_importances_):
        bar = '█' * int(imp * 50)
        print(f"  {fname:16}: {imp:.3f}  {bar}")

    print("\nGBC feature importances (pairwise):")
    for fname, imp in zip(FEATURE_NAMES, clf_gbc_pw.feature_importances_):
        bar = '█' * int(imp * 50)
        print(f"  {fname:16}: {imp:.3f}  {bar}")

    # Default to pointwise GBC — pairwise saved separately for comparison
    model = gbc_pt_model
    clf = clf_gbc_pt

    lr_path = MODEL_PATH.replace('.pkl', '_lr.pkl')
    gbc_pt_path = MODEL_PATH.replace('.pkl', '_gbc.pkl')
    gbc_pw_path = MODEL_PATH.replace('.pkl', '_gbc_pairwise.pkl')
    with open(lr_path, 'wb') as f:
        pickle.dump(lr_model, f)
    with open(gbc_pt_path, 'wb') as f:
        pickle.dump(gbc_pt_model, f)
    with open(gbc_pw_path, 'wb') as f:
        pickle.dump(gbc_pw_model, f)
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    print(f"\nSaved GBC pointwise → {MODEL_PATH} (default)")
    print(f"Also: {lr_path} (LR), {gbc_pt_path} (GBC pointwise), {gbc_pw_path} (GBC pairwise)")
    print(f"To try pairwise: cp {gbc_pw_path} {MODEL_PATH}")
    print(f"Note: reranker trained at scale={EVAL_SCALE}. Use --scale {EVAL_SCALE} in eval_oracle_recall.py --rerank.")


if __name__ == '__main__':
    main()
