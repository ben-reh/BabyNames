"""
K-sweep analysis: measure oracle recall@K across K ∈ [20,50,100,150,200] and scale ∈ [3,4,5,6].
Confirms optimal retrieval pool size (coverage vs. latency trade-off).
Also classifies each dev anchor as retrieval failure vs. ranking failure.

Run: python3.12 data/scripts/sweep_retrieval_k.py
"""
import csv
import json
import os

import numpy as np

SCRIPTS_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPTS_DIR, '..')
DEFAULT_VECTORS_PATH = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')
ORACLE_PATH = os.path.join(DATA_DIR, 'processed', 'oracle_sets.json')

HC_DIMS = 55
EMBED_DIMS = 512
MIN_COUNT = 200
MAX_SAME_PREFIX = 2
SEX_FILTER_F = 0.10
SEX_FILTER_M = 0.90

SCALES = [3, 4, 5, 6]
K_VALUES = [20, 50, 100, 150, 200]


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


def load_vectors(vectors_path: str = None):
    if vectors_path is None:
        vectors_path = DEFAULT_VECTORS_PATH
    names, counts, female_pcts, hc_vecs, emb_vecs = [], [], [], [], []
    with open(vectors_path) as f:
        for row in csv.DictReader(f):
            v = json.loads(row['vector'])
            names.append(row['name'])
            counts.append(int(row.get('count_2025', 0)))
            female_pcts.append(float(row.get('female_pct', 0.5)))
            hc_vecs.append(v[:HC_DIMS])
            emb_vecs.append(v[HC_DIMS:HC_DIMS + EMBED_DIMS])
    return (names, counts, female_pcts,
            np.array(hc_vecs, dtype=np.float32),
            np.array(emb_vecs, dtype=np.float32))


def make_normed(hc: np.ndarray, emb: np.ndarray, scale: int) -> np.ndarray:
    scaled = np.concatenate([hc, emb * scale], axis=1)
    norms = np.linalg.norm(scaled, axis=1, keepdims=True)
    norms[norms == 0] = 1e-9
    return scaled / norms


def recall_at_k(anchor: str, data: dict, idx: int, names: list, counts: list,
                female_pcts: list, name_to_idx: dict, count_by_name: dict,
                normed: np.ndarray, k: int) -> float | None:
    sex = data['sex']
    eligible_gold = [
        n for n in data['gold']
        if n in name_to_idx
        and count_by_name.get(n, 0) >= MIN_COUNT
        and sex_matches(female_pcts[name_to_idx[n]], sex)
    ]
    if not eligible_gold:
        return None
    recs = set(get_recs(idx, sex, names, counts, female_pcts, normed, k))
    return sum(1 for n in eligible_gold if n in recs) / len(eligible_gold)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--vectors', default=None,
                        help='Path to vectors CSV (default: processed/name_vectors.csv)')
    args = parser.parse_args()

    print("Loading vectors...")
    names, counts, female_pcts, hc, emb = load_vectors(args.vectors)
    name_to_idx = {n: i for i, n in enumerate(names)}
    count_by_name = dict(zip(names, counts))
    print(f"Loaded {len(names):,} names\n")

    with open(ORACLE_PATH) as f:
        oracle_all = json.load(f)
    dev_oracle = {n: d for n, d in oracle_all.items() if d.get('split') == 'dev'}

    normed_by_scale = {s: make_normed(hc, emb, s) for s in SCALES}

    # ── Scale × K recall table ────────────────────────────────────────────────
    col_w = 7
    header = f"{'Scale':>6}  " + "  ".join(f"@{k:<{col_w-1}}" for k in K_VALUES)
    sep = "─" * len(header)
    print("Oracle recall@K sweep (dev set)")
    print(sep)
    print(header)
    print(sep)

    best_recall, best_config = 0.0, (4, 100)
    table: dict[tuple, float] = {}

    for scale in SCALES:
        normed = normed_by_scale[scale]
        row_cells = [f"{scale:>5}x"]
        for k in K_VALUES:
            recalls = [
                r for anchor, data in dev_oracle.items()
                if anchor in name_to_idx
                for r in [recall_at_k(anchor, data, name_to_idx[anchor],
                                      names, counts, female_pcts, name_to_idx,
                                      count_by_name, normed, k)]
                if r is not None
            ]
            mean = sum(recalls) / len(recalls) if recalls else 0.0
            table[(scale, k)] = mean
            row_cells.append(f"{mean:>{col_w}.0%}")
            if mean > best_recall:
                best_recall, best_config = mean, (scale, k)
        print("  ".join(row_cells))

    print(sep)
    print(f"Best: scale={best_config[0]}x, K={best_config[1]} → {best_recall:.0%}")

    # ── Marginal gain per 50 additional names (scale=4) ───────────────────────
    print("\nMarginal recall gain per additional names retrieved (scale=4x, mean across anchors)")
    normed4 = normed_by_scale[4]
    prev_by_anchor: dict[str, float] = {a: 0.0 for a in dev_oracle}
    for k in K_VALUES:
        gains = []
        for anchor, data in dev_oracle.items():
            if anchor not in name_to_idx:
                continue
            r = recall_at_k(anchor, data, name_to_idx[anchor], names, counts, female_pcts,
                             name_to_idx, count_by_name, normed4, k)
            if r is not None:
                gains.append(r - prev_by_anchor[anchor])
                prev_by_anchor[anchor] = r
        if gains:
            print(f"  K={k:>3}: mean recall = {table[(4, k)]:.0%}  (+{sum(gains)/len(gains):.1%} marginal)")

    # ── Per-anchor failure classification (scale=4) ───────────────────────────
    print("\nPer-anchor failure classification (scale=4x)")
    print(f"{'Anchor':12}  {'@20':>5}  {'@50':>5}  {'@100':>6}  {'@150':>6}  {'@200':>6}  Type")
    print("─" * 72)
    for anchor, data in dev_oracle.items():
        if anchor not in name_to_idx:
            continue
        row_vals = [
            recall_at_k(anchor, data, name_to_idx[anchor], names, counts, female_pcts,
                        name_to_idx, count_by_name, normed4, k)
            for k in [20, 50, 100, 150, 200]
        ]
        if any(r is None for r in row_vals):
            continue
        r20, r50, r100, r150, r200 = row_vals
        if r100 < 0.25:
            note = "retrieval failure"
        elif r20 < 0.30 and r100 >= 0.40:
            note = "ranking failure"
        else:
            note = "ok"
        vals = "  ".join(f"{r:>5.0%}" for r in row_vals)
        print(f"{anchor:12}  {vals}  {note}")


if __name__ == '__main__':
    main()
