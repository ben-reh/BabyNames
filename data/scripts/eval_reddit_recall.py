"""
Co-occurrence recall eval using Reddit and Nameberry shortlists.
Tests whether names co-listed by real parents appear in each other's top-K recommendations.

NOT a replacement for eval_recommendations.py — an additional programmatic signal.
Requires no LLM; runs locally from name_vectors.csv.

Limitations:
  - Both sources over-represent vintage/literary/Western names
  - Co-listed != similar; low recall is a soft signal, not a verdict
  - Run alongside eval_recommendations.py; does not replace the LLM judge

Run: python3.12 data/scripts/eval_reddit_recall.py
     python3.12 data/scripts/eval_reddit_recall.py --top-k 50
     python3.12 data/scripts/eval_reddit_recall.py --source reddit   # one source only
     python3.12 data/scripts/eval_reddit_recall.py --source nameberry
"""
import argparse
import csv
import json
import os
import numpy as np

SCRIPTS_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPTS_DIR, '..')
VECTORS_PATH = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')
SOURCES = {
    'reddit':     os.path.join(DATA_DIR, 'raw', 'reddit', 'name_lists.jsonl'),
    'nameberry':  os.path.join(DATA_DIR, 'raw', 'nameberry', 'name_lists.jsonl'),
}

HC_DIMS = 55
EMBED_DIMS = 512
EMBEDDING_SCALE = 5
MIN_COUNT = 200
MIN_NAMES_PER_POST = 4
MAX_NAMES_PER_POST = 20  # filters game/list threads
MAX_SAME_PREFIX = 2

SEX_FILTER_F = 0.10
SEX_FILTER_M = 0.90

# Posts with these title keywords have a hard phonetic constraint baked in
# (names for Zinnia's sister), not a free preference cluster.
CONSTRAINED_KEYWORDS = [
    'sibling', 'sister', 'brother',
    'middle name', 'middle-name',
    'goes with', 'pairs with',
    'honor name', 'honor-name',
]


def load_vectors():
    names, counts, female_pcts, hc_vecs, emb_vecs = [], [], [], [], []
    with open(VECTORS_PATH) as f:
        for row in csv.DictReader(f):
            v = json.loads(row['vector'])
            names.append(row['name'])
            counts.append(int(row.get('count_2025', 0)))
            female_pcts.append(float(row.get('female_pct', 0.5)))
            hc_vecs.append(v[:HC_DIMS])
            emb_vecs.append(v[HC_DIMS:HC_DIMS + EMBED_DIMS])
    hc = np.array(hc_vecs, dtype=np.float32)
    emb = np.array(emb_vecs, dtype=np.float32)
    scaled = np.concatenate([hc, emb * EMBEDDING_SCALE], axis=1)
    norms = np.linalg.norm(scaled, axis=1, keepdims=True)
    norms[norms == 0] = 1e-9
    normed = scaled / norms
    return names, counts, female_pcts, normed


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


def infer_sex(female_pct: float) -> str:
    if female_pct >= 0.70:
        return 'F'
    if female_pct <= 0.30:
        return 'M'
    return 'U'


def sex_matches(candidate_fp: float, query_sex: str) -> bool:
    if query_sex == 'F':
        return candidate_fp >= SEX_FILTER_F
    if query_sex == 'M':
        return candidate_fp <= SEX_FILTER_M
    return True


def get_recs(idx: int, names: list[str], counts: list[int], female_pcts: list[float],
             normed: np.ndarray, top_k: int) -> list[str]:
    query_sex = infer_sex(female_pcts[idx])
    query_name = names[idx]
    sims = normed @ normed[idx]

    results = []
    prefix_counts: dict[str, int] = {}

    for i in np.argsort(sims)[::-1]:
        if len(results) >= top_k:
            break
        if i == idx:
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
        results.append(names[i])

    return results


def is_constrained(title: str) -> bool:
    t = title.lower()
    return any(kw in t for kw in CONSTRAINED_KEYWORDS)


