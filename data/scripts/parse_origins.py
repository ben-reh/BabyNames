"""
Parses cached Wiktionary JSON responses to extract name origin/language.
Reads from raw/wiktionary/*.json, writes raw/origins.csv.
Run after fetch_origins.py.
"""
import csv
import json
import os
import re

SCRIPTS_DIR = os.path.dirname(__file__)
RAW_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw')
CACHE_DIR = os.path.join(RAW_DIR, 'wiktionary')

# Wiktionary language codes → readable origin label
LANG_CODES = {
    'la': 'Latin',
    'grc': 'Ancient Greek',
    'el': 'Greek',
    'he': 'Hebrew',
    'hbo': 'Hebrew',
    'ar': 'Arabic',
    'fr': 'French',
    'fro': 'Old French',
    'frm': 'Middle French',
    'de': 'German',
    'gmh': 'German',
    'goh': 'German',
    'gem-pro': 'Germanic',
    'ang': 'Old English',
    'enm': 'Middle English',
    'non': 'Old Norse',
    'sv': 'Scandinavian',
    'da': 'Scandinavian',
    'no': 'Scandinavian',
    'nl': 'Dutch',
    'dum': 'Dutch',
    'cel': 'Celtic',
    'ga': 'Irish',
    'cy': 'Welsh',
    'gd': 'Scottish Gaelic',
    'sla': 'Slavic',
    'ru': 'Russian',
    'pl': 'Polish',
    'cs': 'Czech',
    'orv': 'Slavic',
    'it': 'Italian',
    'es': 'Spanish',
    'osp': 'Spanish',
    'pt': 'Portuguese',
    'pro': 'Occitan',
    'hi': 'Sanskrit/Hindi',
    'sa': 'Sanskrit',
    'inc-pro': 'Sanskrit',
    'ine-pro': 'Proto-Indo-European',
    'fa': 'Persian',
    'tr': 'Turkish',
    'hu': 'Hungarian',
    'fi': 'Finnish',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
}


def extract_wikitext(data):
    pages = data.get('query', {}).get('pages', {})
    for page in pages.values():
        if page.get('ns') == -1:  # missing page
            return None
        revisions = page.get('revisions', [])
        if not revisions:
            return None
        slots = revisions[0].get('slots', {})
        if 'main' in slots:
            return slots['main'].get('*', '')
        return revisions[0].get('*', '')
    return None


def extract_english_etymology(wikitext):
    english = re.search(r'==English==(.+?)(?=\n==[^=]|\Z)', wikitext, re.DOTALL)
    if not english:
        return None
    section = english.group(1)
    etymology = re.search(r'===Etymology[^=]*===(.+?)(?=\n===[^=]|\n==[^=]|\Z)', section, re.DOTALL)
    if not etymology:
        return None
    return etymology.group(1).strip()


def parse_origin(etymology_text):
    # Match {{der|en|XX}}, {{inh|en|XX}}, {{bor|en|XX}} — the XX is the source language code
    pattern = r'\{\{(?:der|inh|bor)\|en\|([a-z][a-z0-9\-]+)'
    for code in re.findall(pattern, etymology_text):
        if code in LANG_CODES:
            return LANG_CODES[code]
    # Fallback: scan for any known language code used as a template argument
    for code, label in LANG_CODES.items():
        if re.search(r'\|' + re.escape(code) + r'[|\}]', etymology_text):
            return label
    return None


def parse_all():
    cache_files = [f for f in os.listdir(CACHE_DIR) if f.endswith('.json')]
    print(f"Parsing {len(cache_files)} cached Wiktionary responses...")

    results = []
    for fname in cache_files:
        name = fname[:-5]
        with open(os.path.join(CACHE_DIR, fname)) as f:
            data = json.load(f)

        wikitext = extract_wikitext(data)
        origin = None
        etymology_raw = None

        if wikitext:
            etymology_raw = extract_english_etymology(wikitext)
            if etymology_raw:
                origin = parse_origin(etymology_raw)

        results.append({
            'name': name,
            'origin': origin or '',
            'etymology_raw': (etymology_raw or '').replace('\n', ' ').strip()[:500],
        })

    output_path = os.path.join(RAW_DIR, 'origins.csv')
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['name', 'origin', 'etymology_raw'])
        writer.writeheader()
        writer.writerows(sorted(results, key=lambda r: r['name']))

    found = sum(1 for r in results if r['origin'])
    total = len(results)
    print(f"Origins found: {found}/{total} ({100 * found // total if total else 0}%)")
    print(f"Saved to {output_path}")


if __name__ == '__main__':
    parse_all()
