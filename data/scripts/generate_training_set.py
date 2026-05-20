"""
Generates LLM training oracle sets for the reranker — completely separate from
eval_oracle_recall.py's oracle_sets.json to avoid data leakage.

Uses Claude to produce gold (vibe-similar) and trap (phonetically similar, wrong vibe)
sets for diverse anchors covering styles not in the eval oracle.

Skips anchors already present in training_oracle.json so reruns are cheap.

Output: data/processed/training_oracle.json

Run: python3.12 data/scripts/generate_training_set.py
"""
import csv
import json
import os
import anthropic

SCRIPTS_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(SCRIPTS_DIR, '..')
VECTORS_PATH = os.path.join(DATA_DIR, 'processed', 'name_vectors.csv')
OUTPUT_PATH = os.path.join(DATA_DIR, 'processed', 'training_oracle.json')

# All eval oracle anchors — never use these as training anchors
ORACLE_ANCHORS = {
    "Emma", "Matilda", "Willow", "Naomi", "Colette", "Juniper",  # dev
    "Theodore", "Ezra", "Mateo", "Tariq",                          # dev
    "Aurora", "Isla", "Kylie", "Elliott", "Charlie",               # test
    "Noah", "Atticus", "Frank", "Magnus",                          # test
}

# 50 diverse training anchors — styles and origins not well covered by oracle
TRAINING_CASES = [
    # ── Girls: Vintage British ─────────────────────────────────────────────
    {"name": "Edith",      "sex": "F", "context": "vintage British, literary — Edith Wharton, Downton Abbey, strong and understated"},
    {"name": "Florence",   "sex": "F", "context": "vintage artistic traveler — Florence Nightingale, Italian city, warm and romantic"},
    {"name": "Harriet",    "sex": "F", "context": "strong British vintage — Harriet Tubman, Harriet the Spy, determined and serious"},
    {"name": "Cecily",     "sex": "F", "context": "Victorian literary — Oscar Wilde's The Importance of Being Earnest, delicate and witty"},
    {"name": "Clementine", "sex": "F", "context": "French-origin, literary — Winston Churchill's wife, sweet and old-fashioned"},
    # ── Girls: French & European ──────────────────────────────────────────
    {"name": "Margot",     "sex": "F", "context": "French, sophisticated — short, chic, literary (The Royal Tenenbaums), modern but timeless"},
    {"name": "Vivienne",   "sex": "F", "context": "French/British, elegant — Vivienne Westwood, long and dramatic, slightly glamorous"},
    {"name": "Sylvia",     "sex": "F", "context": "literary, mid-century — Sylvia Plath, artistic and melancholy, quietly resurgent"},
    {"name": "Genevieve",  "sex": "F", "context": "French, long and romantic — patron saint of Paris, elegant and uncommon"},
    {"name": "Beatrice",   "sex": "F", "context": "Italian/Shakespeare, intellectual — Dante's Beatrice, Much Ado, literary and warm"},
    # ── Girls: Biblical / Hebrew ──────────────────────────────────────────
    {"name": "Rachel",     "sex": "F", "context": "Biblical, grounded — classic Hebrew name, steady and familiar, soft but not trendy"},
    {"name": "Miriam",     "sex": "F", "context": "Biblical Hebrew, musical — Moses' sister, ancient and lyrical, making a quiet comeback"},
    {"name": "Judith",     "sex": "F", "context": "Biblical, strong — Judith and Holofernes, mid-century peak, feels intentionally retro"},
    {"name": "Deborah",    "sex": "F", "context": "Biblical judge — strong and ancient, feels mid-century, less fashionable but grounded"},
    # ── Girls: Nature / Whimsical ─────────────────────────────────────────
    {"name": "Violet",     "sex": "F", "context": "nature/color, vintage-resurgent — soft but not saccharine, Downton Abbey, Incredibles"},
    {"name": "Iris",       "sex": "F", "context": "nature, Greek mythology — goddess of the rainbow, flower, short and elegant"},
    {"name": "Wren",       "sex": "F", "context": "short nature name — tiny bird, modern and minimal, quietly rising"},
    {"name": "Poppy",      "sex": "F", "context": "British nature name — cheerful, bright, very popular in UK, less common in US"},
    # ── Girls: Modern / International ─────────────────────────────────────
    {"name": "Nora",       "sex": "F", "context": "Irish/Scandinavian, short and sweet — A Doll's House, simple and modern, rising fast"},
    {"name": "Stella",     "sex": "F", "context": "Latin, starry — Streetcar Named Desire, elegant and classic, European feel"},
    {"name": "Amara",      "sex": "F", "context": "African/Igbo, eternal — modern and multicultural, rising fast in the US"},
    {"name": "Freya",      "sex": "F", "context": "Norse goddess — love and war, hugely popular in UK/Scandinavia, strong and mythological"},
    {"name": "Penelope",   "sex": "F", "context": "Greek, literary — Odysseus' wife, long and nickname-rich (Penny), elegant comeback"},
    {"name": "Arabella",   "sex": "F", "context": "British aristocratic — long, flowing, Harry Potter adjacent, posh but wearable"},
    {"name": "Ingrid",     "sex": "F", "context": "Scandinavian, strong — Ingrid Bergman, cool and unfussy, effortlessly stylish"},
    # ── Boys: Classic British ─────────────────────────────────────────────
    {"name": "Edmund",     "sex": "M", "context": "British vintage — Narnia's Edmund, Shakespeare, King Lear, distinguished and literary"},
    {"name": "Rupert",     "sex": "M", "context": "British posh — Rupert Bear, Prince Rupert, very English, unusual in the US"},
    {"name": "Benedict",   "sex": "M", "context": "saint name — Benedict Cumberbatch, long and dignified, Sherlock connection"},
    {"name": "Hugo",       "sex": "M", "context": "European, literary — Victor Hugo, warm and distinguished, popular across Europe"},
    {"name": "Barnaby",    "sex": "M", "context": "British quirky vintage — Barnaby Rudge, cheerful and unusual"},
    # ── Boys: Biblical / Hebrew ───────────────────────────────────────────
    {"name": "Elijah",     "sex": "M", "context": "Biblical prophet — soaring in popularity, musical and strong, Hebrew with modern feel"},
    {"name": "Isaiah",     "sex": "M", "context": "Biblical prophet — long and lyrical, rising steadily, warm and dignified"},
    {"name": "Solomon",    "sex": "M", "context": "Biblical king — wise, ancient, very uncommon in modern use, weighty and distinguished"},
    {"name": "Gideon",     "sex": "M", "context": "Biblical judge — strong G-name, underused, Old Testament feel without being stuffy"},
    {"name": "Malachi",    "sex": "M", "context": "Biblical minor prophet — ends in -eye sound, Irish/Hebrew crossover, rising"},
    # ── Boys: Celtic / Norse ──────────────────────────────────────────────
    {"name": "Finn",       "sex": "M", "context": "Irish/Celtic, short, rising — Finn McCool, friendly and adventurous, very popular in UK"},
    {"name": "Ronan",      "sex": "M", "context": "Irish/Celtic — little seal, strong and musical, less common than Finn but rising"},
    {"name": "Soren",      "sex": "M", "context": "Scandinavian, literary — Søren Kierkegaard, cool and intellectual, underused in US"},
    {"name": "Leif",       "sex": "M", "context": "Norse — Leif Erikson, adventurous and ancient, very uncommon but distinctive"},
    # ── Boys: Modern European ─────────────────────────────────────────────
    {"name": "Milo",       "sex": "M", "context": "European, friendly — Milo and Otis, short and warm, popular across Europe, rising in US"},
    {"name": "Jasper",     "sex": "M", "context": "gemstone name, artistic — Jasper Johns, vintage but modern, Twilight adjacent"},
    {"name": "Felix",      "sex": "M", "context": "Latin, cheerful — lucky/happy meaning, European and friendly, popular in UK/Germany"},
    {"name": "Julian",     "sex": "M", "context": "Latin, elegant — Julian of Norwich, European, soft and distinguished"},
    {"name": "Sebastian",  "sex": "M", "context": "Latin, European — Sebastian Bach, patron saint of athletes, long and literary"},
    # ── Boys: Vintage American ────────────────────────────────────────────
    {"name": "Walter",     "sex": "M", "context": "vintage American — Walter White, Breaking Bad, mid-century peak, intentionally retro"},
    {"name": "Clarence",   "sex": "M", "context": "vintage American — It's a Wonderful Life, peak early 20th century, very old-fashioned"},
    {"name": "Dashiell",   "sex": "M", "context": "literary American — Dashiell Hammett, dashing and unusual, The Incredibles (Dash)"},
    # ── Boys: International ───────────────────────────────────────────────
    {"name": "Raphael",    "sex": "M", "context": "Hebrew/Renaissance — archangel, Renaissance painter, European and artistic"},
    {"name": "Alistair",   "sex": "M", "context": "Scottish, distinguished — Alistair Cooke, cool and formal, less common than Alastair"},
    {"name": "Ambrose",    "sex": "M", "context": "Latin, saintly — Saint Ambrose, unusual and distinguished, literary and ancient"},

    # ── Girls: Modern popular ─────────────────────────────────────────────
    {"name": "Sophia",     "sex": "F", "context": "Greek, timeless — wisdom, elegant and internationally beloved, #1 for years"},
    {"name": "Olivia",     "sex": "F", "context": "Latin, Shakespeare — Twelfth Night, olive tree, top US name, soft and classic"},
    {"name": "Ava",        "sex": "F", "context": "short, soft — Ava Gardner, Latin/Hebrew roots, hugely popular, simple and clean"},
    {"name": "Charlotte",  "sex": "F", "context": "French, royal — Charlotte Brontë, Princess Charlotte, classic with modern energy"},
    {"name": "Harper",     "sex": "F", "context": "surname style — Harper Lee, modern literary cool, unisex origin but now mostly girl"},
    {"name": "Evelyn",     "sex": "F", "context": "vintage resurgent — peaked 1920s, back strongly, gentle and slightly old-fashioned"},
    {"name": "Abigail",    "sex": "F", "context": "Biblical, solid — John Adams' wife, strong and unfussy, steady comeback"},
    {"name": "Emily",      "sex": "F", "context": "classic, literary — Emily Dickinson, Brontë, perennially popular, warm and familiar"},
    {"name": "Elizabeth",  "sex": "F", "context": "evergreen royal — Elizabeth I, II, Jane Austen, nickname-rich, never goes out of style"},
    {"name": "Mia",        "sex": "F", "context": "short and sweet — Mia Farrow, Italian/Scandinavian, ultra-popular, friendly feel"},
    {"name": "Ella",       "sex": "F", "context": "short nickname-name — Ella Fitzgerald, simple and musical, timeless feel"},
    {"name": "Madison",    "sex": "F", "context": "surname style — Splash (1984 movie), presidential, modern and assertive"},
    {"name": "Scarlett",   "sex": "F", "context": "Gone with the Wind — bold, Southern Gothic, literary and dramatic, fashion-forward"},
    {"name": "Grace",      "sex": "F", "context": "virtue name — Grace Kelly, simple and elegant, Puritan origin, universal appeal"},
    {"name": "Lily",       "sex": "F", "context": "flower, pure — Lily of the Valley, simple and sweet, floral without being fussy"},
    {"name": "Chloe",      "sex": "F", "context": "Greek, pastoral — one of the most popular names of the 2000s, bright and friendly"},
    {"name": "Hannah",     "sex": "F", "context": "Biblical palindrome — Hannah and Her Sisters, soft and grounded, Puritan revival"},
    {"name": "Zoe",        "sex": "F", "context": "Greek, life — short and modern, Zoe Saldana, friendly and energetic"},
    {"name": "Sofia",      "sex": "F", "context": "Latinx/European spelling — Sofia Vergara, warm and romantic, rising alternative to Sophia"},
    {"name": "Layla",      "sex": "F", "context": "Arabic, musical — Eric Clapton's Layla, lyrical and romantic, rising fast in US"},
    # ── Girls: Victorian revival ──────────────────────────────────────────
    {"name": "Agnes",      "sex": "F", "context": "Victorian saint — Agnes of God, unusually coming back, austere and quietly cool"},
    {"name": "Agatha",     "sex": "F", "context": "Victorian, detective — Agatha Christie, sharp and bookish, deliberately unfashionable"},
    {"name": "Mabel",      "sex": "F", "context": "Victorian, comeback — short and sweet, 1890s peak, feels endearingly antique"},
    {"name": "Ada",        "sex": "F", "context": "Victorian tech — Ada Lovelace, short and sharp, programmer appeal, rising"},
    {"name": "Elsie",      "sex": "F", "context": "Victorian nickname — Elsie the cow, old dairy-maid feel, surprisingly charming"},
    {"name": "Blanche",    "sex": "F", "context": "French, Southern Gothic — A Streetcar Named Desire, faded glamour, archaic cool"},
    {"name": "Millicent",  "sex": "F", "context": "Victorian mouthful — Millie for short, long and serious, Downton adjacent"},
    {"name": "Dorothy",    "sex": "F", "context": "Wizard of Oz — classic American, mid-century peak, soft and unpretentious comeback"},
    # ── Girls: Greek / mythological ───────────────────────────────────────
    {"name": "Athena",     "sex": "F", "context": "Greek goddess — wisdom and war, bold and intellectual, rising in the US"},
    {"name": "Daphne",     "sex": "F", "context": "Greek myth — pursued by Apollo, turned to laurel, Bridgerton, British literary feel"},
    {"name": "Phoebe",     "sex": "F", "context": "Greek, lunar — Friends' Phoebe, bright and quirky, Titan of brightness"},
    {"name": "Thea",       "sex": "F", "context": "Greek, short form — Theodora or standalone, simple and warm, understated"},
    {"name": "Cassandra",  "sex": "F", "context": "Greek prophetess — doomed to be right and ignored, dramatic and literary"},
    {"name": "Rosalind",   "sex": "F", "context": "Shakespeare — As You Like It, long and romantic, rarely used but beautifully literary"},
    {"name": "Viola",      "sex": "F", "context": "Shakespeare — Twelfth Night, also a musical instrument, elegant and artistic"},
    {"name": "Imogen",     "sex": "F", "context": "Shakespeare — Cymbeline, British, intellectual, less common than other Shakespeare names"},
    # ── Girls: Arabic / Middle Eastern ────────────────────────────────────
    {"name": "Fatima",     "sex": "F", "context": "Arabic, sacred — daughter of the Prophet, one of the most common names globally, dignified"},
    {"name": "Yasmin",     "sex": "F", "context": "Arabic/Persian, jasmine flower — fragrant and graceful, widely used across cultures"},
    {"name": "Amina",      "sex": "F", "context": "Arabic, trustworthy — the Prophet's mother, simple and elegant, widely used"},
    {"name": "Zara",       "sex": "F", "context": "Arabic/Slavic — princess, bright flower, also a fashion brand, sharp and modern"},
    {"name": "Nadia",      "sex": "F", "context": "Slavic/Arabic — hope, Nadia Comaneci, Eastern European feel, graceful"},
    {"name": "Leila",      "sex": "F", "context": "Arabic, night — romantic and lyrical, widely used across Middle East and beyond"},
    # ── Girls: Spanish / Latinx ───────────────────────────────────────────
    {"name": "Isabella",   "sex": "F", "context": "Latinx/Italian — Twilight, long and romantic, once #1 in the US, warm and grand"},
    {"name": "Valentina",  "sex": "F", "context": "Latinx, Valentine — romantic and flowing, rising in the US, Latin warmth"},
    {"name": "Camila",     "sex": "F", "context": "Latinx — Camila Cabello, soft and warm, rising fast, Spanish/Italian feel"},
    {"name": "Lucia",      "sex": "F", "context": "Latinx/Italian — saint of light, clear and melodic, elegant across cultures"},
    {"name": "Paloma",     "sex": "F", "context": "Spanish, dove — peaceful and elegant, unusual in US, artistic and distinctive"},
    {"name": "Carmen",     "sex": "F", "context": "Spanish opera — Bizet's Carmen, passionate and fiery, classic Iberian"},
    # ── Girls: Scandinavian ───────────────────────────────────────────────
    {"name": "Astrid",     "sex": "F", "context": "Nordic — divine strength, Astrid Lindgren (Pippi Longstocking), strong and cool"},
    {"name": "Sigrid",     "sex": "F", "context": "Norse — fair victory, the singer Sigrid, Scandinavian and unfussy"},
    {"name": "Sienna",     "sex": "F", "context": "Italian/British — the city of Siena, warm earthy tone, Sienna Miller, artistic"},
    {"name": "Fiona",      "sex": "F", "context": "Scottish/Celtic — Shrek's princess, fair, popular in Scotland, soft and friendly"},
    # ── Girls: Virtue / nature ────────────────────────────────────────────
    {"name": "Verity",     "sex": "F", "context": "virtue name, British — truth, rare in US, quietly rising, literary and grounded"},
    {"name": "Constance",  "sex": "F", "context": "virtue name — steadfast, medieval and Puritan, coming back in literary circles"},
    {"name": "Mercy",      "sex": "F", "context": "Puritan virtue — rare and striking, Mercy Warren, old New England feel"},
    {"name": "Fern",       "sex": "F", "context": "nature, Charlotte's Web — short and quiet, green and earthy, gentle comeback"},
    {"name": "Marigold",   "sex": "F", "context": "flower name — sunny and bold, British more than American, Downton Abbey"},
    {"name": "Dahlia",     "sex": "F", "context": "dark flower — Black Dahlia associations, dramatic and gothic-tinged, unusual"},
    # ── Boys: Modern popular ──────────────────────────────────────────────
    {"name": "Liam",       "sex": "M", "context": "Irish short form of William — #1 US name for years, friendly and strong"},
    {"name": "Lucas",      "sex": "M", "context": "Latin, light — modern and friendly, rising fast, Star Wars (Lucas)"},
    {"name": "Mason",      "sex": "M", "context": "occupational surname — mason/stoneworker, modern, Kardashian association, sporty"},
    {"name": "Logan",      "sex": "M", "context": "Scottish surname — Logan/Wolverine, rugged and modern, unisex but mostly male"},
    {"name": "Aiden",      "sex": "M", "context": "Irish origin, very popular — little fire, one of the most popular of the 2000s"},
    {"name": "Owen",       "sex": "M", "context": "Welsh/Celtic — young warrior, Owen Wilson, friendly and unpretentious"},
    {"name": "Gabriel",    "sex": "M", "context": "Biblical archangel — God is my strength, long and melodic, romantic feel"},
    {"name": "Elias",      "sex": "M", "context": "Greek form of Elijah — European feel, rising, softer than Elijah, literary"},
    {"name": "Nolan",      "sex": "M", "context": "Irish surname — Christopher Nolan, modern and cool, solid and unfussy"},
    {"name": "Carter",     "sex": "M", "context": "occupational surname — president Carter, preppy and modern, strong comeback"},
    {"name": "Eli",        "sex": "M", "context": "short Biblical — Eli Manning, simple and grounded, popular nickname-name"},
    {"name": "Lincoln",    "sex": "M", "context": "presidential surname — Lincoln Center, serious and strong, modern comeback"},
    # ── Boys: Classic British / royal ─────────────────────────────────────
    {"name": "George",     "sex": "M", "context": "royal classic — King George, George Washington, patron saint of England, solid"},
    {"name": "William",    "sex": "M", "context": "royal evergreen — Shakespeare, Prince William, most enduring classic name"},
    {"name": "James",      "sex": "M", "context": "royal, biblical — James Bond, King James, the most versatile classic"},
    {"name": "Henry",      "sex": "M", "context": "royal, comeback — Henry V, Prince Henry/Harry, warm and distinguished"},
    {"name": "Edward",     "sex": "M", "context": "royal, literary — Edward Rochester, Twilight, formal and timeless"},
    {"name": "Albert",     "sex": "M", "context": "Victorian royal — Prince Albert, Einstein, stolidly vintage, quietly resurgent"},
    {"name": "Arthur",     "sex": "M", "context": "Arthurian legend — chivalric and ancient, rising sharply, royal (Prince Arthur)"},
    {"name": "Frederick",  "sex": "M", "context": "Victorian formal — Freddie for short, serious and distinguished, European feel"},
    {"name": "Alfred",     "sex": "M", "context": "Old English king — Alfred the Great, Batman's butler, deliberately old-fashioned"},
    {"name": "Leonard",    "sex": "M", "context": "vintage — Leonard Cohen, Leo for short, soft vintage comeback"},
    {"name": "Harvey",     "sex": "M", "context": "vintage American — Harvey Milk, Harvey Weinstein shadow, English surname feel"},
    # ── Boys: Irish / Celtic ──────────────────────────────────────────────
    {"name": "Declan",     "sex": "M", "context": "Irish saint — Declan of Ardmore, rising in US, strong and distinctly Irish"},
    {"name": "Kieran",     "sex": "M", "context": "Irish/Scottish — little dark one, rising steadily, accessible Irish name"},
    {"name": "Cormac",     "sex": "M", "context": "Irish — Cormac McCarthy, ancient king, strong and literary, underused"},
    {"name": "Fergus",     "sex": "M", "context": "Scottish/Irish — vigorous man, Brave (Disney), rugged and ancient"},
    {"name": "Duncan",     "sex": "M", "context": "Scottish — King Duncan (Macbeth), dark warrior, distinguished and rare"},
    {"name": "Callum",     "sex": "M", "context": "Scottish Gaelic — dove, popular in Scotland/UK, rising in US, clean"},
    # ── Boys: Arabic / Middle Eastern ─────────────────────────────────────
    {"name": "Omar",       "sex": "M", "context": "Arabic — flourishing, Omar Sharif, Omar Little (The Wire), dignified and strong"},
    {"name": "Yusuf",      "sex": "M", "context": "Arabic form of Joseph — very common globally, lyrical and grounded"},
    {"name": "Ibrahim",    "sex": "M", "context": "Arabic form of Abraham — patriarch, very common in Muslim world, weighty"},
    {"name": "Khalid",     "sex": "M", "context": "Arabic, eternal — Khalid ibn al-Walid, the singer Khalid, strong and classic"},
    {"name": "Hamza",      "sex": "M", "context": "Arabic — strong, lion, the Prophet's uncle, rising in the West"},
    {"name": "Idris",      "sex": "M", "context": "Arabic/Welsh — Idris Elba, prophet name, both Islamic and Celtic, cool and rare"},
    # ── Boys: Spanish / Latinx ────────────────────────────────────────────
    {"name": "Diego",      "sex": "M", "context": "Spanish form of James — Diego Rivera, warm and bold, rising fast in US"},
    {"name": "Carlos",     "sex": "M", "context": "Spanish form of Charles — widely used, warm and familiar across Latin America"},
    {"name": "Santiago",   "sex": "M", "context": "Spanish — Saint James, the city, long and romantic, rising in US"},
    {"name": "Alejandro",  "sex": "M", "context": "Spanish form of Alexander — Lady Gaga song, romantic and grand, very popular"},
    {"name": "Emilio",     "sex": "M", "context": "Spanish/Italian — Emilio Estevez, warm and flowing, Latinx with European feel"},
    # ── Boys: Scandinavian / Norse ────────────────────────────────────────
    {"name": "Erik",       "sex": "M", "context": "Norse — Erik the Red, classic Scandinavian, strong and simple"},
    {"name": "Axel",       "sex": "M", "context": "Scandinavian — Guns N' Roses, modern and sharp, rising in US"},
    {"name": "Lars",       "sex": "M", "context": "Scandinavian — Lars von Trier, Metallica, simple and unfussy Nordic"},
    {"name": "Gunnar",     "sex": "M", "context": "Norse — warrior name, very uncommon in US, distinctly Viking"},
    # ── Boys: Greek / Latin ───────────────────────────────────────────────
    {"name": "Atlas",      "sex": "M", "context": "Greek titan — holding up the world, bold and modern, rising celebrity baby name"},
    {"name": "Orion",      "sex": "M", "context": "Greek hunter constellation — mythological and astronomical, adventurous and rare"},
    {"name": "Cassius",    "sex": "M", "context": "Roman — Cassius Clay/Muhammad Ali, Julius Caesar, bold and ancient"},
    {"name": "Augustus",   "sex": "M", "context": "Roman emperor — grand and formal, Gus for short, literary (The Fault in Our Stars)"},
    {"name": "Leo",        "sex": "M", "context": "Latin, lion — short and punchy, papal name, rising globally, warm and bright"},
    # ── Boys: Vintage American ────────────────────────────────────────────
    {"name": "Earl",       "sex": "M", "context": "old-fashioned American — title name, peak early 20th century, very retro"},
    {"name": "Glenn",      "sex": "M", "context": "Scottish/American — Glenn Miller, Glenn Close (female), quietly old-fashioned"},
    {"name": "Roy",        "sex": "M", "context": "old-fashioned American — Roy Rogers, peak mid-20th century, short and rugged"},
    {"name": "Eugene",     "sex": "M", "context": "vintage American — Eugene O'Neill, peak 1920s, Gene for short, deliberately retro"},
    # ── Boys: Modern / surname style ─────────────────────────────────────
    {"name": "Beckett",    "sex": "M", "context": "literary surname — Samuel Beckett, Waiting for Godot, modern and preppy"},
    {"name": "Griffin",    "sex": "M", "context": "Welsh/mythological — the beast, strong and unusual, surname style, rising"},
    {"name": "Kai",        "sex": "M", "context": "short, modern, multicultural — means sea in Hawaiian, earth in Scandinavian, very popular"},
    {"name": "Zane",       "sex": "M", "context": "modern American — Zane Grey (author), Zayn Malik, sharp and cool"},
    {"name": "Beau",       "sex": "M", "context": "French, handsome — Southern American, Beau Bridges, friendly and charming"},
    {"name": "Reid",       "sex": "M", "context": "Scottish surname — Harry Reid, short and sharp, quiet and professional"},
]

