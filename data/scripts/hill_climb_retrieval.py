"""
Coordinate-descent hill climbing over embedding_scale and origin_weight.
Optimizes oracle recall@100 (dev) while holding Juniper recall@20 >= 60% as a hard guard.
Runs at eval time — no vector rebuild required.

Run: python3.12 data/scripts/hill_climb_retrieval.py
     python3.12 data/scripts/hill_climb_retrieval.py --init-scale 5 --init-origin 1.5
     python3.12 data/scripts/hill_climb_retrieval.py --verbose
"""
import argparse
import csv
import json
import os

import numpy as np

SCRIPTS_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPTS_DIR, '..')
DEFAULT_VECTORS_PATH = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')
ORACLE_PATH = os.path.join(DATA_DIR, 'processed', 'oracle_sets.json')
BEST_PARAMS_PATH = os.path.join(DATA_DIR, 'processed', 'best_retrieval_params.json')

HC_DIMS = 55
EMBED_DIMS = 512
MIN_COUNT = 200
MAX_SAME_PREFIX = 2
SEX_FILTER_F = 0.10
SEX_FILTER_M = 0.90
ORIGIN_END = 36          # HC dims [0:36] are origin one-hot, stored at ORIGIN_SCALE=2.0
STORED_ORIGIN_SCALE = 1.5
JUNIPER_FLOOR = 0.60     # hard guard: Juniper recall@20 must stay >= this

SCALE_GRID = [3.0, 4.0, 5.0, 6.0, 8.0]
ORIGIN_GRID = [0.5, 1.0, 1.5, 2.0, 3.0]
SCALE_STEP = 1.0
ORIGIN_STEP = 0.5
MAX_ITERS = 50


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


def make_normed(hc: np.ndarray, emb: np.ndarray, scale: float, origin_weight: float) -> np.ndarray:
    hc_adj = hc.copy()
    hc_adj[:, :ORIGIN_END] *= (origin_weight / STORED_ORIGIN_SCALE)
    scaled = np.concatenate([hc_adj, emb * scale], axis=1)
    norms = np.linalg.norm(scaled, axis=1, keepdims=True)
    norms[norms == 0] = 1e-9
    return scaled / norms


