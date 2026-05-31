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
VIBE_MAX_SIM = 0.97       # exclude near-identical vectors (catches obvious spelling variants)
VIBE_MIN_EDIT_DIST = 3    # exclude names within edit distance 2 (catches subtle spelling variants)
PHONETIC_TOP_N = 8
PHONETIC_MIN_SCORE = 0.70
PHONETIC_MAX_SCORE = 0.85
PHONETIC_MIN_COUNT = 1000  # exclude names with fewer total births


def load_names():
    names = {}
    with open(os.path.join(RAW_DIR, 'all-names.csv')) as f:
        for row in csv.DictReader(f):
            pron = row.get('pronunciations', '').split('|')[0].strip()
            try:
                syllables = int(row['syllables']) if row.get('syllables') else 0
            except ValueError:
                syllables = 0
            try:
                total_count = int(row['total_count']) if row.get('total_count') else 0
            except ValueError:
                total_count = 0
            # Keep the dominant-gender row when a name appears in both M and F records
            existing = names.get(row['name'])
            if existing and existing['total_count'] >= total_count:
                continue
            names[row['name']] = {
                'name': row['name'],
                'sex': row.get('sex', ''),
                'phonemes': tuple(pron.split()) if pron else (),
                'syllables': syllables,
                'total_count': total_count,
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


def _edit_distance(a, b):
    a, b = a.lower(), b.lower()
    m, n = len(a), len(b)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            prev, dp[j] = dp[j], prev if a[i-1] == b[j-1] else 1 + min(prev, dp[j], dp[j-1])
    return dp[n]


def compute_vibe_names(names, vectors):
    """Top-VIBE_TOP_N female and male neighbors by cosine similarity for every name.
    One shared matrix; results split by sex so unisex names get correct suggestions in both toggles."""
    all_names = [n for n in names if n in vectors]
    if not all_names:
        return {}, {}

    mat = np.stack([vectors[n] for n in all_names])
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    mat_n = mat / np.maximum(norms, 1e-8)
    sim = mat_n @ mat_n.T
    np.fill_diagonal(sim, -1.0)
    print(f"  All: {len(all_names)} names, similarity matrix {sim.shape}")

    f_idx = frozenset(j for j, n in enumerate(all_names) if names[n]['sex'] == 'F')
    m_idx = frozenset(j for j, n in enumerate(all_names) if names[n]['sex'] == 'M')

    def _collect(name, top_idx, idx_set, sim_row):
        results = []
        for j in top_idx:
            if sim_row[j] < 0.5:
                break  # remaining scores too low to be useful
            if j not in idx_set:
                continue
            if sim_row[j] > VIBE_MAX_SIM:
                continue
            if _edit_distance(name, all_names[j]) < VIBE_MIN_EDIT_DIST:
                continue
            results.append(all_names[j])
            if len(results) == VIBE_TOP_N:
                break
        return results

    vibe_f, vibe_m = {}, {}
    for i, name in enumerate(all_names):
        top_idx = np.argsort(sim[i])[::-1]
        sim_row = sim[i]
        vibe_f[name] = _collect(name, top_idx, f_idx, sim_row)
        vibe_m[name] = _collect(name, top_idx, m_idx, sim_row)
    return vibe_f, vibe_m


PHONEME_LEN_TOLERANCE = 3  # only compare names within ±3 phonemes in length
QUICK_RATIO_THRESHOLD = 0.4  # skip pairs that can't possibly score above this


def phonetic_score(a, b):
    if not a or not b:
        return 0.0
    sm = SequenceMatcher(None, a, b)
    if sm.real_quick_ratio() < QUICK_RATIO_THRESHOLD:
        return 0.0
    if sm.quick_ratio() < QUICK_RATIO_THRESHOLD:
        return 0.0
    return sm.ratio()


def compute_phonetic_names(names, vibe_f, vibe_m):
    """Top-PHONETIC_TOP_N by phoneme similarity (±1 syllable, ±3 phonemes), excluding vibe_names.
    Only includes candidates with total_count >= PHONETIC_MIN_COUNT and score in [PHONETIC_MIN_SCORE, PHONETIC_MAX_SCORE]."""
    phonetic = {}
    buckets = defaultdict(list)
    for n in names.values():
        if n['total_count'] >= PHONETIC_MIN_COUNT:
            buckets[(n['sex'], n['syllables'])].append(n)

    name_list = list(names.values())
    total = len(name_list)
    for i, name_a in enumerate(name_list):
        vibe_set = set(vibe_f.get(name_a['name'], [])) | set(vibe_m.get(name_a['name'], []))
        plen_a = len(name_a['phonemes'])
        candidates = []
        for delta in (-1, 0, 1):
            for n in buckets[(name_a['sex'], name_a['syllables'] + delta)]:
                if n['name'] == name_a['name'] or n['name'] in vibe_set:
                    continue
                if abs(len(n['phonemes']) - plen_a) > PHONEME_LEN_TOLERANCE:
                    continue
                candidates.append(n)

        scored = sorted(
            ((phonetic_score(name_a['phonemes'], c['phonemes']), c['name']) for c in candidates),
            reverse=True,
        )
        phonetic[name_a['name']] = [
            name for score, name in scored
            if PHONETIC_MIN_SCORE <= score <= PHONETIC_MAX_SCORE
        ][:PHONETIC_TOP_N]

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
    vibe_f, vibe_m = compute_vibe_names(names, vectors)
    print(f"Computed vibe names for {len(vibe_f)} names (F) and {len(vibe_m)} names (M)")

    print("Computing phonetic names...")
    phonetic = compute_phonetic_names(names, vibe_f, vibe_m)

    output_path = os.path.join(PROCESSED_DIR, 'similar_names.csv')
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['name', 'vibe_names_f', 'vibe_names_m', 'phonetic_names'])
        writer.writeheader()
        for name in names:
            writer.writerow({
                'name': name,
                'vibe_names_f': json.dumps(vibe_f.get(name, [])),
                'vibe_names_m': json.dumps(vibe_m.get(name, [])),
                'phonetic_names': json.dumps(phonetic.get(name, [])),
            })

    print(f"Done. Saved to {output_path}")


if __name__ == '__main__':
    compute()
