"""
Extracts human-readable name meanings from cached Wiktionary JSON responses.
Reads from raw/wiktionary/*.json, writes processed/meanings.csv.
Run after fetch_origins.py.

Coverage: ~1,500 names (45% of top 100, 26% of top 1k).
Sources tried in priority order: meaning_param > lit > gloss.
"""
import csv
import json
import os
import re

SCRIPTS_DIR = os.path.dirname(__file__)
RAW_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw')
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')
CACHE_DIR = os.path.join(RAW_DIR, 'wiktionary')

MIN_LEN = 3
MAX_LEN = 120


def get_wikitext(data):
    if 'revisions' in data or 'pageid' in data:
        page = data
    else:
        pages = data.get('query', {}).get('pages', {})
        page = next(iter(pages.values()), {}) if pages else {}
    if not page or page.get('ns') == -1:
        return None
    revisions = page.get('revisions', [])
    if not revisions:
        return None
    slots = revisions[0].get('slots', {})
    if 'main' in slots:
        return slots['main'].get('*', '')
    return revisions[0].get('*', '')


def get_english_etymology(wikitext):
    english = re.search(r'==English==(.+?)(?=\n==[^=]|\Z)', wikitext, re.DOTALL)
    if not english:
        return None
    section = english.group(1)
    etym = re.search(r'===Etymology[^=]*===(.+?)(?=\n===[^=]|\n==[^=]|\Z)', section, re.DOTALL)
    if not etym:
        return None
    return etym.group(1).strip()


def clean(text):
    # Strip wikilinks: [[target|label]] → label, [[word]] → word
    text = re.sub(r'\[\[(?:[^|\]]+\|)?([^\]]+)\]\]', r'\1', text)
    # Strip remaining template fragments
    text = re.sub(r'\{\{[^}]*\}\}', '', text)
    # Collapse whitespace, strip punctuation artifacts
    text = re.sub(r'\s+', ' ', text).strip()
    text = text.strip('\'"",;')
    return text


def is_valid(text, name=None):
    # Reject named template parameters that leaked through (e.g. "tr=...", "t=...")
    if re.match(r'^[a-z]{1,4}=', text):
        return False
    # Reject non-Latin scripts (Hebrew, Arabic, Cyrillic, Devanagari, CJK, etc.)
    if re.search(r'[Ѐ-ӿ؀-ۿऀ-ॿ一-鿿'
                 r'぀-ヿ֐-׿가-힯]', text):
        return False
    # Reject reconstructed proto-forms (*karlaz) and suffixes (-ella)
    if text.startswith('*') or text.startswith('-'):
        return False
    # Reject glosses that are just the name itself
    if name and text.lower() == name.lower():
        return False
    return MIN_LEN <= len(text) <= MAX_LEN


def extract_meaning(wikitext, name=None):
    """Return (meaning, source) or None."""
    # Priority 1: explicit meaning= param in {{given name}} template
    m = re.search(r'\{\{given name[^}]*\|meaning=([^|}]+)', wikitext, re.IGNORECASE)
    if m:
        meaning = clean(m.group(1))
        if is_valid(meaning, name):
            return meaning, 'meaning_param'

    etym = get_english_etymology(wikitext)
    if not etym:
        return None

    # Priority 2: |lit= inside any template
    m = re.search(r'\|lit=([^|}]+)', etym)
    if m:
        meaning = clean(m.group(1))
        if is_valid(meaning, name):
            return meaning, 'lit'

    # Priority 3: ||gloss in {{m|...}}, {{der|...}}, etc.
    glosses = re.findall(r'\{\{(?:m|der|inh|bor|uder)[^}]*?\|{2}([^|}]{3,80})', etym)
    for gloss in glosses:
        meaning = clean(gloss)
        if is_valid(meaning, name):
            return meaning, 'gloss'

    return None


def extract_all():
    cache_files = sorted(f for f in os.listdir(CACHE_DIR) if f.endswith('.json'))
    print(f"Processing {len(cache_files)} cached Wiktionary responses...")

    results = []
    source_counts = {}

    for fname in cache_files:
        name = fname[:-5]
        with open(os.path.join(CACHE_DIR, fname)) as f:
            data = json.load(f)

        wikitext = get_wikitext(data)
        if not wikitext:
            continue

        result = extract_meaning(wikitext, name)
        if result:
            meaning, source = result
            results.append({'name': name, 'meaning': meaning, 'source': source})
            source_counts[source] = source_counts.get(source, 0) + 1

    output_path = os.path.join(PROCESSED_DIR, 'meanings.csv')
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['name', 'meaning', 'source'])
        writer.writeheader()
        writer.writerows(results)

    total = len(cache_files)
    found = len(results)
    print(f"Meanings found: {found}/{total} ({100 * found // total if total else 0}%)")
    for source, count in sorted(source_counts.items(), key=lambda x: -x[1]):
        print(f"  {source}: {count}")
    print(f"Saved to {output_path}")


if __name__ == '__main__':
    extract_all()
