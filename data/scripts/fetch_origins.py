"""
Fetches raw Wiktionary wikitext for each name in all-names.csv.
Results are cached as JSON in raw/wiktionary/ so re-runs skip already-fetched names.
Uses batch requests (50 names per API call) for speed.
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
BATCH_SIZE = 50
RATE_LIMIT_SECONDS = 1.0
HEADERS = {'User-Agent': 'BabyNamesApp/1.0 (data pipeline; contact via GitHub)'}


def fetch_batch(names, retries=3):
    params = {
        'action': 'query',
        'titles': '|'.join(names),
        'prop': 'revisions',
        'rvprop': 'content',
        'rvslots': 'main',
        'format': 'json',
    }
    delay = 2.0
    for attempt in range(retries):
        try:
            response = requests.get(WIKTIONARY_API, params=params, headers=HEADERS, timeout=15)
            if response.status_code == 429:
                print(f"  Rate limited, waiting {delay}s...")
                time.sleep(delay)
                delay *= 2
                continue
            response.raise_for_status()
            data = response.json()

            normalized = {n['to']: n['from'] for n in data.get('query', {}).get('normalized', [])}
            redirects = {r['to']: r['from'] for r in data.get('query', {}).get('redirects', [])}

            results = {}
            for page in data.get('query', {}).get('pages', {}).values():
                title = page.get('title', '')
                original = redirects.get(title, title)
                original = normalized.get(original, original)
                results[original] = page
            return results
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(delay)
            delay *= 2
    return {}


def load_names():
    names_path = os.path.join(RAW_DIR, 'all-names.csv')
    with open(names_path) as f:
        return sorted({row['name'] for row in csv.DictReader(f)})


def fetch_all():
    os.makedirs(CACHE_DIR, exist_ok=True)
    names = load_names()
    already_cached = {f[:-5] for f in os.listdir(CACHE_DIR) if f.endswith('.json')}
    remaining = [n for n in names if n not in already_cached]

    total_batches = (len(remaining) + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"{len(names)} total names, {len(already_cached)} cached, {len(remaining)} to fetch ({total_batches} batches)")

    fetched = 0
    errors = 0
    for i in range(0, len(remaining), BATCH_SIZE):
        batch = remaining[i:i + BATCH_SIZE]
        try:
            results = fetch_batch(batch)
            for name in batch:
                page = results.get(name, {})
                cache_path = os.path.join(CACHE_DIR, f"{name}.json")
                with open(cache_path, 'w') as f:
                    json.dump(page, f)
            fetched += len(batch)
        except Exception as e:
            errors += len(batch)
            print(f"  Skipped batch '{batch[0]}': {e}")

        batch_num = i // BATCH_SIZE + 1
        if batch_num % 100 == 0:
            print(f"  {batch_num}/{total_batches} batches ({fetched} names, {errors} errors)")

        time.sleep(RATE_LIMIT_SECONDS)

    print(f"Done. {fetched} fetched, {errors} errors. Re-run to retry errors.")


if __name__ == '__main__':
    fetch_all()
