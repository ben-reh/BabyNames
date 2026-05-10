"""
Generates feature vectors for the top 5,000 names by total count.
Reads raw/all-names.csv + raw/origins.csv, writes processed/name_vectors.csv.
Run after parse_origins.py.

Vector layout (65 dims):
  [0:33]   origin one-hot (32 origins + 1 unknown)
  [33]     year_peak normalized (1880=0, 2024=1)
  [34]     syllables normalized (1=0, 5+=1)
  [35:46]  stress pattern one-hot (10 patterns + 1 unknown)
  [46]     vowel ratio
  [47]     phoneme length normalized
  [48:56]  start sound category one-hot (8 categories)
  [56:64]  end sound category one-hot (8 categories)
  [64]     gender (F=0, unisex=0.5, M=1)
"""
import csv
import json
import os

SCRIPTS_DIR = os.path.dirname(__file__)
RAW_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw')
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')

TOP_N = 5000
YEAR_MIN, YEAR_MAX = 1880, 2024

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


def build_vector(name_data):
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

    return (
        one_hot(name_data['origin'], ORIGINS) +           # 33 dims
        [year_norm, syl_norm] +                            #  2 dims
        one_hot(name_data['stresses'], STRESS_PATTERNS) + # 11 dims
        [vowel_ratio, length_norm] +                       #  2 dims
        one_hot(start_cat, SOUND_CATS, unknown=False) +   #  8 dims
        one_hot(end_cat, SOUND_CATS, unknown=False) +     #  8 dims
        [{'F': 0.0, 'M': 1.0}.get(name_data['gender'], 0.5)]  # 1 dim
    )  # total: 65 dims


def load_names():
    names = {}
    with open(os.path.join(RAW_DIR, 'all-names.csv')) as f:
        for row in csv.DictReader(f):
            pron = row.get('pronunciations', '').split('|')[0].strip()
            try:
                total_count = int(row['total_count'])
                year_peak = int(row['year_peak']) if row.get('year_peak') else 0
                syllables = int(row['syllables']) if row.get('syllables') else 0
            except ValueError:
                total_count = year_peak = syllables = 0

            names[row['name']] = {
                'name': row['name'],
                'total_count': total_count,
                'phonemes': tuple(pron.split()) if pron else (),
                'gender': row.get('unisex_dominant', ''),
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


def compute():
    os.makedirs(PROCESSED_DIR, exist_ok=True)

    print("Loading names...")
    names = load_names()
    load_origins(names)

    top_names = sorted(names.values(), key=lambda n: n['total_count'], reverse=True)[:TOP_N]
    print(f"Building vectors for top {len(top_names)} names...")

    output_path = os.path.join(PROCESSED_DIR, 'name_vectors.csv')
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['name', 'vector'])
        writer.writeheader()
        for name_data in top_names:
            writer.writerow({'name': name_data['name'], 'vector': json.dumps(build_vector(name_data))})

    dims = len(build_vector(top_names[0]))
    print(f"Vector dimensions: {dims}")
    print(f"Saved to {output_path}")


if __name__ == '__main__':
    compute()
