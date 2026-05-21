"""
Seed dev test profiles — creates DynamoDB lists, seeds liked names into them,
seeds swipe history into RDS, then writes app/src/dev/devProfiles.ts so the
in-app switcher knows each profile's listId.

Usage:
    python3.12 data/scripts/seed_dev_profiles.py                   # seed all profiles
    python3.12 data/scripts/seed_dev_profiles.py --profiles classic mixed
    python3.12 data/scripts/seed_dev_profiles.py --dry-run         # print without calling API

Re-seeding is idempotent:
  - List IDs are persisted in data/processed/dev_profile_lists.json so existing
    lists are reused on subsequent runs.
  - Swipes use ON CONFLICT DO UPDATE; list name additions skip duplicates.

Profiles:
  dev-cold-start  0 swipes — cold start path
  dev-light       5 F likes — single taste-vector path (1-7 swipes)
  dev-classic     10F+10M likes + passes — coherent vintage taste, 2 off-persona per sex
  dev-modern      10F+10M likes + passes — trendy/nature taste, 2 off-persona per sex
  dev-unique      10F+10M likes + passes — rare/literary taste, 1 common off-persona per sex
  dev-mixed       10F+10M likes + passes — split classic+modern clusters (exercises k-means k=2)
"""

import argparse
import json
import os
import sys
import time
import requests

API_BASE = "https://2e5o06c9e6.execute-api.us-east-1.amazonaws.com/prod"

REPO_ROOT   = os.path.join(os.path.dirname(__file__), "..", "..")
LISTS_STATE = os.path.join(REPO_ROOT, "data", "processed", "dev_profile_lists.json")
APP_PROFILES_OUT = os.path.join(REPO_ROOT, "app", "src", "dev", "devProfiles.ts")

