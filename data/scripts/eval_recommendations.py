"""
Evaluates recommendation quality at different EMBEDDING_SCALE values.
Loads vectors locally from processed/name_vectors.csv — no RDS needed.
Uses Claude as judge: scores vibe/style match, not phonetic similarity.

Requires: ANTHROPIC_API_KEY in environment.
Run: python3.12 data/scripts/eval_recommendations.py
"""
import csv
import json
import os
import sys
import numpy as np
import anthropic

SCRIPTS_DIR = os.path.dirname(__file__)
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')
VECTORS_PATH = os.path.join(PROCESSED_DIR, 'name_vectors.csv')

HC_DIMS = 52
EMBED_DIMS = 512
TOP_N = 10
PASS_THRESHOLD = 7.0
SCALES_TO_TRY = [3, 4, 5, 6]

UNISEX_MIN = 0.05   # classification boundary
UNISEX_MAX = 0.95
SEX_FILTER_F = 0.10  # min female_pct for F-filtered recommendations
SEX_FILTER_M = 0.90  # max female_pct for M-filtered recommendations

TEST_CASES = [
    {"name": "Liam",    "context": "modern, short, Irish-origin boy name, #1 in the US for most of the 2010s-2020s"},
    {"name": "Emma",    "context": "classic, soft, short girl name, #1 in the US for years, timeless but modern feel"},
    {"name": "Aurora",  "context": "romantic, mythological, vintage-resurgent girl name with a grand, ethereal feel"},
    {"name": "Matilda", "context": "vintage British girl name, quirky and strong, associated with Roald Dahl, making a comeback"},
    {"name": "Noah",    "context": "biblical, short, gentle boy name, #1 in the US for nearly a decade"},
    {"name": "Atticus", "context": "literary boy name from To Kill a Mockingbird, preppy and intellectual, vintage feel"},
    {"name": "Willow",  "context": "nature-inspired, whimsical, modern girl name with a soft earthy vibe"},
    {"name": "Theodore","context": "vintage, formal, classic boy name with a strong comeback — often nicknamed Theo"},
    {"name": "Isla",    "context": "Scottish, soft, short, modern girl name rising sharply in popularity"},
    {"name": "Ezra",    "context": "biblical, modern, short literary boy name — rising in popularity, used by artists and writers"},
    {"name": "Frank",   "context": "classic, blunt, old-school masculine name that peaked mid-20th century, feels retro"},
    {"name": "Elliott", "context": "traditionally male name chosen for a girl — literary, gentle, gender-bending", "sex_override": "F"},
    {"name": "Callan",  "context": "modern Irish/Scottish surname-style boy name, strong and cool, rising in popularity"},
    {"name": "Colleen", "context": "Irish-American, vintage feminine name that peaked in mid-20th century America, feels nostalgic"},
    {"name": "Kylie",   "context": "modern, Australian-origin girl name with pop culture associations (Kylie Minogue, Kylie Jenner), bright and trendy"},
    {"name": "Charlie", "context": "nearly perfectly unisex name in 2025 — chosen for a girl, playful, friendly, nickname feel", "sex_override": "F"},
]


def load_vectors() -> tuple[list[str], list[int], list[float], np.ndarray, np.ndarray]:
    names, counts, female_pcts, hc_vecs, emb_vecs = [], [], [], [], []
    with open(VECTORS_PATH) as f:
        for row in csv.DictReader(f):
            v = json.loads(row['vector'])
            names.append(row['name'])
            counts.append(int(row.get('count_2025', 0)))
            female_pcts.append(float(row.get('female_pct', 0.5)))
            hc_vecs.append(v[:HC_DIMS])
            emb_vecs.append(v[HC_DIMS:HC_DIMS + EMBED_DIMS])
    return names, counts, female_pcts, np.array(hc_vecs, dtype=np.float32), np.array(emb_vecs, dtype=np.float32)


def sex_matches(candidate_fp: float, query_sex: str) -> bool:
    if query_sex == 'F':
        return candidate_fp >= SEX_FILTER_F
    if query_sex == 'M':
        return candidate_fp <= SEX_FILTER_M
    if query_sex == 'U':
        return UNISEX_MIN < candidate_fp < UNISEX_MAX
    return True


def infer_sex(female_pct: float) -> str:
    if female_pct >= UNISEX_MIN and female_pct <= UNISEX_MAX:
        return 'U'
    return 'F' if female_pct > 0.5 else 'M'


def levenshtein(a: str, b: str) -> int:
    a, b = a.lower(), b.lower()
    if abs(len(a) - len(b)) > 2:
        return 3
    dp = list(range(len(b) + 1))
    for ca in a:
        ndp = [dp[0] + 1]
        for j, cb in enumerate(b):
            ndp.append(min(dp[j] + (ca != cb), dp[j + 1] + 1, ndp[j] + 1))
        dp = ndp
    return dp[-1]


