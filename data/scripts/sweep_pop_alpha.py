"""
Sweep popularity-prior blend weight (alpha) for ANN retrieval.

Simulates fetching FETCH_K candidates by cosine similarity, blending with
log(count) at varying alpha, then measuring:
  - oracle recall@20 / recall@100 (primary guard — must not drop)
  - mean count + % rare in the raw top-RERANK_K candidate pool (what we're fixing)

Alpha=0.0 is the current behaviour (pure cosine).

Run: python3.12 data/scripts/sweep_pop_alpha.py
     python3.12 data/scripts/sweep_pop_alpha.py --scale 7 --fetch-k 400
"""
import argparse
import csv
import json
import os
import pickle

import numpy as np

SCRIPTS_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPTS_DIR, '..')
DEFAULT_VECTORS_PATH = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')
ORACLE_PATH = os.path.join(DATA_DIR, 'processed', 'oracle_sets.json')
RERANKER_PATH = os.path.join(DATA_DIR, 'processed', 'reranker.pkl')

HC_DIMS = 55
EMBED_DIMS = 512
MIN_COUNT = 200
MAX_SAME_PREFIX = 2
SEX_FILTER_F = 0.10
SEX_FILTER_M = 0.90

ORIGIN_END = 36
YEAR_DIM = 36
SYL_DIM = 37
POP_DIM = 54
ORIGIN_ACTIVE_VALUE = 1.5

ALPHAS = [0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]
DEFAULT_SCALE = 7
DEFAULT_FETCH_K = 400
RERANK_K = 100
RERANKER_BLEND = 0.5  # matches eval_oracle_recall.py default


def load_vectors(scale: int, vectors_path: str = None):
    if vectors_path is None:
        vectors_path = DEFAULT_VECTORS_PATH
    names, counts, female_pcts, raw_vecs, hc_vecs, emb_vecs = [], [], [], [], [], []
    with open(vectors_path) as f:
        for row in csv.DictReader(f):
            v = json.loads(row['vector'])
            names.append(row['name'])
            counts.append(int(row.get('count_2025', 0)))
            female_pcts.append(float(row.get('female_pct', 0.5)))
            raw_vecs.append(v)
            hc_vecs.append(v[:HC_DIMS])
            emb_vecs.append(v[HC_DIMS:HC_DIMS + EMBED_DIMS])
    hc = np.array(hc_vecs, dtype=np.float32)
    emb = np.array(emb_vecs, dtype=np.float32)
    vecs = np.array(raw_vecs, dtype=np.float32)
    scaled = np.concatenate([hc, emb * scale], axis=1)
    norms = np.linalg.norm(scaled, axis=1, keepdims=True)
    norms[norms == 0] = 1e-9
    normed = scaled / norms
    emb_norms = np.linalg.norm(emb, axis=1, keepdims=True)
    emb_norms[emb_norms == 0] = 1e-9
    emb_normed = emb / emb_norms
    return names, counts, female_pcts, vecs, normed, emb_normed


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
    if sex == 'F':
        return fp >= SEX_FILTER_F
    if sex == 'M':
        return fp <= SEX_FILTER_M
    return True


def origin_index(v: np.ndarray) -> int:
    for i in range(ORIGIN_END):
        if abs(v[i] - ORIGIN_ACTIVE_VALUE) < 0.01:
            return i
    return -1


def reranker_features(q_idx: int, c_idx: int,
                      vecs: np.ndarray, normed: np.ndarray,
                      emb_normed: np.ndarray) -> list[float]:
    q, c = vecs[q_idx], vecs[c_idx]
    cos = float(normed[q_idx] @ normed[c_idx])
    emb_cos = float(emb_normed[q_idx] @ emb_normed[c_idx])
    qi, ci = origin_index(q), origin_index(c)
    origin_match = 1.0 if (qi == ci and qi != -1) else 0.0
    year_diff = abs(float(q[YEAR_DIM]) - float(c[YEAR_DIM]))
    syl_diff = abs(float(q[SYL_DIM]) - float(c[SYL_DIM]))
    pop_diff = abs(float(q[POP_DIM]) - float(c[POP_DIM]))
    return [cos, emb_cos, origin_match, year_diff, syl_diff, pop_diff]


def get_raw_ann(idx: int, normed: np.ndarray, fetch_k: int) -> list[int]:
    """Top fetch_k candidates by cosine similarity, no count/sex filters."""
    sims = normed @ normed[idx]
    result = []
    for i in np.argsort(sims)[::-1]:
        if i == idx:
            continue
        result.append(int(i))
        if len(result) >= fetch_k:
            break
    return result