def evaluate(scale: float, origin_weight: float,
             names: list, counts: list, female_pcts: list,
             hc: np.ndarray, emb: np.ndarray,
             dev_oracle: dict, name_to_idx: dict, count_by_name: dict,
             verbose: bool = False) -> tuple[float, float]:
    """Returns (mean_recall@100, juniper_recall@20)."""
    normed = make_normed(hc, emb, scale, origin_weight)
    recalls100, recalls20 = [], []
    juniper_r20 = 0.0

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

        recs100 = set(get_recs(idx, sex, names, counts, female_pcts, normed, 100))
        recs20 = set(get_recs(idx, sex, names, counts, female_pcts, normed, 20))

        r100 = sum(1 for n in eligible_gold if n in recs100) / len(eligible_gold)
        r20 = sum(1 for n in eligible_gold if n in recs20) / len(eligible_gold)
        recalls100.append(r100)
        recalls20.append(r20)

        if anchor == 'Juniper':
            juniper_r20 = r20

    mean_r100 = sum(recalls100) / len(recalls100) if recalls100 else 0.0
    mean_r20 = sum(recalls20) / len(recalls20) if recalls20 else 0.0

    if verbose:
        print(f"  scale={scale:.1f} origin={origin_weight:.1f}  "
              f"recall@100={mean_r100:.1%}  recall@20={mean_r20:.1%}  "
              f"Juniper@20={juniper_r20:.1%}")

    return mean_r100, juniper_r20


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--init-scale', type=float, default=4.0)
    parser.add_argument('--init-origin', type=float, default=2.0)
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--vectors', default=None,
                        help='Path to vectors CSV (default: processed/name_vectors.csv). '
                             'Use to evaluate a staging file, e.g. processed/name_vectors_large.csv')
    args = parser.parse_args()

    print("Loading vectors...")
    names, counts, female_pcts, hc, emb = load_vectors(args.vectors)
    name_to_idx = {n: i for i, n in enumerate(names)}
    count_by_name = dict(zip(names, counts))
    print(f"Loaded {len(names):,} names\n")

    with open(ORACLE_PATH) as f:
        oracle_all = json.load(f)
    dev_oracle = {n: d for n, d in oracle_all.items() if d.get('split') == 'dev'}

    eval_kwargs = dict(names=names, counts=counts, female_pcts=female_pcts,
                       hc=hc, emb=emb, dev_oracle=dev_oracle,
                       name_to_idx=name_to_idx, count_by_name=count_by_name)

    # ── Grid search first to find a good starting point ──────────────────────
    print("Running grid search over scale × origin_weight...")
    print(f"\n{'Scale':>7}  " + "  ".join(f"ow={ow:.1f}" for ow in ORIGIN_GRID))
    print("─" * (9 + 9 * len(ORIGIN_GRID)))
    grid_results: dict[tuple, tuple[float, float]] = {}
    for scale in SCALE_GRID:
        row = [f"{scale:>6.1f}x"]
        for ow in ORIGIN_GRID:
            r100, j20 = evaluate(scale, ow, **eval_kwargs)
            grid_results[(scale, ow)] = (r100, j20)
            guard = "" if j20 >= JUNIPER_FLOOR else "!"
            row.append(f"{r100:>5.0%}{guard}")
        print("  ".join(row))
    print("  (! = Juniper@20 below 60% floor)\n")

    # Best grid point that passes the Juniper guard
    valid = {k: v for k, v in grid_results.items() if v[1] >= JUNIPER_FLOOR}
    if not valid:
        print("WARNING: no grid point passes the Juniper floor — relaxing guard for hill climb")
        valid = grid_results
    best_scale, best_ow = max(valid, key=lambda k: valid[k][0])
    best_r100, best_j20 = valid[(best_scale, best_ow)]
    print(f"Grid best (with Juniper guard): scale={best_scale:.1f} origin={best_ow:.1f}  "
          f"recall@100={best_r100:.1%}  Juniper@20={best_j20:.1%}\n")

    # Override with user's init if it's better
    init_r100, init_j20 = evaluate(args.init_scale, args.init_origin, **eval_kwargs)
    if init_r100 > best_r100 and init_j20 >= JUNIPER_FLOOR:
        best_scale, best_ow = args.init_scale, args.init_origin
        best_r100, best_j20 = init_r100, init_j20
        print(f"  Using user init: scale={best_scale:.1f} origin={best_ow:.1f}\n")

    # ── Coordinate-descent refinement ────────────────────────────────────────
    print("Running coordinate-descent hill climb...")
    history = [(best_scale, best_ow, best_r100, best_j20, "initial")]

    for iteration in range(MAX_ITERS):
        improved = False
        for param, step in [('scale', SCALE_STEP), ('origin', ORIGIN_STEP)]:
            for direction in [+1, -1]:
                if param == 'scale':
                    candidate_scale = round(best_scale + direction * step, 1)
                    candidate_ow = best_ow
                else:
                    candidate_scale = best_scale
                    candidate_ow = round(best_ow + direction * step, 1)

                if candidate_scale < 1.0 or candidate_scale > 12.0:
                    continue
                if candidate_ow < 0.25 or candidate_ow > 5.0:
                    continue

                r100, j20 = evaluate(candidate_scale, candidate_ow, **eval_kwargs,
                                     verbose=args.verbose)

                if r100 > best_r100 and j20 >= JUNIPER_FLOOR:
                    best_scale, best_ow = candidate_scale, candidate_ow
                    best_r100, best_j20 = r100, j20
                    label = f"scale {'+' if direction > 0 else '-'}{step}" if param == 'scale' \
                        else f"origin {'+' if direction > 0 else '-'}{step}"
                    history.append((best_scale, best_ow, best_r100, best_j20, label))
                    print(f"  iter {iteration + 1}: {label} → scale={best_scale:.1f} "
                          f"origin={best_ow:.1f}  recall@100={best_r100:.1%}")
                    improved = True
                    break
            if improved:
                break
        if not improved:
            print(f"  iter {iteration + 1}: no improvement — converged")
            break

    # ── Results ───────────────────────────────────────────────────────────────
    print(f"\nFinal: scale={best_scale:.1f}  origin_weight={best_ow:.1f}")
    print(f"       recall@100={best_r100:.1%}  Juniper@20={best_j20:.1%}")

    # Per-anchor breakdown at best config
    normed_best = make_normed(hc, emb, best_scale, best_ow)
    print(f"\nPer-anchor recall at best config (scale={best_scale:.1f}, origin={best_ow:.1f}):")
    print(f"{'Anchor':12}  {'@20':>5}  {'@100':>6}")
    print("─" * 30)
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
        recs20 = set(get_recs(idx, sex, names, counts, female_pcts, normed_best, 20))
        recs100 = set(get_recs(idx, sex, names, counts, female_pcts, normed_best, 100))
        r20 = sum(1 for n in eligible_gold if n in recs20) / len(eligible_gold)
        r100 = sum(1 for n in eligible_gold if n in recs100) / len(eligible_gold)
        print(f"{anchor:12}  {r20:>5.0%}  {r100:>6.0%}")

    params = {
        'embedding_scale': best_scale,
        'origin_weight': best_ow,
        'recall_at_100': round(best_r100, 4),
        'juniper_recall_at_20': round(best_j20, 4),
    }
    with open(BEST_PARAMS_PATH, 'w') as f:
        json.dump(params, f, indent=2)
    print(f"\nSaved best params to {BEST_PARAMS_PATH}")


if __name__ == '__main__':
    main()
