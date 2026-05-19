"""
Generates name meanings using Claude API for names missing from meanings.csv.
Targets the top 5000 names by rank, skipping any already covered.
Uses prompt caching on the system prompt and writes results incrementally.
Run after extract_meanings.py.
"""
import anthropic
import csv
import json
import os
import re
import time

SCRIPTS_DIR = os.path.dirname(__file__)
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')
NAMES_CSV = os.path.join(PROCESSED_DIR, 'names.csv')
MEANINGS_CSV = os.path.join(PROCESSED_DIR, 'meanings.csv')

MODEL = 'claude-haiku-4-5'
BATCH_SIZE = 20
TOP_N = 5000
DELAY_BETWEEN_BATCHES = 0.05  # seconds

SYSTEM_PROMPT = """\
You are an expert on the etymology and meaning of personal names.
Given a list of names (with optional raw Wiktionary etymology text), return a JSON object
mapping each name to a brief human-readable meaning such as "beloved", "gift of God", or "olive tree".

Rules:
- Return ONLY a valid JSON object — no prose, no markdown fences
- Keys are the exact name strings provided
- Values are short meaning phrases (2–6 words); use "" if unknown
- Do not include the name itself in the meaning
- Ignore Wikitext markup ({{templates}}, [[links]]) in etymologies — extract the core meaning
- Focus on root meaning, not the full etymological chain"""


def load_existing_names():
    if not os.path.exists(MEANINGS_CSV):
        return set()
    with open(MEANINGS_CSV) as f:
        return {row['name'] for row in csv.DictReader(f)}


def load_candidates(skip_names):
    rows = []
    with open(NAMES_CSV) as f:
        for row in csv.DictReader(f):
            rank = row.get('rank', '')
            if not rank.isdigit() or int(rank) > TOP_N:
                continue
            if row['name'] in skip_names:
                continue
            rows.append({
                'name': row['name'],
                'rank': int(rank),
                'etymology': row.get('etymology_raw', '').strip(),
            })
    return sorted(rows, key=lambda r: r['rank'])


def build_user_message(batch):
    lines = []
    for item in batch:
        if item['etymology']:
            # Strip Wikitext templates and links for cleaner context
            etym = re.sub(r'\{\{[^}]*\}\}', '', item['etymology'])
            etym = re.sub(r'\[\[(?:[^|\]]+\|)?([^\]]+)\]\]', r'\1', etym)
            etym = re.sub(r'\s+', ' ', etym).strip()[:300]
            lines.append(f'- {item["name"]}: {etym}')
        else:
            lines.append(f'- {item["name"]}')
    return 'Names:\n' + '\n'.join(lines)


def call_api(client, batch):
    response = client.messages.create(
        model=MODEL,
        max_tokens=400,
        system=[{
            'type': 'text',
            'text': SYSTEM_PROMPT,
            'cache_control': {'type': 'ephemeral'},
        }],
        messages=[{'role': 'user', 'content': build_user_message(batch)}],
    )
    text = next((b.text for b in response.content if b.type == 'text'), '')

    # Extract JSON object from response (handle any stray text)
    start = text.find('{')
    end = text.rfind('}') + 1
    if start == -1 or end == 0:
        return {}
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        return {}


def append_results(rows):
    file_exists = os.path.exists(MEANINGS_CSV)
    with open(MEANINGS_CSV, 'a', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['name', 'meaning', 'source'])
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def main():
    client = anthropic.Anthropic()

    existing = load_existing_names()
    print(f'Existing meanings: {len(existing)}')

    candidates = load_candidates(existing)
    print(f'Candidates (top {TOP_N}, missing meanings): {len(candidates)}')
    if not candidates:
        print('Nothing to do.')
        return

    batches = [candidates[i:i + BATCH_SIZE] for i in range(0, len(candidates), BATCH_SIZE)]
    total_added = 0

    for i, batch in enumerate(batches):
        print(f'Batch {i + 1}/{len(batches)} ({len(batch)} names)...', end=' ', flush=True)

        meanings = call_api(client, batch)

        new_rows = [
            {'name': item['name'], 'meaning': meanings[item['name']].strip(), 'source': 'llm'}
            for item in batch
            if meanings.get(item['name'], '').strip()
        ]

        if new_rows:
            append_results(new_rows)
            total_added += len(new_rows)

        print(f'{len(new_rows)}/{len(batch)} found  (total added: {total_added})')

        if i < len(batches) - 1:
            time.sleep(DELAY_BETWEEN_BATCHES)

    print(f'\nDone. Added {total_added} meanings to {MEANINGS_CSV}')


if __name__ == '__main__':
    main()
