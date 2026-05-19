"""
Crawls the Nameberry forum (forum.nameberry.com) for baby name shortlists.
Uses the public Discourse JSON API — no authentication required.
Names are pre-tagged as [name]X[/name] in posts, so no LLM extraction needed.

Output: data/raw/nameberry/name_lists.jsonl
  {"post_id": "12345", "source": "nameberry", "date": "2026-01-01",
   "url": "...", "title": "...", "names": ["Harriet", "Beatrice", "Edith"]}

Resume-safe: skips already-processed thread IDs.
Rate-limited to ~1 req/sec to be respectful.

Run: python3.12 data/scripts/crawl_nameberry.py
     python3.12 data/scripts/crawl_nameberry.py --max-posts 2000
"""
import json
import os
import re
import ssl
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

SCRIPTS_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPTS_DIR, '..')
OUT_DIR = os.path.join(DATA_DIR, 'raw', 'nameberry')
OUT_PATH = os.path.join(OUT_DIR, 'name_lists.jsonl')

SITEMAP_INDEX = 'https://forum.nameberry.com/sitemap.xml'
BASE_URL = 'https://forum.nameberry.com'
MIN_NAMES = 4
MAX_NAMES = 20  # cap filters out name-bank games and community list threads
RATE_LIMIT = 1.1  # seconds between requests

CONSTRAINED_SLUGS = [
    'sibling', 'sister', 'brother', 'middle-name', 'middle-names',
    'goes-with', 'pairs-with', 'honor-name',
]

HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; research crawler)'}


def fetch(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
            return r.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f'  fetch error {url}: {e}')
        return None


def get_sitemap_urls() -> list[str]:
    content = fetch(SITEMAP_INDEX)
    if not content:
        return []
    root = ET.fromstring(content)
    ns = {'sm': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    return [loc.text for loc in root.findall('.//sm:loc', ns)]


def get_thread_urls(sitemap_url: str) -> list[tuple[str, str]]:
    """Returns list of (thread_url, slug) pairs from a sitemap file."""
    content = fetch(sitemap_url)
    if not content:
        return []
    time.sleep(RATE_LIMIT)
    root = ET.fromstring(content)
    ns = {'sm': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    results = []
    for loc in root.findall('.//sm:loc', ns):
        url = loc.text
        # URL format: https://forum.nameberry.com/t/slug/id
        m = re.match(r'https://forum\.nameberry\.com/t/([^/]+)/(\d+)$', url)
        if m:
            slug, tid = m.group(1), m.group(2)
            results.append((url, slug, tid))
    return results


def is_constrained(slug: str) -> bool:
    return any(kw in slug for kw in CONSTRAINED_SLUGS)


def extract_names(cooked: str) -> list[str]:
    """Extract [name]X[/name], [name_f]X[/name_f], [name_m]X[/name_m] tagged names."""
    raw_names = re.findall(r'\[name(?:_[fm])?\]([^\[]+)\[/name(?:_[fm])?\]', cooked, re.I)
    seen, result = set(), []
    for n in raw_names:
        n = n.strip().title()
        # Minimum 3 chars filters greeting words like "Hi", "Ok"
        if 3 <= len(n) <= 30 and n not in seen:
            seen.add(n)
            result.append(n)
    return result


def fetch_thread(thread_url: str) -> dict | None:
    json_url = thread_url + '.json'
    content = fetch(json_url)
    time.sleep(RATE_LIMIT)
    if not content:
        return None
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None


def load_seen_ids() -> set[str]:
    seen = set()
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        seen.add(json.loads(line)['post_id'])
                    except Exception:
                        pass
    return seen


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--max-posts', type=int, default=0,
                        help='Stop after collecting this many posts (0 = no limit)')
    args = parser.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    seen_ids = load_seen_ids()
    print(f'Already collected: {len(seen_ids)} posts')

    print('Fetching sitemap index...')
    sitemap_urls = get_sitemap_urls()
    print(f'Found {len(sitemap_urls)} sitemaps')

    saved = 0
    skipped_constraint = 0
    skipped_seen = 0
    skipped_toofew = 0

    with open(OUT_PATH, 'a') as out:
        # Iterate newest sitemaps first
        for sitemap_url in reversed(sitemap_urls):
            print(f'\nProcessing {sitemap_url}...')
            threads = get_thread_urls(sitemap_url)
            print(f'  {len(threads)} threads in sitemap')

            for thread_url, slug, tid in threads:
                if tid in seen_ids:
                    skipped_seen += 1
                    continue
                if is_constrained(slug):
                    skipped_constraint += 1
                    seen_ids.add(tid)
                    continue

                data = fetch_thread(thread_url)
                if not data:
                    continue

                title = data.get('title', '')
                posts = data.get('post_stream', {}).get('posts', [])
                if not posts:
                    continue

                # Extract names from the opening post only
                cooked = posts[0].get('cooked', '')
                names = extract_names(cooked)

                if len(names) < MIN_NAMES or len(names) > MAX_NAMES:
                    skipped_toofew += 1
                    seen_ids.add(tid)
                    continue

                created_at = posts[0].get('created_at', '')[:10]

                record = {
                    'post_id': tid,
                    'source': 'nameberry',
                    'date': created_at,
                    'url': thread_url,
                    'title': title,
                    'names': names,
                }
                out.write(json.dumps(record) + '\n')
                out.flush()
                seen_ids.add(tid)
                saved += 1

                if saved % 50 == 0:
                    print(f'  saved={saved} skipped_seen={skipped_seen} '
                          f'toofew={skipped_toofew} constraint={skipped_constraint}')

                if args.max_posts and saved >= args.max_posts:
                    print(f'\nReached --max-posts {args.max_posts}, stopping.')
                    return

    print(f'\nDone. Saved {saved} posts to {OUT_PATH}')
    print(f'Skipped: {skipped_seen} seen, {skipped_toofew} too few names, '
          f'{skipped_constraint} constrained context')


if __name__ == '__main__':
    main()
