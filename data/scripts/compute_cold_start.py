"""
Compute a diverse cold-start deck via k-means clustering on name_vectors.

For each gender (M/F):
  - Filter to names with 2025 rank <= 300
  - Run k-means with k=10 clusters on the 564-dim embeddings
  - Select the top 3 names by 2025 rank from each cluster
  - Output the 30-name cold-start deck

Result is printed as JSON for easy use as a Lambda constant.
"""

import ast
import csv
import json
import os
from collections import defaultdict

import numpy as np
from sklearn.cluster import KMeans

DATA_DIR = os.path.join(os.path.dirname(__file__), '..')
VECTORS_CSV = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')
SSA_2025    = os.path.join(DATA_DIR, 'raw', 'ssa', 'yob2025.txt')

K_CLUSTERS   = 10
NAMES_PER_CLUSTER = 3
RANK_CUTOFF  = 300
FEMALE_THRESHOLD = 0.5   # female_pct >= 0.5 → girl pool; < 0.5 → boy pool


def load_2025_ranks():
    """Returns {name -> rank} within each gender, separately for M and F."""
    counts: dict[str, dict[str, int]] = {'F': {}, 'M': {}}
    with open(SSA_2025) as f:
        for line in f:
            name, gender, count = line.strip().split(',')
            counts[gender][name] = counts[gender].get(name, 0) + int(count)

    ranks: dict[str, dict[str, int]] = {'F': {}, 'M': {}}
    for gender in ('F', 'M'):
        sorted_names = sorted(counts[gender], key=lambda n: -counts[gender][n])
        for rank, name in enumerate(sorted_names, start=1):
            ranks[gender][name] = rank
    return ranks


def load_vectors():
    """Returns list of (name, female_pct, embedding_array)."""
    rows = []
    with open(VECTORS_CSV, newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                vec = np.array(ast.literal_eval(row['vector']), dtype=np.float32)
                rows.append((row['name'], float(row['female_pct']), vec))
            except Exception:
                continue
    return rows


def build_deck_for_gender(gender: str, vectors, ranks) -> list[dict]:
    gender_ranks = ranks[gender]

    # Filter to names in top RANK_CUTOFF for this gender
    pool = [
        (name, female_pct, vec)
        for name, female_pct, vec in vectors
        if name in gender_ranks
        and gender_ranks[name] <= RANK_CUTOFF
        and (female_pct >= FEMALE_THRESHOLD if gender == 'F' else female_pct < FEMALE_THRESHOLD)
    ]

    print(f"\n{gender} pool size (rank ≤ {RANK_CUTOFF}): {len(pool)}")

    names   = [r[0] for r in pool]
    embeddings = np.array([r[2] for r in pool])

    # Normalize embeddings for cosine-like clustering
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    embeddings_norm = embeddings / norms

    km = KMeans(n_clusters=K_CLUSTERS, random_state=42, n_init=10)
    labels = km.fit_predict(embeddings_norm)

    # Group by cluster, sort within cluster by 2025 rank, take top NAMES_PER_CLUSTER
    clusters: dict[int, list[tuple[str, int]]] = defaultdict(list)
    for name, label in zip(names, labels):
        clusters[int(label)].append((name, gender_ranks[name]))

    deck = []
    for cluster_id in sorted(clusters):
        cluster_names = sorted(clusters[cluster_id], key=lambda x: x[1])
        selected = cluster_names[:NAMES_PER_CLUSTER]
        for name, rank in selected:
            deck.append({'name': name, 'rank': rank, 'cluster': cluster_id})

    deck.sort(key=lambda x: (x['cluster'], x['rank']))
    return deck


def main():
    print("Loading data...")
    ranks   = load_2025_ranks()
    vectors = load_vectors()
    print(f"Loaded {len(vectors)} name vectors")

    results = {}
    for gender in ('F', 'M'):
        deck = build_deck_for_gender(gender, vectors, ranks)
        results[gender] = deck
        label = 'Girls' if gender == 'F' else 'Boys'
        print(f"\n=== {label} cold-start deck ({len(deck)} names) ===")
        for i, entry in enumerate(deck, 1):
            print(f"  {i:2d}. {entry['name']:<14} rank #{entry['rank']:>3}  (cluster {entry['cluster']})")

    # Output JSON constant for embedding in Lambda
    print("\n\n=== JSON for Lambda constant ===")
    print(json.dumps({
        'F': [e['name'] for e in results['F']],
        'M': [e['name'] for e in results['M']],
    }, indent=2))


if __name__ == '__main__':
    main()