def apply_pop_prior(candidate_indices: list[int], counts: list[int],
                    alpha: float) -> list[int]:
    """Re-rank candidate pool by blending cosine rank with log(count)."""
    pool_counts = [counts[i] for i in candidate_indices]
    max_count = max(pool_counts) or 1
    log_max = np.log(max_count + 1)
    n = len(candidate_indices)
    scored = []
    for rank, idx in enumerate(candidate_indices):
        ann_score = 1.0 - rank / n
        log_score = np.log(counts[idx] + 1) / log_max
        blend = (1 - alpha) * ann_score + alpha * log_score
        scored.append((blend, idx))
    scored.sort(reverse=True)
    return [idx for _, idx in scored]


def candidate_pool_stats(candidate_indices: list[int], counts: list[int],
                         rerank_k: int) -> dict:
    """Popularity stats on the raw top-rerank_k pool (before post-filters)."""
    pool = candidate_indices[:rerank_k]
    pool_counts = [counts[i] for i in pool]
    return {
        'mean_count': float(np.mean(pool_counts)),
        'median_count': float(np.median(pool_counts)),
        'pct_above_200': sum(1 for c in pool_counts if c >= 200) / len(pool_counts),
        'pct_rare': sum(1 for c in pool_counts if c < 200) / len(pool_counts),
    }


def get_recs_with_alpha(
    idx: int, sex: str, names: list, counts: list, female_pcts: list,
    normed: np.ndarray, top_k: int, fetch_k: int, alpha: float,
) -> tuple[list[str], dict]:
    """
    Fetch fetch_k candidates by cosine, optionally blend with log-pop,
    then apply standard post-filters.
    Returns (recommendations, pool_stats).
    """
    raw = get_raw_ann(idx, normed, fetch_k)
    if alpha > 0.0:
        raw = apply_pop_prior(raw, counts, alpha)
    stats = candidate_pool_stats(raw, counts, RERANK_K)
    query_name = names[idx]
    results, prefix_counts = [], {}
    for i in raw:
        if len(results) >= top_k:
            break
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
        results.append(names[i])
    return results, stats


def get_recs_reranked_with_alpha(
    idx: int, sex: str, names: list, counts: list, female_pcts: list,
    vecs: np.ndarray, normed: np.ndarray, emb_normed: np.ndarray,
    reranker, top_k: int, fetch_k: int, alpha: float,
) -> tuple[list[str], dict]:
    raw = get_raw_ann(idx, normed, fetch_k)
    if alpha > 0.0:
        raw = apply_pop_prior(raw, counts, alpha)
    stats = candidate_pool_stats(raw, counts, RERANK_K)

    # Apply post-filters to get the rerank pool
    name_to_idx = {n: i for i, n in enumerate(names)}
    query_name = names[idx]
    pool, prefix_counts = [], {}
    for i in raw:
        if len(pool) >= RERANK_K:
            break
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
        pool.append(names[i])

    if not pool:
        return [], stats

    feat_matrix = np.array([
        reranker_features(idx, name_to_idx[c], vecs, normed, emb_normed)
        for c in pool if c in name_to_idx
    ], dtype=np.float32)
    valid = [c for c in pool if c in name_to_idx]
    reranker_scores = reranker.predict_proba(feat_matrix)[:, 1]
    n = len(valid)
    cosine_scores = np.linspace(1.0, 0.0, n)
    final_scores = RERANKER_BLEND * cosine_scores + (1.0 - RERANKER_BLEND) * reranker_scores
    ranked = [valid[i] for i in np.argsort(final_scores)[::-1]]
    return ranked[:top_k], stats