BATCH_SIZE = 17  # anchors per Claude API call


def load_name_set() -> set[str]:
    names = set()
    with open(VECTORS_PATH) as f:
        for row in csv.DictReader(f):
            names.add(row['name'])
    return names


def build_prompt(cases: list[dict]) -> str:
    cases_text = ""
    for tc in cases:
        cases_text += f"\nName: {tc['name']}\nSex: {tc['sex']}\nVibe: {tc['context']}\n"

    return f"""You are building a baby name recommendation training dataset.

For each name below, return two lists:
1. **gold** — 25 names a parent who loves this name would genuinely also consider. Think vibe, style, cultural feel, and era — NOT sound similarity. "Noah" for "Liam" = excellent. "Niam" for "Liam" = terrible.
2. **trap** — 8 names that sound similar but have the wrong vibe (the kind a bad recommendation system returns).

Rules:
- Gold names should feel like they belong together in a real parent's shortlist.
- Trap names must be phonetically plausible near-neighbors that a parent who loves the anchor name would NOT want.
- Respect sex: F → girl names, M → boy names.
- Cover the full range of the vibe — don't just pick the most popular names.
- No made-up names. Real names only.

{cases_text}

Respond with a JSON object keyed by name. Each value has "gold" (array of 25 strings) and "trap" (array of 8 strings).
Return only the JSON, no other text."""


