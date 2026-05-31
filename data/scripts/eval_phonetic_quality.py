"""
Evaluates phonetic_names quality via LLM judge across algorithm variants.
Two-phase workflow:

  Step 1 — generate cases:
    python3.12 data/scripts/eval_phonetic_quality.py --generate
    Writes data/processed/phonetic_eval_cases.json

  Step 2 — judge (done by a Claude subagent reading the cases file):
    Produces data/processed/phonetic_eval_ratings.json

  Step 3 — score:
    python3.12 data/scripts/eval_phonetic_quality.py --score
    Reads ratings file, prints summary stats.
"""
import argparse
import csv
import json
import math
import os
import random
from collections import defaultdict
from difflib import SequenceMatcher

SCRIPTS_DIR = os.path.dirname(__file__)
RAW_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw')
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')

N_ANCHORS = 100
LLM_ANCHOR_SUBSET = 20  # anchors LLM-judged per variant (4 variants × 20 = 80 calls)
PHONETIC_TOP_N = 8
PHONEME_LEN_TOLERANCE = 3
QUICK_RATIO_THRESHOLD = 0.4
SEED = 42


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
            names[row['name']] = {
                'name': row['name'],
                'sex': row.get('sex', ''),
                'phonemes': tuple(pron.split()) if pron else (),
                'syllables': syllables,
                'total_count': total_count,
            }
    return names


def phonetic_score(a, b):
    if not a or not b:
        return 0.0
    sm = SequenceMatcher(None, a, b)
    if sm.real_quick_ratio() < QUICK_RATIO_THRESHOLD:
        return 0.0
    if sm.quick_ratio() < QUICK_RATIO_THRESHOLD:
        return 0.0
    return sm.ratio()


def ending_score(a, b, ending_pct=0.5):
    """Score similarity on the last ending_pct of phonemes (rhyme focus)."""
    if not a or not b:
        return 0.0
    n_a = max(1, int(len(a) * ending_pct))
    n_b = max(1, int(len(b) * ending_pct))
    return phonetic_score(a[-n_a:], b[-n_b:])


def build_buckets(names, min_count=0):
    buckets = defaultdict(list)
    for n in names.values():
        if n['total_count'] >= min_count and n['phonemes']:
            buckets[(n['sex'], n['syllables'])].append(n)
    return buckets


def compute_phonetic_for_anchors(names, anchors, buckets, score_fn=None):
    if score_fn is None:
        score_fn = phonetic_score

    results = {}
    for anchor_name in anchors:
        name_a = names.get(anchor_name)
        if not name_a or not name_a['phonemes']:
            results[anchor_name] = []
            continue

        plen_a = len(name_a['phonemes'])
        candidates = []
        for delta in (-1, 0, 1):
            for n in buckets[(name_a['sex'], name_a['syllables'] + delta)]:
                if n['name'] == anchor_name:
                    continue
                if abs(len(n['phonemes']) - plen_a) > PHONEME_LEN_TOLERANCE:
                    continue
                candidates.append(n)

        scored = sorted(
            ((score_fn(name_a['phonemes'], c['phonemes']), c['name']) for c in candidates),
            reverse=True,
        )
        results[anchor_name] = [name for _, name in scored[:PHONETIC_TOP_N]]

    return results