PROFILES: dict[str, dict] = {
    "dev-cold-start": {
        "label": "Cold Start",
        "description": "No swipe history",
        "swipeSummary": "0 swipes",
        "swipes": [],
    },
    "dev-light": {
        "label": "Light User",
        "description": "5 F likes — single taste vector",
        "swipeSummary": "5 swipes",
        "swipes": [
            {"name": "Emma",     "liked": True,  "sex_context": "F"},
            {"name": "Olivia",   "liked": True,  "sex_context": "F"},
            {"name": "Sophia",   "liked": True,  "sex_context": "F"},
            {"name": "Ava",      "liked": True,  "sex_context": "F"},
            {"name": "Isabella", "liked": True,  "sex_context": "F"},
        ],
    },
    "dev-classic": {
        "label": "Classic",
        "description": "Vintage/traditional taste, 2 modern off-persona per sex",
        "swipeSummary": "10 likes + 5 passes × 2 sexes",
        "swipes": [
            # F likes — traditional/vintage (8 core + 2 modern off-persona)
            {"name": "Charlotte", "liked": True,  "sex_context": "F"},
            {"name": "Eleanor",   "liked": True,  "sex_context": "F"},
            {"name": "Margaret",  "liked": True,  "sex_context": "F"},
            {"name": "Rose",      "liked": True,  "sex_context": "F"},
            {"name": "Beatrice",  "liked": True,  "sex_context": "F"},
            {"name": "Catherine", "liked": True,  "sex_context": "F"},
            {"name": "Victoria",  "liked": True,  "sex_context": "F"},
            {"name": "Cecily",    "liked": True,  "sex_context": "F"},
            {"name": "Luna",      "liked": True,  "sex_context": "F"},   # off-persona
            {"name": "Aria",      "liked": True,  "sex_context": "F"},   # off-persona
            # F passes
            {"name": "Destiny",   "liked": False, "sex_context": "F"},
            {"name": "Kylie",     "liked": False, "sex_context": "F"},
            {"name": "Nevaeh",    "liked": False, "sex_context": "F"},
            {"name": "Madison",   "liked": False, "sex_context": "F"},
            {"name": "Paisley",   "liked": False, "sex_context": "F"},
            # M likes — traditional/vintage (8 core + 2 modern off-persona)
            {"name": "Henry",     "liked": True,  "sex_context": "M"},
            {"name": "Arthur",    "liked": True,  "sex_context": "M"},
            {"name": "William",   "liked": True,  "sex_context": "M"},
            {"name": "Edmund",    "liked": True,  "sex_context": "M"},
            {"name": "Theodore",  "liked": True,  "sex_context": "M"},
            {"name": "Frederick", "liked": True,  "sex_context": "M"},
            {"name": "Alistair",  "liked": True,  "sex_context": "M"},
            {"name": "Rupert",    "liked": True,  "sex_context": "M"},
            {"name": "River",     "liked": True,  "sex_context": "M"},   # off-persona
            {"name": "Zephyr",    "liked": True,  "sex_context": "M"},   # off-persona
            # M passes
            {"name": "Brayden",   "liked": False, "sex_context": "M"},
            {"name": "Jayden",    "liked": False, "sex_context": "M"},
            {"name": "Hunter",    "liked": False, "sex_context": "M"},
            {"name": "Grayson",   "liked": False, "sex_context": "M"},
            {"name": "Caden",     "liked": False, "sex_context": "M"},
        ],
    },
    "dev-modern": {
        "label": "Modern",
        "description": "Trendy/nature taste, 2 vintage off-persona per sex",
        "swipeSummary": "10 likes + 5 passes × 2 sexes",
        "swipes": [
            # F likes — trendy/nature/celestial (8 core + 2 vintage off-persona)
            {"name": "Luna",     "liked": True,  "sex_context": "F"},
            {"name": "Nova",     "liked": True,  "sex_context": "F"},
            {"name": "Aria",     "liked": True,  "sex_context": "F"},
            {"name": "Isla",     "liked": True,  "sex_context": "F"},
            {"name": "Freya",    "liked": True,  "sex_context": "F"},
            {"name": "Willow",   "liked": True,  "sex_context": "F"},
            {"name": "Aurora",   "liked": True,  "sex_context": "F"},
            {"name": "Stella",   "liked": True,  "sex_context": "F"},
            {"name": "Eleanor",  "liked": True,  "sex_context": "F"},   # off-persona
            {"name": "Rose",     "liked": True,  "sex_context": "F"},   # off-persona
            # F passes
            {"name": "Gertrude", "liked": False, "sex_context": "F"},
            {"name": "Mildred",  "liked": False, "sex_context": "F"},
            {"name": "Bertha",   "liked": False, "sex_context": "F"},
            {"name": "Edna",     "liked": False, "sex_context": "F"},
            {"name": "Ethel",    "liked": False, "sex_context": "F"},
            # M likes — trendy/short/nature (8 core + 2 classic off-persona)
            {"name": "Kai",      "liked": True,  "sex_context": "M"},
            {"name": "River",    "liked": True,  "sex_context": "M"},
            {"name": "Zephyr",   "liked": True,  "sex_context": "M"},
            {"name": "Rowan",    "liked": True,  "sex_context": "M"},
            {"name": "Phoenix",  "liked": True,  "sex_context": "M"},
            {"name": "Axel",     "liked": True,  "sex_context": "M"},
            {"name": "Orion",    "liked": True,  "sex_context": "M"},
            {"name": "Finn",     "liked": True,  "sex_context": "M"},
            {"name": "Arthur",   "liked": True,  "sex_context": "M"},   # off-persona
            {"name": "Edmund",   "liked": True,  "sex_context": "M"},   # off-persona
            # M passes
            {"name": "Eugene",   "liked": False, "sex_context": "M"},
            {"name": "Clarence", "liked": False, "sex_context": "M"},
            {"name": "Herbert",  "liked": False, "sex_context": "M"},
            {"name": "Reginald", "liked": False, "sex_context": "M"},
            {"name": "Lionel",   "liked": False, "sex_context": "M"},
        ],
    },
    "dev-unique": {
        "label": "Unique",
        "description": "Rare/literary taste, 1 common name off-persona per sex",
        "swipeSummary": "10 likes + 5 passes × 2 sexes",
        "swipes": [
            # F likes — rare/literary (9 core + 1 common off-persona)
            {"name": "Isolde",   "liked": True,  "sex_context": "F"},
            {"name": "Imogen",   "liked": True,  "sex_context": "F"},
            {"name": "Calliope", "liked": True,  "sex_context": "F"},
            {"name": "Wren",     "liked": True,  "sex_context": "F"},
            {"name": "Lyra",     "liked": True,  "sex_context": "F"},
            {"name": "Ophelia",  "liked": True,  "sex_context": "F"},
            {"name": "Cordelia", "liked": True,  "sex_context": "F"},
            {"name": "Octavia",  "liked": True,  "sex_context": "F"},
            {"name": "Arabella", "liked": True,  "sex_context": "F"},
            {"name": "Emma",     "liked": True,  "sex_context": "F"},   # off-persona
            # F passes
            {"name": "Olivia",   "liked": False, "sex_context": "F"},
            {"name": "Sophia",   "liked": False, "sex_context": "F"},
            {"name": "Madison",  "liked": False, "sex_context": "F"},
            {"name": "Addison",  "liked": False, "sex_context": "F"},
            {"name": "Paisley",  "liked": False, "sex_context": "F"},
            # M likes — rare/literary (9 core + 1 common off-persona)
            {"name": "Thaddeus",    "liked": True,  "sex_context": "M"},
            {"name": "Leander",     "liked": True,  "sex_context": "M"},
            {"name": "Percival",    "liked": True,  "sex_context": "M"},
            {"name": "Lysander",    "liked": True,  "sex_context": "M"},
            {"name": "Alaric",      "liked": True,  "sex_context": "M"},
            {"name": "Bartholomew", "liked": True,  "sex_context": "M"},
            {"name": "Benedict",    "liked": True,  "sex_context": "M"},
            {"name": "Alistair",    "liked": True,  "sex_context": "M"},
            {"name": "Evander",     "liked": True,  "sex_context": "M"},
            {"name": "Ezra",        "liked": True,  "sex_context": "M"},   # off-persona
            # M passes
            {"name": "Noah",   "liked": False, "sex_context": "M"},
            {"name": "Mason",  "liked": False, "sex_context": "M"},
            {"name": "Logan",  "liked": False, "sex_context": "M"},
            {"name": "Ethan",  "liked": False, "sex_context": "M"},
            {"name": "Tyler",  "liked": False, "sex_context": "M"},
        ],
    },
    "dev-mixed": {
        "label": "Mixed",
        "description": "Classic + modern split — exercises k-means k=2 path",
        "swipeSummary": "10 likes + 5 passes × 2 sexes",
        "swipes": [
            # F likes — split classic (4) + modern (5) + unique outlier (1)
            {"name": "Charlotte", "liked": True,  "sex_context": "F"},
            {"name": "Eleanor",   "liked": True,  "sex_context": "F"},
            {"name": "Beatrice",  "liked": True,  "sex_context": "F"},
            {"name": "Rose",      "liked": True,  "sex_context": "F"},
            {"name": "Luna",      "liked": True,  "sex_context": "F"},
            {"name": "Nova",      "liked": True,  "sex_context": "F"},
            {"name": "Aria",      "liked": True,  "sex_context": "F"},
            {"name": "Willow",    "liked": True,  "sex_context": "F"},
            {"name": "Stella",    "liked": True,  "sex_context": "F"},
            {"name": "Imogen",    "liked": True,  "sex_context": "F"},   # unique outlier
            # F passes
            {"name": "Destiny",   "liked": False, "sex_context": "F"},
            {"name": "Madison",   "liked": False, "sex_context": "F"},
            {"name": "Gertrude",  "liked": False, "sex_context": "F"},
            {"name": "Ethel",     "liked": False, "sex_context": "F"},
            {"name": "Nevaeh",    "liked": False, "sex_context": "F"},
            # M likes — split classic (4) + modern (5) + unique outlier (1)
            {"name": "Henry",   "liked": True,  "sex_context": "M"},
            {"name": "Arthur",  "liked": True,  "sex_context": "M"},
            {"name": "William", "liked": True,  "sex_context": "M"},
            {"name": "Edmund",  "liked": True,  "sex_context": "M"},
            {"name": "Kai",     "liked": True,  "sex_context": "M"},
            {"name": "River",   "liked": True,  "sex_context": "M"},
            {"name": "Zephyr",  "liked": True,  "sex_context": "M"},
            {"name": "Phoenix", "liked": True,  "sex_context": "M"},
            {"name": "Orion",   "liked": True,  "sex_context": "M"},
            {"name": "Leander", "liked": True,  "sex_context": "M"},   # unique outlier
            # M passes
            {"name": "Brayden",  "liked": False, "sex_context": "M"},
            {"name": "Jayden",   "liked": False, "sex_context": "M"},
            {"name": "Eugene",   "liked": False, "sex_context": "M"},
            {"name": "Clarence", "liked": False, "sex_context": "M"},
            {"name": "Hunter",   "liked": False, "sex_context": "M"},
        ],
    },
}


