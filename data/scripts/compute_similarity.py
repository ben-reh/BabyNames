"""
Precomputes top-20 similar names for each name using phonetic, origin,
peak year, syllable, and stress signals.
Reads raw/all-names.csv + raw/origins.csv, writes processed/similar_names.csv.
Run after parse_origins.py.
"""
import csv
import json
import os
from collections import defaultdict
from difflib import SequenceMatcher

SCRIPTS_DIR = os.path.dirname(__file__)
RAW_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw')
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')

TOP_N = 20
WEIGHTS = {
    'phonetic': 0.40,
    'origin': 0.25,
    'year_peak': 0.20,
    'syllables_stress': 0.15,
}


def load_names():
    names = {}
    with open(os.path.join(RAW_DIR, 'all-names.csv')) as f:
        for row in csv.DictReader(f):
            pron = row.get('pronunciations', '').split('|')[0].strip()
            try:
                year_peak = int(row['year_peak']) if row.get('year_peak') else 0
                syllables = int(row['syllables']) if row.get('syllables') else 0
            except ValueError:
                year_peak = syllables = 0

            names[row['name']] = {
                'name': row['name'],
                'phonemes': tuple(pron.split()) if pron else (),
                'gender': row.get('sex', ''),
                'year_peak': year_peak,
                'syllables': syllables,
                'stresses': row.get('stresses', ''),
                'origin': '',
            }
    return names


def load_origins(names):
    path = os.path.join(RAW_DIR, 'origins.csv')
    if not os.path.exists(path):
        return
    with open(path) as f:
        for row in csv.DictReader(f):
            if row['name'] in names and row['origin']:
                names[row['name']]['origin'] = row['origin']


def phonetic_score(a, b):
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def origin_score(a, b):
    return 1.0 if (a and b and a == b) else 0.0


def year_peak_score(a, b):
    if not a or not b:
        return 0.0
    return max(0.0, 1.0 - abs(a - b) / 50.0)


def syllables_stress_score(syl_a, stress_a, syl_b, stress_b):
    syl = 1.0 if syl_a == syl_b else (0.5 if abs(syl_a - syl_b) == 1 else 0.0)
    stress = 1.0 if (stress_a and stress_b and stress_a == stress_b) else 0.0
    return (syl + stress) / 2.0


def similarity(a, b):
    return (
        WEIGHTS['phonetic'] * phonetic_score(a['phonemes'], b['phonemes']) +
        WEIGHTS['origin'] * origin_score(a['origin'], b['origin']) +
        WEIGHTS['year_peak'] * year_peak_score(a['year_peak'], b['year_peak']) +
        WEIGHTS['syllables_stress'] * syllables_stress_score(
            a['syllables'], a['stresses'], b['syllables'], b['stresses']
        )
    )


def compute():
    os.makedirs(PROCESSED_DIR, exist_ok=True)

    print("Loading names...")
    names = load_names()
    load_origins(names)
    name_list = list(names.values())
    print(f"Loaded {len(name_list)} names")

    # Group by (gender, syllables) for O(1) candidate lookup instead of O(n) scan
    buckets = defaultdict(list)
    for n in name_list:
        buckets[(n['gender'], n['syllables'])].append(n)

    output_path = os.path.join(PROCESSED_DIR, 'similar_names.csv')
    print(f"Computing top-{TOP_N} similar names...")

    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['name', 'similar_names'])
        writer.writeheader()

        for i, name_a in enumerate(name_list):
            candidates = []
            for delta in (-1, 0, 1):
                for n in buckets[(name_a['gender'], name_a['syllables'] + delta)]:
                    if n['name'] != name_a['name']:
                        candidates.append(n)

            scored = sorted(
                ((similarity(name_a, c), c['name']) for c in candidates),
                reverse=True,
            )
            top = [name for _, name in scored[:TOP_N]]

            writer.writerow({'name': name_a['name'], 'similar_names': json.dumps(top)})

            if (i + 1) % 5000 == 0:
                print(f"  {i + 1}/{len(name_list)}")

    print(f"Done. Saved to {output_path}")


if __name__ == '__main__':
    compute()