def sample_anchors(names, n=N_ANCHORS, seed=SEED):
    """Sample n anchors (50F/50M), weighted by popularity, requiring >= 5000 all-time births."""
    rng = random.Random(seed)
    eligible = [v for v in names.values() if v['phonemes'] and v['total_count'] >= 5000]
    f_names = [v for v in eligible if v['sex'] == 'F']
    m_names = [v for v in eligible if v['sex'] == 'M']

    def weighted_sample(pool, k):
        remaining = [(v, math.log1p(v['total_count'])) for v in pool]
        chosen = []
        for _ in range(min(k, len(remaining))):
            ws = [w for _, w in remaining]
            idx = rng.choices(range(len(remaining)), weights=ws, k=1)[0]
            chosen.append(remaining[idx][0]['name'])
            remaining.pop(idx)
        return chosen

    return weighted_sample(f_names, n // 2) + weighted_sample(m_names, n // 2)


def quick_stats(names, anchors, results, label):
    counts = [len(results.get(a, [])) for a in anchors]
    pct_obscure = [
        sum(1 for s in results.get(a, []) if names.get(s, {}).get('total_count', 0) < 1000) / len(results.get(a, []))
        if results.get(a) else 0
        for a in anchors
    ]
    avg_count = sum(counts) / len(counts)
    pct_empty = sum(1 for c in counts if c == 0) / len(counts)
    avg_obs = sum(pct_obscure) / len(pct_obscure)
    print(f'  {label:<20}: avg {avg_count:.1f} results | {100*pct_empty:.0f}% empty | {100*avg_obs:.0f}% results are obscure (<1k births)')


def generate(names_data):
    """Phase 1: compute all variants and write eval cases to JSON."""
    print('Sampling anchors...')
    anchors = sample_anchors(names_data)
    n_f = sum(1 for a in anchors if names_data[a]['sex'] == 'F')
    print(f'Sampled {len(anchors)} anchors ({n_f}F / {len(anchors)-n_f}M)')

    print('\nBuilding candidate pools...')
    buckets_all = build_buckets(names_data, min_count=0)
    buckets_1k = build_buckets(names_data, min_count=1000)
    buckets_5k = build_buckets(names_data, min_count=5000)

    print('Computing variants...')
    variants = {
        'baseline': compute_phonetic_for_anchors(names_data, anchors, buckets_all),
        'pop_1k': compute_phonetic_for_anchors(names_data, anchors, buckets_1k),
        'pop_5k': compute_phonetic_for_anchors(names_data, anchors, buckets_5k),
        'rhyme_pop_1k': compute_phonetic_for_anchors(
            names_data, anchors, buckets_1k,
            score_fn=lambda a, b: ending_score(a, b, ending_pct=0.5),
        ),
    }

    print('\n--- Quick stats (100 anchors, no LLM) ---')
    for label, results in variants.items():
        quick_stats(names_data, anchors, results, label)

    # Write cases for LLM judge — first LLM_ANCHOR_SUBSET anchors per variant
    cases = []
    for label, results in variants.items():
        for anchor in anchors[:LLM_ANCHOR_SUBSET]:
            cases.append({
                'variant': label,
                'anchor': anchor,
                'suggestions': results.get(anchor, []),
            })

    cases_path = os.path.join(PROCESSED_DIR, 'phonetic_eval_cases.json')
    with open(cases_path, 'w') as f:
        json.dump(cases, f, indent=2)
    print(f'\nWrote {len(cases)} cases to {cases_path}')
    print('Next: have a subagent judge the cases and write phonetic_eval_ratings.json')
    print('Then run: python3.12 eval_phonetic_quality.py --score')


def score():
    """Phase 3: read ratings from subagent, print summary stats per variant."""
    ratings_path = os.path.join(PROCESSED_DIR, 'phonetic_eval_ratings.json')
    if not os.path.exists(ratings_path):
        print(f'Ratings file not found: {ratings_path}')
        return

    with open(ratings_path) as f:
        ratings = json.load(f)

    # Group by variant
    by_variant = {}
    for entry in ratings:
        v = entry['variant']
        by_variant.setdefault(v, []).append(entry)

    print('\n=== LLM Judge Results ===')
    for variant, entries in by_variant.items():
        all_scores = [r['rating'] for e in entries for r in e.get('ratings', []) if isinstance(r.get('rating'), int)]
        if not all_scores:
            continue
        mean = sum(all_scores) / len(all_scores)
        pct_good = sum(1 for s in all_scores if s >= 2) / len(all_scores)
        print(f'\n[{variant}]')
        print(f'  Mean: {mean:.2f}/3.0 | Good (≥2): {100*pct_good:.0f}% | n={len(all_scores)}')

        entries.sort(key=lambda e: sum(r['rating'] for r in e.get('ratings', []) if isinstance(r.get('rating'), int)) / max(len(e.get('ratings', [])), 1))
        print('  Worst 3:')
        for e in entries[:3]:
            print(f'    {e["anchor"]}: {[r["name"] for r in e.get("ratings", [])]}')
        print('  Best 3:')
        for e in entries[-3:]:
            print(f'    {e["anchor"]}: {[r["name"] for r in e.get("ratings", [])]}')


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--generate', action='store_true', help='Compute variants and write eval cases')
    group.add_argument('--score', action='store_true', help='Read ratings and print summary stats')
    args = parser.parse_args()

    if args.generate:
        print('Loading names...')
        names_data = load_names()
        generate(names_data)
    elif args.score:
        score()


if __name__ == '__main__':
    main()