def api_post(path: str, payload: dict) -> dict | None:
    try:
        resp = requests.post(f"{API_BASE}{path}", json=payload, timeout=10)
        if resp.status_code not in (200, 201):
            print(f"  ERROR {resp.status_code} POST {path}: {resp.text}", file=sys.stderr)
            return None
        return resp.json()
    except Exception as e:
        print(f"  ERROR POST {path}: {e}", file=sys.stderr)
        return None


def ensure_list(device_id: str, existing_list_id: str | None, dry_run: bool) -> str | None:
    if existing_list_id:
        print(f"  reusing list {existing_list_id}")
        return existing_list_id
    if dry_run:
        print(f"  [dry-run] POST /lists {{deviceId: {device_id}}}")
        return "dry-run-list-id"
    result = api_post("/lists", {"deviceId": device_id})
    if not result:
        return None
    list_id = result["listId"]
    print(f"  created list {list_id}")
    return list_id


def add_name_to_list(list_id: str, device_id: str, name: str, dry_run: bool) -> bool:
    if dry_run:
        print(f"  [dry-run] POST /lists/{list_id}/names {{name: {name}}}")
        return True
    result = api_post(f"/lists/{list_id}/names", {"deviceId": device_id, "name": name})
    return result is not None


def post_swipe(device_id: str, swipe: dict, dry_run: bool) -> bool:
    if dry_run:
        print(f"  [dry-run] POST /swipe {swipe['name']} liked={swipe['liked']}")
        return True
    try:
        resp = requests.post(f"{API_BASE}/swipe", json={"deviceId": device_id, **swipe}, timeout=10)
        if resp.status_code != 200:
            print(f"  ERROR {resp.status_code} swipe {swipe['name']}: {resp.text}", file=sys.stderr)
            return False
        return True
    except Exception as e:
        print(f"  ERROR swipe {swipe['name']}: {e}", file=sys.stderr)
        return False


