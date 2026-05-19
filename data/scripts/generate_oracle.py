"""
Generates oracle gold/trap sets for the LLM-as-judge eval.
Run once; saves results to data/processed/oracle_sets.json.

Gold set:  names a parent who loves X would genuinely also consider.
Trap set:  phonetically similar names with the wrong vibe.

After generation, validates each suggested name against name_vectors.csv
and reports gaps (names the system can't recommend).

Requires: ANTHROPIC_API_KEY
Run: python3.12 data/scripts/generate_oracle.py
"""
import csv
import json
import os
import anthropic

SCRIPTS_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPTS_DIR, '..')
VECTORS_PATH = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')
OUTPUT_PATH = os.path.join(DATA_DIR, 'processed', 'oracle_sets.json')

TEST_CASES = [
    # ── Girls ──────────────────────────────────────────────────────────────
    {"name": "Emma",    "sex": "F", "context": "classic, soft, short girl name — #1 in the US for years, timeless but modern feel"},
    {"name": "Aurora",  "sex": "F", "context": "romantic, mythological, vintage-resurgent — grand, ethereal, fairy-tale feel"},
    {"name": "Matilda", "sex": "F", "context": "vintage British, quirky and strong — associated with Roald Dahl, making a comeback"},
    {"name": "Isla",    "sex": "F", "context": "Scottish, soft, short, modern — rising sharply, understated and cool"},
    {"name": "Willow",  "sex": "F", "context": "nature-inspired, whimsical, modern — soft earthy vibe, gentle and free-spirited"},
    {"name": "Kylie",   "sex": "F", "context": "modern, bright, pop-culture girl name — Australian-origin, energetic and trendy"},
    {"name": "Naomi",   "sex": "F", "context": "Hebrew/biblical feminine — soft but grounded, rising steadily, literary without being precious"},
    {"name": "Colette", "sex": "F", "context": "French feminine, literary and chic — associated with the novelist, elegant and a little bohemian"},
    {"name": "Juniper", "sex": "F", "context": "botanical nature name — adventurous and earthy, distinct from the soft/whimsical nature cluster"},
    {"name": "Elliott", "sex": "F", "context": "traditionally male name chosen for a girl — literary, gentle, gender-bending", "sex_override": "F"},
    {"name": "Charlie", "sex": "U", "context": "nearly perfectly unisex — chosen for a girl, playful, friendly, nickname feel", "sex_override": "F"},
    # ── Boys ───────────────────────────────────────────────────────────────
    {"name": "Noah",     "sex": "M", "context": "biblical, short, gentle boy name — #1 in the US for nearly a decade, soft and universal"},
    {"name": "Theodore", "sex": "M", "context": "vintage, formal, classic — strong comeback name, often nicknamed Theo, warmly intellectual"},
    {"name": "Atticus",  "sex": "M", "context": "literary, preppy, intellectual — from To Kill a Mockingbird, vintage but not fusty"},
    {"name": "Ezra",     "sex": "M", "context": "biblical, modern, short — rising fast, used by artists and writers, soft but rooted"},
    {"name": "Frank",    "sex": "M", "context": "classic, blunt, old-school masculine — peaked mid-20th century, feels intentionally retro"},
    {"name": "Mateo",    "sex": "M", "context": "Spanish/Latinx masculine — warm and romantic, one of the fastest-rising names in the US"},
    {"name": "Magnus",   "sex": "M", "context": "Nordic/Scandinavian masculine — strong and ancient, niche but rising, distinctly Northern European"},
    {"name": "Tariq",    "sex": "M", "context": "Arabic masculine — classic in the Arab world, dignified and warm, underrepresented in US mainstream lists"},
]


def load_name_set() -> set[str]:
    names = set()
    with open(VECTORS_PATH) as f:
        for row in csv.DictReader(f):
            names.add(row['name'])
    return names


def build_prompt() -> str:
    cases_text = ""
    for tc in TEST_CASES:
        cases_text += f"\nName: {tc['name']}\nSex context: {tc.get('sex_override', tc['sex'])}\nVibe: {tc['context']}\n"

    return f"""You are helping build a baby name recommendation eval dataset.

For each name below, return two lists:
1. **gold** — 25 names a parent who loves this name would genuinely also consider. Think vibe, style, cultural feel, and era — NOT sound similarity. "Noah" for "Liam" = excellent. "Niam" for "Liam" = terrible.
2. **trap** — 8 names that sound similar but have the wrong vibe (the kind a bad recommendation system returns). These are the failure modes to watch for.

Rules:
- Gold names should feel like they belong together in a real parent's shortlist.
- Trap names should be phonetically plausible near-neighbors that a parent who loves the anchor name would NOT want.
- Respect the sex context. For F names return girl names; for M names return boy names; for U names you may mix.
- Cover the full range of the vibe — don't just pick the most popular names.
- No made-up names. Use real names that exist and have been given to babies.

{cases_text}

Respond with a JSON object keyed by name. Each value has "gold" (array of 25 strings) and "trap" (array of 8 strings). Example:
{{"Liam": {{"gold": ["Noah", "Owen", ...], "trap": ["Niam", "Liam2", ...]}}}}

Return only the JSON, no other text."""


def validate(oracle: dict, name_set: set[str]) -> None:
    print("\nValidation (names not in name_vectors.csv):")
    any_missing = False
    for name, data in oracle.items():
        for key in ("gold", "trap"):
            missing = [n for n in data[key] if n not in name_set]
            if missing:
                print(f"  {name} {key}: {missing}")
                any_missing = True
    if not any_missing:
        print("  All suggested names are in the vector set.")


def main() -> None:
    print(f"Loading name set from {VECTORS_PATH}...")
    name_set = load_name_set()
    print(f"Loaded {len(name_set):,} names\n")

    client = anthropic.Anthropic()

    print("Generating oracle sets via Claude...")
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": build_prompt()}],
    )

    text = message.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    oracle = json.loads(text)

    # Attach context to each entry for reference
    context_by_name = {tc["name"]: tc["context"] for tc in TEST_CASES}
    for name, data in oracle.items():
        data["context"] = context_by_name.get(name, "")

    validate(oracle, name_set)

    with open(OUTPUT_PATH, "w") as f:
        json.dump(oracle, f, indent=2)

    print(f"\nSaved oracle sets to {OUTPUT_PATH}")
    gold_sizes = ', '.join(f'{n}:{len(d["gold"])}' for n, d in oracle.items())
    trap_sizes = ', '.join(f'{n}:{len(d["trap"])}' for n, d in oracle.items())
    print(f"\nGold set sizes: {gold_sizes}")
    print(f"Trap set sizes: {trap_sizes}")


if __name__ == "__main__":
    main()
