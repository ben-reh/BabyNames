"""
Generates feature vectors for the top 15,000 names by 2025 SSA count.
Reads raw/all-names.csv + raw/origins.csv, writes processed/name_vectors.csv.
Caches OpenAI embeddings in processed/embeddings_cache.json to avoid re-fetching.
Run after parse_origins.py.

Requires: pip install openai
Set OPENAI_API_KEY in your environment before running.

Tuning: increase EMBEDDING_SCALE to weight cultural vibe over phonetic similarity.
Run eval_recommendations.py to find the right value before uploading to RDS.

Vector layout (52 + 512*EMBEDDING_SCALE effective dims = 564 total):
  [0:33]   origin one-hot (32 origins + 1 unknown)
  [33]     year_peak normalized (1880=0, 2025=1)
  [34]     syllables normalized (1=0, 5+=1)
  [35:46]  stress pattern one-hot (10 patterns + 1 unknown)
  [46]     vowel ratio
  [47]     phoneme length normalized
  [48:51]  gender × 3 dims (F=0, unisex=0.5, M=1) — repeated to give more cosine weight
  [51]     popularity tier — log-normalized 2025 SSA count (groups popular with popular)
  [52:564] OpenAI text-embedding-3-small * EMBEDDING_SCALE — cultural/vibe signal
  Note: start/end sound category removed — caused phonetic over-clustering by first/last sound
"""
import csv
import json
import math
import os

SCRIPTS_DIR = os.path.dirname(__file__)
RAW_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw')
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')

TOP_N = 15000
YEAR_MIN, YEAR_MAX = 1880, 2025
EMBEDDING_DIMS = 512
EMBED_BATCH_SIZE = 500
EMBEDDING_SCALE = 5.0  # tuned via eval_recommendations.py — best avg score at scale 5x
POP_MAX_LOG = math.log1p(50000)  # log(1 + 50k births) — practical ceiling for popularity normalization

ORIGINS = [
    'Latin', 'Ancient Greek', 'Greek', 'Hebrew', 'Arabic', 'French',
    'Old French', 'German', 'Germanic', 'Old English', 'Old Norse',
    'Scandinavian', 'Dutch', 'Celtic', 'Irish', 'Welsh', 'Slavic',
    'Russian', 'Italian', 'Spanish', 'Sanskrit/Hindi', 'Sanskrit',
    'Persian', 'Turkish', 'Hungarian', 'Finnish', 'Chinese', 'Japanese',
    'Korean', 'Scottish Gaelic', 'Polish', 'Czech',
]  # 32 origins + 1 unknown slot = 33 dims

STRESS_PATTERNS = [
    '1', '10', '01', '100', '010', '001', '110', '101', '011', '1000',
]  # 10 patterns + 1 unknown slot = 11 dims

VOWELS = {'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'}

CONSONANT_CATS = {
    'bilabial': {'B', 'P', 'M'},
    'alveolar': {'T', 'D', 'N', 'S', 'Z', 'L'},
    'velar':    {'K', 'G', 'NG'},
    'fricative': {'F', 'V', 'HH', 'SH', 'ZH', 'TH', 'DH'},
    'rhotic':   {'R'},
    'affricate': {'CH', 'JH'},
}
SOUND_CATS = ['vowel', 'bilabial', 'alveolar', 'velar', 'fricative', 'rhotic', 'affricate', 'other']


def one_hot(value, options, unknown=True):
    size = len(options) + (1 if unknown else 0)
    vec = [0.0] * size
    if value in options:
        vec[options.index(value)] = 1.0
    elif unknown:
        vec[-1] = 1.0
    return vec


def sound_category(phoneme):
    p = phoneme.rstrip('012')
    if p in VOWELS:
        return 'vowel'
    for cat, phones in CONSONANT_CATS.items():
        if p in phones:
            return cat
    return 'other'


def build_vector(name_data, embedding):
    phonemes = name_data['phonemes']

    if phonemes:
        vowel_count = sum(1 for p in phonemes if p.rstrip('012') in VOWELS)
        vowel_ratio = vowel_count / len(phonemes)
        length_norm = min(len(phonemes), 12) / 12.0
        start_cat = sound_category(phonemes[0])
        end_cat = sound_category(phonemes[-1])
    else:
        vowel_ratio = length_norm = 0.5
        start_cat = end_cat = 'other'

    year = name_data['year_peak']
    year_norm = (year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN) if year else 0.5

    syl = name_data['syllables']
    syl_norm = (min(syl, 5) - 1) / 4.0 if syl else 0.5

    pop_norm = math.log1p(name_data.get('count_2025', 0)) / POP_MAX_LOG
    # gender_val: 1.0=fully male, 0.0=fully female — SSA-derived, continuous
    gender_val = 1.0 - name_data.get('female_pct', 0.5)

    hand_crafted = (
        one_hot(name_data['origin'], ORIGINS) +           # 33 dims
        [year_norm, syl_norm] +                            #  2 dims
        one_hot(name_data['stresses'], STRESS_PATTERNS) + # 11 dims
        [vowel_ratio, length_norm] +                       #  2 dims
        [gender_val, gender_val, gender_val,               #  3 dims (repeated for cosine weight)
         pop_norm]                                         #  1 dim
    )  # subtotal: 52 dims

    return hand_crafted + [x * EMBEDDING_SCALE for x in embedding]  # 65 + 64 = 129 dims