def seed_profile(key: str, profile: dict, list_id: str | None, dry_run: bool) -> str | None:
    label = profile["label"]
    swipes = profile["swipes"]
    liked_names = [s["name"] for s in swipes if s["liked"]]

    print(f"\n{'[dry-run] ' if dry_run else ''}Seeding {label} ({key})")

    # 1. Ensure DynamoDB list exists
    list_id = ensure_list(key, list_id, dry_run)
    if not list_id:
        print("  SKIPPED — could not create list", file=sys.stderr)
        return None

    # 2. Add liked names to the list
    if liked_names:
        print(f"  adding {len(liked_names)} liked names to list...")
        ok = err = 0
        for name in liked_names:
            success = add_name_to_list(list_id, key, name, dry_run)
            if success:
                ok += 1
            else:
                err += 1
            if not dry_run:
                time.sleep(0.05)
        print(f"  list names: {ok} ok, {err} errors")
    else:
        print("  (no liked names — cold start profile)")

    # 3. Seed swipes into RDS
    if swipes:
        print(f"  seeding {len(swipes)} swipes...")
        ok = err = 0
        for swipe in swipes:
            success = post_swipe(key, swipe, dry_run)
            if success:
                ok += 1
            else:
                err += 1
            if not dry_run:
                time.sleep(0.05)
        print(f"  swipes: {ok} ok, {err} errors")

    return list_id


def write_app_profiles(list_ids: dict[str, str | None]) -> None:
    os.makedirs(os.path.dirname(APP_PROFILES_OUT), exist_ok=True)
    lines = [
        "// Generated by data/scripts/seed_dev_profiles.py — do not edit manually.",
        "",
        "export interface DevProfile {",
        "  label: string;",
        "  deviceId: string;",
        "  listId: string | null;",
        "  description: string;",
        "  swipeSummary: string;",
        "}",
        "",
        "export const DEV_PROFILES: DevProfile[] = [",
    ]
    for key, profile in PROFILES.items():
        list_id = list_ids.get(key)
        list_id_ts = f'"{list_id}"' if list_id else "null"
        lines += [
            "  {",
            f'    label: "{profile["label"]}",',
            f'    deviceId: "{key}",',
            f'    listId: {list_id_ts},',
            f'    description: "{profile["description"]}",',
            f'    swipeSummary: "{profile["swipeSummary"]}",',
            "  },",
        ]
    lines += ["];", ""]
    with open(APP_PROFILES_OUT, "w") as f:
        f.write("\n".join(lines))
    print(f"\nWrote {APP_PROFILES_OUT}")


def load_list_ids() -> dict[str, str]:
    if os.path.exists(LISTS_STATE):
        with open(LISTS_STATE) as f:
            return json.load(f)
    return {}


def save_list_ids(list_ids: dict[str, str | None]) -> None:
    existing = load_list_ids()
    existing.update({k: v for k, v in list_ids.items() if v})
    with open(LISTS_STATE, "w") as f:
        json.dump(existing, f, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--profiles", nargs="*",
        choices=list(PROFILES.keys()) + [k.replace("dev-", "") for k in PROFILES],
        help="profiles to seed (default: all)",
    )
    parser.add_argument("--dry-run", action="store_true", help="print actions without calling API")
    args = parser.parse_args()

    if args.profiles:
        keys = [f"dev-{p}" if not p.startswith("dev-") else p for p in args.profiles]
    else:
        keys = list(PROFILES.keys())

    print(f"Seeding {len(keys)} profile(s) against {API_BASE}")

    existing_list_ids = load_list_ids()
    new_list_ids: dict[str, str | None] = {}

    for key in keys:
        list_id = seed_profile(key, PROFILES[key], existing_list_ids.get(key), args.dry_run)
        new_list_ids[key] = list_id

    if not args.dry_run:
        save_list_ids(new_list_ids)
        all_list_ids = {**existing_list_ids, **{k: v for k, v in new_list_ids.items() if v}}
        write_app_profiles(all_list_ids)

    print("\nDone.")


if __name__ == "__main__":
    main()
