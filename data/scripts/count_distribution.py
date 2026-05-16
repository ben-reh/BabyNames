"""
Analyze the 2024 SSA name count distribution to find a sensible minimum
floor for the name_vectors table. Also shows where specific rare names land.
"""
import os
import csv
from collections import defaultdict

SSA_DIR = os.path.join(os.path.dirname(__file__), '../raw/ssa')
YEAR = 2024
TARGET_NAMES = {'Melrose', 'Rue', 'Ellsworth', 'Dawn', 'Wren', 'Clover', 'Cove'}

# Load the target year
counts: dict[str, int] = defaultdict(int)
path = os.path.join(SSA_DIR, f'yob{YEAR}.txt')
with open(path) as f:
    for name, gender, count in csv.reader(f):
        counts[name] += int(count)  # sum M+F for cross-gender names

all_counts = sorted(counts.values(), reverse=True)
total = len(all_counts)

print(f"\n=== {YEAR} SSA name count distribution ({total:,} unique names) ===\n")

# Percentile table
percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99]
print("Percentile  Min count to be in top X%")
print("-" * 40)
for p in percentiles:
    idx = int(total * p / 100)
    print(f"  Top {p:2d}%     >= {all_counts[idx - 1]:,}")

print()

# Count bucket distribution
buckets = [
    (10000, float('inf'), '10,000+'),
    (5000, 9999,          '5,000–9,999'),
    (1000, 4999,          '1,000–4,999'),
    (500,  999,           '500–999'),
    (200,  499,           '200–499'),
    (100,  199,           '100–199'),
    (50,   99,            '50–99'),
    (25,   49,            '25–49'),
    (5,    24,            '5–24'),
    (1,    4,             '1–4'),
]
print("Count range       Names    Cumulative (from top)")
print("-" * 50)
cumulative = 0
for lo, hi, label in buckets:
    n = sum(1 for c in all_counts if lo <= c <= hi)
    cumulative += n
    print(f"  {label:<16}  {n:5,}    {cumulative:5,}  ({100*cumulative/total:.1f}%)")

print()

# Where do our target rare names land?
print("=== Target rare names in 2024 ===\n")
ranked = sorted(counts.items(), key=lambda x: -x[1])
rank_map = {name: rank + 1 for rank, (name, _) in enumerate(ranked)}

print(f"{'Name':<12}  {'Count':>6}  {'Rank':>6}  {'Top %':>7}")
print("-" * 40)
for name in sorted(TARGET_NAMES):
    if name in counts:
        c = counts[name]
        r = rank_map[name]
        print(f"  {name:<12}  {c:6,}  {r:6,}  {100*r/total:6.1f}%")
    else:
        print(f"  {name:<12}  not in {YEAR} data")

# Show current top-15k cutoff
print(f"\n=== Current top-15,000 cutoff ===")
if total >= 15000:
    print(f"  Min count to be in top 15,000: {all_counts[14999]:,}")
else:
    print(f"  Only {total:,} names in {YEAR} — all would be included")