def validate(training: dict, name_set: set[str]) -> None:
    print("\nValidation (names not in name_vectors.csv):")
    any_missing = False
    for name, data in training.items():
        for key in ("gold", "trap"):
            missing = [n for n in data[key] if n not in name_set]
            if missing:
                print(f"  {name} {key}: {missing}")
                any_missing = True
    if not any_missing:
        print("  All suggested names are in the vector set.")


def call_claude(client: anthropic.Anthropic, cases: list[dict]) -> dict:
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=5000,
        messages=[{"role": "user", "content": build_prompt(cases)}],
    )
    text = message.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text)


def main() -> None:
    # Sanity check — ensure no training anchor overlaps with oracle
    names_in_training = {tc["name"] for tc in TRAINING_CASES}
    overlap = names_in_training & ORACLE_ANCHORS
    if overlap:
        raise ValueError(f"Training anchors overlap with oracle anchors: {overlap}")

    # Deduplicate TRAINING_CASES (keeps first occurrence)
    seen: set[str] = set()
    deduped_cases = []
    for tc in TRAINING_CASES:
        if tc["name"] not in seen:
            seen.add(tc["name"])
            deduped_cases.append(tc)

    print(f"Loading name set from {VECTORS_PATH}...")
    name_set = load_name_set()
    print(f"Loaded {len(name_set):,} names")

    # Load existing training oracle to skip already-generated anchors
    training: dict = {}
    if os.path.exists(OUTPUT_PATH):
        with open(OUTPUT_PATH) as f:
            training = json.load(f)
        print(f"Loaded {len(training)} existing anchor sets from {OUTPUT_PATH}")

    pending = [tc for tc in deduped_cases if tc["name"] not in training]
    print(f"{len(pending)} new anchors to generate (skipping {len(deduped_cases) - len(pending)} existing)\n")

    if not pending:
        print("All anchors already generated.")
        validate(training, name_set)
        return

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    client = anthropic.Anthropic(api_key=api_key)

    context_by_name = {tc["name"]: tc["context"] for tc in deduped_cases}
    sex_by_name = {tc["name"]: tc["sex"] for tc in deduped_cases}

    for i in range(0, len(pending), BATCH_SIZE):
        batch = pending[i:i + BATCH_SIZE]
        batch_names = [tc["name"] for tc in batch]
        print(f"Batch {i // BATCH_SIZE + 1}/{(len(pending) + BATCH_SIZE - 1) // BATCH_SIZE}: "
              f"{', '.join(batch_names)}")
        result = call_claude(client, batch)
        for name, data in result.items():
            data["context"] = context_by_name.get(name, "")
            data["sex"] = sex_by_name.get(name, "U")
            training[name] = data
        # Save after each batch so progress isn't lost on failure
        with open(OUTPUT_PATH, "w") as f:
            json.dump(training, f, indent=2)
        print(f"  Got {len(result)} anchor sets (total: {len(training)})\n")

    validate(training, name_set)

    print(f"\nSaved {len(training)} training anchor sets to {OUTPUT_PATH}")
    sizes = [(n, len(d["gold"]), len(d["trap"])) for n, d in training.items()]
    incomplete = [(n, g, t) for n, g, t in sizes if g < 25 or t < 8]
    if incomplete:
        print(f"\nWarning — incomplete sets (re-run to regenerate):")
        for n, g, t in incomplete:
            print(f"  {n}: {g} gold, {t} trap")


if __name__ == "__main__":
    main()
