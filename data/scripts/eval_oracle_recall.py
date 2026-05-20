"""
Oracle-based recall eval for baby name recommendations.
For each test case, checks whether gold names appear in top-K recommendations
and whether trap names (phonetically similar, wrong vibe) slip through.

Oracle is split into dev (10 names, used during tuning) and test (9 names,
held out — only reveal at the end of a tuning session). Never tune based on
test set scores. Always run eval_reddit_recall.py as a regression gate too.

No LLM needed per run. Oracle is generated once and stored in oracle_sets.json.
Complement to eval_recommendations.py (LLM judge) — use both.

Run: python3.12 data/scripts/eval_oracle_recall.py              # dev set only
     python3.12 data/scripts/eval_oracle_recall.py --split test  # reveal test
     python3.12 data/scripts/eval_oracle_recall.py --split all   # full view
     python3.12 data/scripts/eval_oracle_recall.py --verbose
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

# HC field positions (must match compute_vectors.py / train_reranker.py)
ORIGIN_END = 36
YEAR_DIM = 36
SYL_DIM = 37
GENDER_DIM = 51
POP_DIM = 54
ORIGIN_ACTIVE_VALUE = 2.0


def load_vectors(scale: int, embedding_only: bool = False, vectors_path: str = None):
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
    if embedding_only:
        scaled = emb * scale
    else:
        scaled = np.concatenate([hc, emb * scale], axis=1)
    norms = np.linalg.norm(scaled, axis=1, keepdims=True)
    norms[norms == 0] = 1e-9
    normed = scaled / norms
    return names, counts, female_pcts, vecs, normed


def origin_index(v: np.ndarray) -> int:
    for i in range(ORIGIN_END):
        if abs(v[i] - ORIGIN_ACTIVE_VALUE) < 0.01:
            return i
    return -1


def reranker_features(q_idx: int, c_idx: int, vecs: np.ndarray, normed: np.ndarray) -> list[float]:
    q, c = vecs[q_idx], vecs[c_idx]
    cos = float(normed[q_idx] @ normed[c_idx])
    year_diff = abs(float(q[YEAR_DIM]) - float(c[YEAR_DIM]))
    syl_diff = abs(float(q[SYL_DIM]) - float(c[SYL_DIM]))
    gender_diff = abs(float(q[GENDER_DIM]) - float(c[GENDER_DIM]))
    pop_diff = abs(float(q[POP_DIM]) - float(c[POP_DIM]))
    return [cos, year_diff, syl_diff, gender_diff, pop_diff]


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


def get_recs(idx: int, sex: str, names: list, counts: list, female_pcts: list,
             normed: np.ndarray, top_k: int) -> list[str]:
    sims = normed @ normed[idx]
    query_name = names[idx]
    results, prefix_counts = [], {}
    for i in np.argsort(sims)[::-1]:
        if len(results) >= top_k:
            break
        if i == idx:
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
        results.append(names[i])
    return results


def get_recs_reranked(idx: int, sex: str, names: list, counts: list, female_pcts: list,
                      vecs: np.ndarray, normed: np.ndarray, reranker, top_k: int,
                      retrieval_k: int = 100) -> list[str]:
    """Get top-retrieval_k candidates, re-rank with logistic regression, return top_k."""
    candidates = get_recs(idx, sex, names, counts, female_pcts, normed, retrieval_k)
    if not candidates:
        return []
    name_to_idx = {n: i for i, n in enumerate(names)}
    feat_matrix = np.array([
        reranker_features(idx, name_to_idx[c], vecs, normed)
        for c in candidates
        if c in name_to_idx
    ], dtype=np.float32)
    valid = [c for c in candidates if c in name_to_idx]
    if len(feat_matrix) == 0:
        return candidates[:top_k]
    scores = reranker.predict_proba(feat_matrix)[:, 1]
    ranked = [valid[i] for i in np.argsort(scores)[::-1]]
    return ranked[:top_k]


def fmt_list(names: list[str], limit: int = 5) -> str:
    shown = names[:limit]
    rest = len(names) - limit
    s = ', '.join(shown)
    return f'{s} +{rest}' if rest > 0 else s


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--top-k', type=int, default=20)
    parser.add_argument('--scale', type=int, default=4)
    parser.add_argument('--split', choices=['dev', 'test', 'all'], default='dev',
                        help='dev (default, tune against this), test (held-out), all')
    parser.add_argument('--embedding-only', action='store_true',
                        help='Use only the OpenAI embedding block, ignore all HC features')
    parser.add_argument('--rerank', action='store_true',
                        help='Re-rank top-100 ANN candidates using trained logistic regression model')
    parser.add_argument('--verbose', action='store_true',
                        help='Print full recommendation list per case')
    parser.add_argument('--vectors', default=None,
                        help='Path to vectors CSV (default: processed/name_vectors.csv). '
                             'Use to evaluate a staging file, e.g. processed/name_vectors_large.csv')
    args = parser.parse_args()

    reranker = None
    if args.rerank:
        if not os.path.exists(RERANKER_PATH):
            print(f'ERROR: reranker not found at {RERANKER_PATH}')
            print('Run: python3.12 data/scripts/train_reranker.py')
            return
        with open(RERANKER_PATH, 'rb') as f:
            reranker = pickle.load(f)
        print(f'Loaded re-ranker from {RERANKER_PATH}')

    vectors_path = args.vectors or DEFAULT_VECTORS_PATH
    mode = 'embedding only' if args.embedding_only else f'scale={args.scale}x'
    if args.rerank:
        mode += ' + rerank'
    if args.vectors:
        mode += f' [{os.path.basename(args.vectors)}]'
    print(f'Loading vectors ({mode})...')
    names, counts, female_pcts, vecs, normed = load_vectors(args.scale, args.embedding_only,
                                                             vectors_path=vectors_path)
    name_to_idx = {n: i for i, n in enumerate(names)}
    count_by_name = {n: c for n, c in zip(names, counts)}
    print(f'Loaded {len(names):,} names\n')

    with open(ORACLE_PATH) as f:
        oracle_all = json.load(f)

    if args.split == 'all':
        oracle = oracle_all
    else:
        oracle = {n: d for n, d in oracle_all.items() if d.get('split') == args.split}

    if args.split == 'test':
        print('⚠  TEST SET — do not tune based on these scores\n')
    elif args.split == 'dev':
        print('Dev set (tune here; run --split test only to validate at session end)\n')

    top_k = args.top_k
    recalls, trap_rates = [], []

    header = f'{"Name":12}  {"Elig":>5}  {"Recall":>8}  {"Trap":>7}  Gold found'
    sep = '─' * 80
    print(f'Oracle recall eval  (scale={args.scale}x, top-{top_k})')
    print(sep)
    print(header)
    print(sep)

    for anchor, data in oracle.items():
        if anchor not in name_to_idx:
            print(f'  {anchor}: NOT IN VECTORS — skipping')
            continue

        idx = name_to_idx[anchor]
        sex = data['sex']
        if reranker is not None:
            recs = get_recs_reranked(idx, sex, names, counts, female_pcts,
                                     vecs, normed, reranker, top_k)
        else:
            recs = get_recs(idx, sex, names, counts, female_pcts, normed, top_k)
        rec_set = set(recs)

        # eligible gold = gold names that could in principle be returned (pass min_count + sex filter)
        eligible_gold = [
            n for n in data['gold']
            if n in name_to_idx
            and count_by_name.get(n, 0) >= MIN_COUNT
            and sex_matches(female_pcts[name_to_idx[n]], sex)
        ]
        gold_found = [n for n in eligible_gold if n in rec_set]
        recall = len(gold_found) / len(eligible_gold) if eligible_gold else 0.0

        traps_hit = [n for n in data['trap'] if n in rec_set]
        trap_rate = len(traps_hit) / len(data['trap']) if data['trap'] else 0.0

        recalls.append(recall)
        trap_rates.append(trap_rate)

        warn = ' ⚠' if trap_rate > 0 else ''
        found_str = fmt_list(gold_found) if gold_found else '—'
        print(f'{anchor:12}  {len(eligible_gold):>5}  {recall:>7.0%}  {trap_rate:>6.0%}{warn}  {found_str}')

        if args.verbose:
            missed = [n for n in eligible_gold if n not in rec_set]
            print(f'  {"full recs:":12} {", ".join(recs)}')
            if missed:
                print(f'  {"missed gold:":12} {", ".join(missed)}')
            if traps_hit:
                print(f'  {"traps hit:":12} {", ".join(traps_hit)}')
            print()

    print(sep)
    mean_recall = sum(recalls) / len(recalls)
    mean_trap = sum(trap_rates) / len(trap_rates)

    best_name = list(oracle.keys())[recalls.index(max(recalls))]
    worst_name = list(oracle.keys())[recalls.index(min(recalls))]
    worst_trap = list(oracle.keys())[trap_rates.index(max(trap_rates))]

    print(f'Mean recall@{top_k}:  {mean_recall:.0%}  '
          f'(best: {best_name} {max(recalls):.0%}, worst: {worst_name} {min(recalls):.0%})')
    print(f'Mean trap@{top_k}:    {mean_trap:.0%}  '
          f'(worst offender: {worst_trap} {max(trap_rates):.0%})')

    trap_cases = sum(1 for r in trap_rates if r > 0)
    if trap_cases:
        print(f'\n⚠  {trap_cases}/{len(trap_rates)} cases had at least one trap name in top-{top_k}')

    if args.split == 'dev':
        print('\nRegression gate: run eval_reddit_recall.py and confirm recall@20 ≥ 0.035 before committing.')


if __name__ == '__main__':
    main()
