"""
Pre-compute 16 representative names for the onboarding gallery.

Clusters the name embedding space (dims 55-566) with k=16 k-means,
then picks the actual name closest to each centroid with count_2025 > 500.
The count floor ensures names are recognizable without skewing toward top-50 megapopular names.

Run from repo root:
  python3.12 data/scripts/compute_onboarding_gallery.py
"""

import ast
import csv
import os

import numpy as np
from sklearn.cluster import KMeans

DATA_DIR    = os.path.join(os.path.dirname(__file__), '..')
VECTORS_CSV = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')

HC_DIMS    = 55
EMBED_DIMS = 512
K          = 16
MIN_COUNT  = 500


def main() -> None:
    names: list[str] = []
    embeddings: list[np.ndarray] = []
    counts: list[int] = []

    print('Loading name vectors...')
    with open(VECTORS_CSV, newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            count = int(row['count_2025'])
            if count < MIN_COUNT:
                continue
            vec = np.array(ast.literal_eval(row['vector']), dtype=np.float32)
            emb = vec[HC_DIMS:HC_DIMS + EMBED_DIMS]
            names.append(row['name'])
            embeddings.append(emb)
            counts.append(count)

    X = np.array(embeddings)
    print(f'Clustering {len(names)} names (count >= {MIN_COUNT}) with k={K}...')

    km = KMeans(n_clusters=K, random_state=42, n_init=10)
    km.fit(X)

    gallery: list[str] = []
    seen: set[str] = set()

    for centroid in km.cluster_centers_:
        dists = np.sum((X - centroid) ** 2, axis=1)
        # Walk candidates in order of distance; skip duplicates (rare but possible)
        for idx in np.argsort(dists):
            name = names[idx]
            if name not in seen:
                seen.add(name)
                gallery.append(name)
                break

    print(f'\nOnboarding gallery ({len(gallery)} names, count >= {MIN_COUNT}):')
    for i, name in enumerate(gallery, 1):
        idx = names.index(name)
        print(f'  {i:2d}. {name:<16}  count={counts[idx]:,}')

    print(f'\nPython list:\n{gallery}')


if __name__ == '__main__':
    main()
