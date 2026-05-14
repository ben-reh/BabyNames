"""
Crawl Reddit for baby name lists posted 2023–2026.

Targets r/namenerds (broad), r/BabyBumps and r/pregnant (name-specific searches).
Uses Claude Haiku to extract the names each author is considering from post text,
preserving the grouping so co-occurrence can feed the similarity model.

Output: data/raw/reddit/name_lists.jsonl
Each line: { post_id, subreddit, date, url, title, names[] }

Resume-safe: skips post IDs already written to the output file.
"""

import datetime
import json
import os
import time

import anthropic
import requests

SCRIPTS_DIR = os.path.dirname(__file__)
OUT_DIR = os.path.join(SCRIPTS_DIR, "..", "raw", "reddit")
OUT_FILE = os.path.join(OUT_DIR, "name_lists.jsonl")

START_TS = int(datetime.datetime(2023, 1, 1).timestamp())
END_TS = int(datetime.datetime(2026, 12, 31, 23, 59, 59).timestamp())

# Queries per subreddit. namenerds is name-focused so broad terms work;
# the parenting subs need more specific queries to find name-list posts.
TARGETS = {
    "namenerds": [
        "shortlist",
        "name list",
        "our list",
        "favorites",
        "top names",
        "help us choose",
        "narrowed down",
        "combo",
    ],
    "BabyBumps": [
        "name shortlist",
        "baby name list",
        "narrowed down names",
        "name help shortlist",
        "name list",
    ],
    "pregnant": [
        "name shortlist",
        "baby name list",
        "name list help",
    ],
}

HEADERS = {
    "User-Agent": "BabyNameResearch/1.0 (academic data collection for name recommendation research)",
}

REDDIT_DELAY = 1.1   # seconds between Reddit API calls
CLAUDE_DELAY = 0.3   # seconds between Claude calls


def search_page(subreddit: str, query: str, after: str | None) -> dict:
    params = {
        "q": query,
        "restrict_sr": "1",
        "sort": "new",
        "t": "all",
        "limit": 100,
        "type": "link",
    }
    if after:
        params["after"] = after

    url = f"https://www.reddit.com/r/{subreddit}/search.json"
    resp = requests.get(url, params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


EXTRACTION_PROMPT = """\
You are extracting baby name candidates from a Reddit post.

Return a JSON array of first names that the author is actively considering or \
expressing positive interest in as potential baby names. Include names they list, \
mention as favorites, or are debating between.

Exclude: surnames, names they explicitly dislike or reject, names used only as \
examples or comparisons ("everyone is naming their kid Emma these days"), \
and non-name words.

If fewer than 2 qualifying names are present, return [].
Return ONLY the JSON array — no explanation, no markdown.

Post title: {title}

Post body:
{body}"""


def extract_names(client: anthropic.Anthropic, title: str, body: str) -> list[str]:
    prompt = EXTRACTION_PROMPT.format(
        title=title,
        body=body[:2500],
    )
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    try:
        names = json.loads(raw)
        return [n for n in names if isinstance(n, str) and 2 <= len(n) <= 30]
    except (json.JSONDecodeError, TypeError):
        return []


def load_seen_ids() -> set[str]:
    seen: set[str] = set()
    if not os.path.exists(OUT_FILE):
        return seen
    with open(OUT_FILE) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                seen.add(json.loads(line)["post_id"])
            except (json.JSONDecodeError, KeyError):
                pass
    return seen


def crawl() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    client = anthropic.Anthropic()
    seen = load_seen_ids()
    print(f"Resuming — {len(seen)} posts already collected.")

    total_new = 0

    with open(OUT_FILE, "a") as out:
        for subreddit, queries in TARGETS.items():
            for query in queries:
                print(f"\nr/{subreddit}  query='{query}'")
                after = None
                page = 0

                while True:
                    try:
                        data = search_page(subreddit, query, after)
                    except requests.HTTPError as exc:
                        print(f"  HTTP error: {exc} — skipping query")
                        break

                    posts = data["data"]["children"]
                    if not posts:
                        print("  No more results.")
                        break

                    kept = 0
                    oldest_seen = None

                    for post in posts:
                        p = post["data"]
                        ts = int(p.get("created_utc", 0))
                        oldest_seen = ts

                        if ts < START_TS or ts > END_TS:
                            continue

                        post_id = p["id"]
                        if post_id in seen:
                            continue

                        title = p.get("title", "").strip()
                        body = p.get("selftext", "").strip()
                        if body in ("[deleted]", "[removed]"):
                            body = ""

                        # Skip posts with no body and a generic title —
                        # link posts rarely contain name lists.
                        if not body and not any(
                            kw in title.lower()
                            for kw in ("name", "list", "shortlist", "pick", "choose", "favorite")
                        ):
                            seen.add(post_id)
                            continue

                        names = extract_names(client, title, body)
                        time.sleep(CLAUDE_DELAY)

                        seen.add(post_id)

                        if len(names) < 2:
                            continue

                        date_str = datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                        record = {
                            "post_id": post_id,
                            "subreddit": subreddit,
                            "date": date_str,
                            "url": f"https://reddit.com{p['permalink']}",
                            "title": title,
                            "names": names,
                        }
                        out.write(json.dumps(record) + "\n")
                        out.flush()
                        total_new += 1
                        kept += 1
                        print(f"  [{date_str}] {title[:55]!r} → {names}")

                    oldest_dt = (
                        datetime.datetime.utcfromtimestamp(oldest_seen).strftime("%Y-%m-%d")
                        if oldest_seen else "?"
                    )
                    print(f"  page {page + 1}: {len(posts)} posts, {kept} lists kept  (oldest: {oldest_dt})")

                    # Stop paginating once we've scrolled past the start of our window.
                    if oldest_seen and oldest_seen < START_TS:
                        print("  Reached pre-2023 posts — stopping pagination.")
                        break

                    after = data["data"].get("after")
                    if not after:
                        break

                    page += 1
                    time.sleep(REDDIT_DELAY)

                time.sleep(REDDIT_DELAY)

    print(f"\nDone. {total_new} new name lists written to {os.path.abspath(OUT_FILE)}")


if __name__ == "__main__":
    crawl()