def get_neighbors(names, counts, female_pcts, hc, emb, query_name, query_sex, scale, top_n, min_count=200, max_same_prefix=2) -> list[tuple[str, float]]:
    if query_name not in names:
        return []
    idx = names.index(query_name)
    scaled = np.concatenate([hc, emb * scale], axis=1)
    norms = np.linalg.norm(scaled, axis=1, keepdims=True)
    norms[norms == 0] = 1e-9
    normed = scaled / norms
    sims = normed @ normed[idx]
    sims[idx] = -1  # exclude self

    results = []
    prefix_counts: dict[str, int] = {}
    query_prefix = query_name[:2].lower()

    for i in np.argsort(sims)[::-1]:
        if len(results) >= top_n:
            break
        name = names[i]
        if levenshtein(query_name, name) <= 3:
            continue
        if counts[i] < min_count:
            continue
        if not sex_matches(female_pcts[i], query_sex):
            continue
        prefix = name[:2].lower()
        if prefix_counts.get(prefix, 0) >= max_same_prefix:
            continue
        prefix_counts[prefix] = prefix_counts.get(prefix, 0) + 1
        results.append((name, float(sims[i])))

    return results


def judge_scale(test_cases, neighbors_by_name, client) -> dict[str, dict]:
    cases_text = ""
    for tc in test_cases:
        name = tc["name"]
        nbrs = neighbors_by_name.get(name, [])
        if not nbrs:
            continue
        rec_list = "\n".join(f"  {i+1}. {n} (similarity {s:.3f})" for i, (n, s) in enumerate(nbrs))
        cases_text += f"\n---\nName: {name}\nContext: {tc['context']}\nRecommendations:\n{rec_list}\n"

    prompt = f"""You are evaluating a baby name recommendation system. A couple loves a particular name and the system recommends similar names they might also love.

Score each recommendation list 1–10 based on VIBE and STYLE match — not phonetic similarity.

Scoring guide:
10 = Excellent — nearly all recommendations feel like names this couple would genuinely consider
7  = Good — most fit the right vibe, a few are off
5  = Mixed — roughly half are good, half are just sound-alikes with wrong feel
3  = Poor — mostly phonetic matches with wrong cultural feel
1  = Bad — none of these feel right

CRITICAL: Phonetic similarity alone is worthless. "Niam" for "Liam" is a terrible recommendation even though it rhymes. "Noah" or "Owen" for "Liam" would be excellent.

{cases_text}

Respond with a JSON object mapping each name to an object with "score" (integer 1-10) and "reason" (one short sentence). Example format:
{{"Liam": {{"score": 4, "reason": "Mostly phonetic matches like Niam — wrong vibe entirely"}}, "Emma": {{"score": 8, "reason": "Good mix of classic feminine names"}}}}

Return only the JSON, no other text."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    text = message.content[0].text.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text)


def main():
    print(f"Loading vectors from {VECTORS_PATH}...")
    names, counts, female_pcts, hc, emb = load_vectors()
    print(f"Loaded {len(names):,} names ({HC_DIMS} HC dims + {EMBED_DIMS} embedding dims)")

    missing = [tc["name"] for tc in TEST_CASES if tc["name"] not in names]
    if missing:
        print(f"WARNING: test names not found in vectors: {missing}")

    # resolve query sex per test case: use sex_override if present, else infer from female_pct
    def query_sex_for(tc):
        if "sex_override" in tc:
            return tc["sex_override"]
        idx = names.index(tc["name"]) if tc["name"] in names else -1
        return infer_sex(female_pcts[idx]) if idx >= 0 else 'U'

    client = anthropic.Anthropic()

    best_scale = None
    best_avg = 0.0

    print(f"\n{'Scale':>6}  {'Avg':>5}  {'Pass?':>6}  Per-name scores")
    print("-" * 80)

    for scale in SCALES_TO_TRY:
        neighbors_by_name = {
            tc["name"]: get_neighbors(names, counts, female_pcts, hc, emb, tc["name"], query_sex_for(tc), scale, TOP_N)
            for tc in TEST_CASES
        }

        scores = judge_scale(TEST_CASES, neighbors_by_name, client)

        avg = sum(v["score"] for v in scores.values()) / len(scores)
        passed = avg >= PASS_THRESHOLD
        if avg > best_avg:
            best_avg = avg
            best_scale = scale

        per_name = "  ".join(f"{n}:{v['score']}" for n, v in scores.items())
        status = "PASS ✓" if passed else "fail"
        print(f"{scale:>5}x  {avg:>5.1f}  {status:>6}  {per_name}")

        if passed:
            print(f"\n✓ Passing at scale {scale}x (avg {avg:.1f}/10)")
            print(f"\nNeighbors at scale {scale}x:")
            for tc in TEST_CASES:
                nbrs = [n for n, _ in neighbors_by_name[tc["name"]][:5]]
                reason = scores.get(tc["name"], {}).get("reason", "")
                print(f"  {tc['name']:12} → {', '.join(nbrs)}")
                print(f"               Judge: {reason}")
            print(f"\n→ Set EMBEDDING_SCALE = {scale} in compute_vectors.py, then re-run it and upload.")
            return

    print(f"\n✗ No scale passed threshold {PASS_THRESHOLD}. Best: scale={best_scale}x avg={best_avg:.1f}")
    print(f"→ Consider increasing SCALES_TO_TRY or removing noisy hand-crafted features.")

    print(f"\nNeighbors at best scale ({best_scale}x):")
    neighbors_by_name = {
        tc["name"]: get_neighbors(names, counts, female_pcts, hc, emb, tc["name"], query_sex_for(tc), best_scale, TOP_N)
        for tc in TEST_CASES
    }
    for tc in TEST_CASES:
        nbrs = [n for n, _ in neighbors_by_name[tc["name"]][:5]]
        print(f"  {tc['name']:12} → {', '.join(nbrs)}")


if __name__ == '__main__':
    main()
