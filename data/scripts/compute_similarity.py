"""
Precomputes vibe_names (embedding cosine) and phonetic_names (phoneme similarity)
for each name. Reads all-names.csv + name_vectors.csv, writes similar_names.csv.
Run after compute_vectors.py.
"""
import csv
import json
import os
from collections import defaultdict
from difflib import SequenceMatcher

import numpy as np

SCRIPTS_DIR = os.path.dirname(__file__)
RAW_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw')
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')

VIBE_TOP_N = 10
PHONETIC_TOP_N = 8


def load_names():
    names = {}
    with open(os.path.join(RAW_DIR, 'all-names.csv')) as f:
        for row in csv.DictReader(f):
            pron = row.get('pronunciations', '').split('|')[0].strip()
            try:
                syllables = int(row['syllables']) if row.get('syllables') else 0
            except ValueError:
                syllables = 0
            names[row['name']] = {
                'name': row['name'],
                'sex': row.get('sex', ''),
                'phonemes': tuple(pron.split()) if pron else (),
                'syllables': syllables,
            }
    return names


def load_vectors():
    vectors = {}
    path = os.path.join(PROCESSED_DIR, 'name_vectors.csv')
    if not os.path.exists(path):
        print("Warning: name_vectors.csv not found — vibe_names will be empty")
        return vectors
    with open(path) as f:
        for row in csv.DictReader(f):
            vectors[row['name']] = np.array(json.loads(row['vector']), dtype=np.float32)
    return vectors


def compute_vibe_names(names, vectors):
    """Top-VIBE_TOP_N nearest neighbors by cosine similarity, grouped by sex."""
    vibe = {}
    for sex in ('F', 'M'):
        sex_names = [n for n, d in names.items() if d['sex'] == sex and n in vectors]
        if not sex_names:
            continue
        mat = np.stack([vectors[n] for n in sex_names])
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        mat_n = mat / np.maximum(norms, 1e-8)
        sim = mat_n @ mat_n.T
        np.fill_diagonal(sim, -1.0)
        print(f"  {sex}: {len(sex_names)} names, similarity matrix {sim.shape}")
        for i, name in enumerate(sex_names):
            top_idx = np.argsort(sim[i])[::-1][:VIBE_TOP_N]
            vibe[name] = [sex_names[j] for j in top_idx]
    return vibe


def phonetic_score(a, b):
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def compute_phonetic_names(names, vibe):
    """Top-PHONETIC_TOP_N by phoneme similarity (±1 syllable), excluding vibe_names."""
    phonetic = {}
    buckets = defaultdict(list)
    for n in names.values():
        buckets[(n['sex'], n['syllables'])].append(n)

    name_list = list(names.values())
    total = len(name_list)
    for i, name_a in enumerate(name_list):
        vibe_set = set(vibe.get(name_a['name'], []))
        candidates = []
        for delta in (-1, 0, 1):
            for n in buckets[(name_a['sex'], name_a['syllables'] + delta)]:
                if n['name'] != name_a['name'] and n['name'] not in vibe_set:
                    candidates.append(n)

        scored = sorted(
            ((phonetic_score(name_a['phonemes'], c['phonemes']), c['name']) for c in candidates),
            reverse=True,
        )
        phonetic[name_a['name']] = [name for _, name in scored[:PHONETIC_TOP_N]]

        if (i + 1) % 5000 == 0:
            print(f"  {i + 1}/{total}")

    return phonetic


def compute():
    os.makedirs(PROCESSED_DIR, exist_ok=True)

    print("Loading names...")
    names = load_names()
    print(f"Loaded {len(names)} names")

    print("Loading vectors...")
    vectors = load_vectors()
    print(f"Loaded {len(vectors)} vectors")

    print("Computing vibe names (cosine similarity)...")
    vibe = compute_vibe_names(names, vectors)
    print(f"Computed vibe names for {len(vibe)} names")

    print("Computing phonetic names...")
    phonetic = compute_phonetic_names(names, vibe)

    output_path = os.path.join(PROCESSED_DIR, 'similar_names.csv')
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['name', 'vibe_names', 'phonetic_names'])
        writer.writeheader()
        for name in names:
            writer.writerow({
                'name': name,
                'vibe_names': json.dumps(vibe.get(name, [])),
                'phonetic_names': json.dumps(phonetic.get(name, [])),
            })

    print(f"Done. Saved to {output_path}")


if __name__ == '__main__':
    compute()