UNISEX_MIN = 0.05
UNISEX_MAX = 0.95
UNISEX_MIN_MINORITY = 50  # minimum births on the minority side to qualify as unisex


def load_2025_counts() -> tuple[dict[str, int], dict[str, float]]:
    """Returns (total_counts, female_pct) derived from 2025 SSA data."""
    sex_counts: dict[str, dict[str, int]] = {}
    ssa_path = os.path.join(RAW_DIR, 'ssa', 'yob2025.txt')
    with open(ssa_path) as f:
        for line in f:
            parts = line.strip().split(',')
            if len(parts) == 3:
                name, sex, count = parts
                if name not in sex_counts:
                    sex_counts[name] = {'M': 0, 'F': 0}
                sex_counts[name][sex] += int(count)

    counts: dict[str, int] = {}
    female_pct: dict[str, float] = {}
    for name, sc in sex_counts.items():
        total = sc['M'] + sc['F']
        counts[name] = total
        female_pct[name] = sc['F'] / total if total else 0.5
    return counts, female_pct


def load_names(counts_2025: dict[str, int], female_pcts: dict[str, float]):
    names = {}
    with open(os.path.join(RAW_DIR, 'all-names.csv')) as f:
        for row in csv.DictReader(f):
            name = row['name']
            if name not in counts_2025:
                continue
            pron = row.get('pronunciations', '').split('|')[0].strip()
            try:
                year_peak = int(row['year_peak']) if row.get('year_peak') else 0
                syllables = int(row['syllables']) if row.get('syllables') else 0
            except ValueError:
                year_peak = syllables = 0

            fp = female_pcts[name]
            names[name] = {
                'name': name,
                'count_2025': counts_2025[name],
                'female_pct': fp,
                'phonemes': tuple(pron.split()) if pron else (),
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


def embedding_prompt(name_data: dict) -> str:
    return f"the baby name {name_data['name']}"


def fetch_embeddings(prompts: dict[str, str], client) -> dict[str, list[float]]:
    cache_path = os.path.join(PROCESSED_DIR, 'embeddings_cache.json')
    cache: dict[str, list[float]] = {}
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            cache = json.load(f)
        print(f"  Loaded {len(cache):,} cached embeddings")

    names = list(prompts.keys())
    missing = [n for n in names if n not in cache]
    if missing:
        print(f"  Fetching {len(missing):,} new embeddings from OpenAI...")
        for i in range(0, len(missing), EMBED_BATCH_SIZE):
            batch = missing[i:i + EMBED_BATCH_SIZE]
            response = client.embeddings.create(
                model='text-embedding-3-small',
                input=[prompts[n] for n in batch],
                dimensions=EMBEDDING_DIMS,
            )
            for name, data in zip(batch, response.data):
                cache[name] = data.embedding
            print(f"  Embedded {min(i + EMBED_BATCH_SIZE, len(missing))}/{len(missing)}")
        with open(cache_path, 'w') as f:
            json.dump(cache, f)
        print(f"  Cache saved ({len(cache):,} total)")
    else:
        print("  All embeddings served from cache")

    return {n: cache[n] for n in names}


def compute():
    os.makedirs(PROCESSED_DIR, exist_ok=True)

    print("Loading 2025 SSA counts...")
    counts_2025, female_pcts = load_2025_counts()
    print(f"  {len(counts_2025):,} names in 2025 SSA data")

    print("Loading names...")
    names = load_names(counts_2025, female_pcts)
    load_origins(names)

    top_names = sorted(names.values(), key=lambda n: n['count_2025'], reverse=True)[:TOP_N]
    print(f"Building vectors for top {len(top_names)} names...")

    from openai import OpenAI
    client = OpenAI()

    print("Fetching OpenAI embeddings...")
    prompts = {n['name']: embedding_prompt(n) for n in top_names}
    embeddings = fetch_embeddings(prompts, client)

    output_path = os.path.join(PROCESSED_DIR, 'name_vectors.csv')
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['name', 'count_2025', 'female_pct', 'vector'])
        writer.writeheader()
        for name_data in top_names:
            embedding = embeddings[name_data['name']]
            writer.writerow({
                'name': name_data['name'],
                'count_2025': name_data['count_2025'],
                'female_pct': round(name_data['female_pct'], 4),
                'vector': json.dumps(build_vector(name_data, embedding)),
            })

    dims = len(build_vector(top_names[0], embeddings[top_names[0]['name']]))
    print(f"Vector dimensions: {dims}")
    print(f"Saved to {output_path}")


if __name__ == '__main__':
    compute()