def recall_for_alpha(
    alpha: float, dev_oracle: dict, names: list, counts: list, female_pcts: list,
    vecs: np.ndarray, normed: np.ndarray, emb_normed: np.ndarray,
    name_to_idx: dict, count_by_name: dict, fetch_k: int, reranker,
) -> dict:
    recalls_20, recalls_100, pool_stats_all = [], [], []

    for anchor, data in dev_oracle.items():
        if anchor not in name_to_idx:
            continue
        idx = name_to_idx[anchor]
        sex = data['sex']

        eligible_gold = [
            n for n in data['gold']
            if n in name_to_idx
            and count_by_name.get(n, 0) >= MIN_COUNT
            and sex_matches(female_pcts[name_to_idx[n]], sex)
        ]
        if not eligible_gold:
            continue

        if reranker is not None:
            recs_20, stats = get_recs_reranked_with_alpha(
                idx, sex, names, counts, female_pcts, vecs, normed, emb_normed,
                reranker, top_k=20, fetch_k=fetch_k, alpha=alpha,
            )
            recs_100, _ = get_recs_reranked_with_alpha(
                idx, sex, names, counts, female_pcts, vecs, normed, emb_normed,
                reranker, top_k=100, fetch_k=fetch_k, alpha=alpha,
            )
        else:
            recs_20, stats = get_recs_with_alpha(
                idx, sex, names, counts, female_pcts, normed,
                top_k=20, fetch_k=fetch_k, alpha=alpha,
            )
            recs_100, _ = get_recs_with_alpha(
                idx, sex, names, counts, female_pcts, normed,
                top_k=100, fetch_k=fetch_k, alpha=alpha,
            )

        rec_set_20 = set(recs_20)
        rec_set_100 = set(recs_100)
        recalls_20.append(sum(1 for n in eligible_gold if n in rec_set_20) / len(eligible_gold))
        recalls_100.append(sum(1 for n in eligible_gold if n in rec_set_100) / len(eligible_gold))
        pool_stats_all.append(stats)

    return {
        'recall_20': sum(recalls_20) / len(recalls_20) if recalls_20 else 0.0,
        'recall_100': sum(recalls_100) / len(recalls_100) if recalls_100 else 0.0,
        'mean_count': float(np.mean([s['mean_count'] for s in pool_stats_all])),
        'median_count': float(np.median([s['median_count'] for s in pool_stats_all])),
        'pct_rare': float(np.mean([s['pct_rare'] for s in pool_stats_all])),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scale', type=int, default=DEFAULT_SCALE)
    parser.add_argument('--fetch-k', type=int, default=DEFAULT_FETCH_K,
                        help='ANN pool size before alpha blend (default: 400)')
    parser.add_argument('--rerank', action='store_true',
                        help='Apply reranker after alpha blend (slower but more realistic)')
    parser.add_argument('--vectors', default=None)
    args = parser.parse_args()

    reranker = None
    if args.rerank:
        if not os.path.exists(RERANKER_PATH):
            print(f'ERROR: reranker not found at {RERANKER_PATH}')
            return
        with open(RERANKER_PATH, 'rb') as f:
            reranker = pickle.load(f)
        print(f'Loaded reranker from {RERANKER_PATH}')

    print(f'Loading vectors (scale={args.scale}x)...')
    names, counts, female_pcts, vecs, normed, emb_normed = load_vectors(
        args.scale, vectors_path=args.vectors)
    name_to_idx = {n: i for i, n in enumerate(names)}
    count_by_name = dict(zip(names, counts))
    print(f'Loaded {len(names):,} names\n')

    with open(ORACLE_PATH) as f:
        oracle_all = json.load(f)
    dev_oracle = {n: d for n, d in oracle_all.items() if d.get('split') == 'dev'}

    mode = 'cosine+rerank' if reranker else 'cosine only'
    print(f'Alpha sweep  (scale={args.scale}x, fetch_k={args.fetch_k}, rerank_k={RERANK_K}, {mode})')
    print(f'Candidate pool stats = raw top-{RERANK_K} before post-filters\n')

    col = 9
    header = (f'{"alpha":>6}  {"recall@20":>{col}}  {"recall@100":>{col}}'
              f'  {"mean_count":>{col}}  {"median_count":>{col}}  {"pct_rare":>{col}}  note')
    sep = '─' * len(header)
    print(sep)
    print(header)
    print(sep)

    baseline = None
    results = []
    for alpha in ALPHAS:
        r = recall_for_alpha(
            alpha, dev_oracle, names, counts, female_pcts,
            vecs, normed, emb_normed, name_to_idx, count_by_name,
            fetch_k=args.fetch_k, reranker=reranker,
        )
        results.append((alpha, r))
        if baseline is None:
            baseline = r

        recall_delta = r['recall_20'] - baseline['recall_20']
        rare_delta = r['pct_rare'] - baseline['pct_rare']
        note = ''
        if recall_delta < -0.03:
            note = '⚠ recall drop'
        elif rare_delta < -0.05 and recall_delta >= -0.01:
            note = '✓ good'

        print(f'{alpha:>6.2f}  {r["recall_20"]:>{col}.1%}  {r["recall_100"]:>{col}.1%}'
              f'  {r["mean_count"]:>{col},.0f}  {r["median_count"]:>{col},.0f}'
              f'  {r["pct_rare"]:>{col}.1%}  {note}')

    print(sep)

    # Recommendation: highest alpha where recall@20 >= baseline - 0.02
    threshold = baseline['recall_20'] - 0.02
    candidates = [(a, r) for a, r in results if r['recall_20'] >= threshold and a > 0]
    if candidates:
        best_alpha, best_r = max(candidates, key=lambda x: -x[1]['pct_rare'])
        print(f'\nRecommended alpha: {best_alpha}  '
              f'(recall@20={best_r["recall_20"]:.1%}, '
              f'rare={best_r["pct_rare"]:.1%} vs baseline {baseline["pct_rare"]:.1%})')
    else:
        print('\nNo alpha improved candidate quality without recall drop — check fetch_k.')

    print('\nNote: pct_rare = fraction of raw top-100 candidates with count < 200.')
    print('      Lower is better. recall@20 guard: must stay within 2pp of alpha=0 baseline.')


if __name__ == '__main__':
    main()