def load_posts(name_set: set[str], source_filter: str | None = None) -> list[dict]:
    posts = []
    totals: dict[str, int] = {}

    sources = {k: v for k, v in SOURCES.items()
               if source_filter is None or k == source_filter}

    for source_name, path in sources.items():
        if not os.path.exists(path):
            print(f"  {source_name}: file not found at {path}, skipping")
            continue
        total = constrained = too_few = too_many = 0
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                post = json.loads(line)
                total += 1
                if is_constrained(post.get('title', '')):
                    constrained += 1
                    continue
                matched = [n for n in post.get('names', []) if n in name_set]
                if len(matched) < MIN_NAMES_PER_POST:
                    too_few += 1
                    continue
                if len(matched) > MAX_NAMES_PER_POST:
                    too_many += 1
                    continue
                # normalise source field: Nameberry uses 'source', Reddit uses 'subreddit'
                post = {**post, 'names': matched,
                        'source': post.get('source', post.get('subreddit', source_name))}
                posts.append(post)
        totals[source_name] = total
        print(f"  {source_name}: {total} total → "
              f"{constrained} constrained, {too_few} too few names, "
              f"{too_many} too many (game posts) → "
              f"{total - constrained - too_few - too_many} usable")

    print(f"Combined usable posts: {len(posts)}")
    return posts


def print_distribution(recalls: list[float], top_k: int) -> None:
    buckets = [0, 0, 0, 0, 0]
    for r in recalls:
        if r == 0:
            buckets[0] += 1
        elif r <= 0.25:
            buckets[1] += 1
        elif r <= 0.50:
            buckets[2] += 1
        elif r <= 0.75:
            buckets[3] += 1
        else:
            buckets[4] += 1
    labels = ['0%', '1–25%', '26–50%', '51–75%', '76–100%']
    print(f"Distribution (recall@{top_k}):")
    for label, count in zip(labels, buckets):
        pct = count / len(recalls) * 100
        bar = '█' * int(pct / 2)
        print(f"  {label:8}  {pct:5.1f}%  {bar}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Co-occurrence recall eval")
    parser.add_argument('--top-k', type=int, default=20, help="Recall@K (default: 20)")
    parser.add_argument('--source', choices=list(SOURCES.keys()),
                        help="Load only this source (default: all)")
    args = parser.parse_args()
    top_k = args.top_k

    print(f"Loading vectors from {VECTORS_PATH}...")
    names, counts, female_pcts, normed = load_vectors()
    name_to_idx = {n: i for i, n in enumerate(names)}
    print(f"Loaded {len(names):,} names\n")

    posts = load_posts(set(names), source_filter=args.source)
    if not posts:
        print("No usable posts. Check filter keywords and JSONL path.")
        return

    total_pairs = sum(len(p['names']) for p in posts)
    print(f"Total (post, name) pairs: {total_pairs:,}\n")
    print("Running eval...", end='', flush=True)

    all_recalls: list[float] = []
    post_results: list[tuple[str, str, list[str], float]] = []
    subreddit_recalls: dict[str, list[float]] = {}

    for post in posts:
        post_names = post['names']
        post_name_set = set(post_names)
        pair_recalls = []

        for name in post_names:
            idx = name_to_idx[name]
            recs = set(get_recs(idx, names, counts, female_pcts, normed, top_k))
            others = post_name_set - {name}
            recall = len(recs & others) / len(others) if others else 0.0
            all_recalls.append(recall)
            pair_recalls.append(recall)

        mean_post_recall = sum(pair_recalls) / len(pair_recalls)
        post_results.append((post['post_id'], post.get('source', '?'), post_names, mean_post_recall))

        sub = post.get('source', 'unknown')
        subreddit_recalls.setdefault(sub, []).extend(pair_recalls)

    print(" done.\n")

    mean_recall = sum(all_recalls) / len(all_recalls)
    print(f"Co-occurrence recall@{top_k}: {mean_recall:.3f}\n")

    print_distribution(all_recalls, top_k)

    if len(subreddit_recalls) > 1:
        print("By source:")
        for sub, recalls in sorted(subreddit_recalls.items()):
            avg = sum(recalls) / len(recalls)
            print(f"  {sub:20}  recall@{top_k}: {avg:.3f}  ({len(recalls)} pairs, {len([r for r in recalls if r > 0]) / len(recalls) * 100:.0f}% non-zero)")
        print()

    worst = sorted(post_results, key=lambda x: x[3])[:10]
    print(f"Worst posts (lowest mean recall@{top_k}):")
    for post_id, sub, pnames, mean_r in worst:
        name_str = ', '.join(pnames[:6]) + ('…' if len(pnames) > 6 else '')
        print(f"  {post_id} [{sub}] {mean_r:.2f}: {name_str}")


if __name__ == '__main__':
    main()
