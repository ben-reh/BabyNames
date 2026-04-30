"""
Fetches raw Wiktionary wikitext for each name in all-names.csv.
Results are cached as JSON in raw/wiktionary/ so re-runs skip already-fetched names.
Run after download_dxdc.py.
"""
import csv
import json
import os
import time
import requests

SCRIPTS_DIR = os.path.dirname(__file__)
RAW_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw')
CACHE_DIR = os.path.join(RAW_DIR, 'wiktionary')
WIKTIONARY_API = "https://en.wiktionary.org/w/api.php"
RATE_LIMIT_SECONDS = 0.5
HEADERS = {'User-Agent': 'BabyNamesApp/1.0 (data pipeline; contact via GitHub)'}


def fetch_wiktionary(name):
    params = {
        'action': 'query',
        'titles': name,
        'prop': 'revisions',
        'rvprop': 'content',
        'rvslots': 'main',
        'format': 'json',
    }
    response = requests.get(WIKTIONARY_API, params=params, headers=HEADERS, timeout=10)
    response.raise_for_status()
    return response.json()


def load_names():
    names_path = os.path.join(RAW_DIR, 'all-names.csv')
    with open(names_path) as f:
        return sorted({row['name'] for row in csv.DictReader(f)})


def fetch_all():
    os.makedirs(CACHE_DIR, exist_ok=True)
    names = load_names()
    already_cached = {f[:-5] for f in os.listdir(CACHE_DIR) if f.endswith('.json')}
    remaining = [n for n in names if n not in already_cached]

    print(f"{len(names)} total names, {len(already_cached)} already cached, {len(remaining)} to fetch")

    for i, name in enumerate(remaining):
        cache_path = os.path.join(CACHE_DIR, f"{name}.json")
        try:
            data = fetch_wiktionary(name)
            with open(cache_path, 'w') as f:
                json.dump(data, f)
        except Exception as e:
            print(f"  Error fetching '{name}': {e}")

        if (i + 1) % 500 == 0:
            print(f"  Progress: {i + 1}/{len(remaining)}")

        time.sleep(RATE_LIMIT_SECONDS)

    print(f"Done. {len(names)} names cached in {CACHE_DIR}")


if __name__ == '__main__':
    fetch_all()
