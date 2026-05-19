"""
Recomputes name stats directly from SSA data (1880-2025), replacing dxdc's
often-incorrect aggregate fields.

Fixes:
- sex: determined from SSA (dominant gender)
- total_count: sum of all yearly SSA counts for the dominant sex
- year_peak: year with highest count/total_births_that_year (% of births)
- year_min, year_max: first/last SSA year
- rank: recomputed from corrected total_count across all names

Updates processed/names.csv and patches DynamoDB Names table.
Names not found in SSA (550 obscure entries) are left unchanged.
"""
import boto3
import csv
import os
from botocore.exceptions import ClientError
from decimal import Decimal

SCRIPTS_DIR = os.path.dirname(__file__)
SSA_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw', 'ssa')
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')
NAMES_CSV = os.path.join(PROCESSED_DIR, 'names.csv')
TABLE_NAME = 'Names'


def read_ssa():
    """Returns (counts, births_by_year).

    counts: {name: {'M': {year: int}, 'F': {year: int}}}
    births_by_year: {year: int}  — total SSA-registered births that year
    """
    counts = {}
    births_by_year = {}

    for fname in sorted(os.listdir(SSA_DIR)):
        if not (fname.startswith('yob') and fname.endswith('.txt')):
            continue
        year = int(fname[3:7])
        with open(os.path.join(SSA_DIR, fname)) as f:
            for line in f:
                name, sex, count_str = line.strip().split(',')
                n = int(count_str)
                counts.setdefault(name, {'M': {}, 'F': {}})
                counts[name][sex][year] = n
                births_by_year[year] = births_by_year.get(year, 0) + n

    return counts, births_by_year


def compute_stats(name, ssa_counts, births_by_year):
    """Returns dict of computed fields, or None if name not in SSA."""
    if name not in ssa_counts:
        return None

    m_counts = ssa_counts[name]['M']
    f_counts = ssa_counts[name]['F']
    m_total = sum(m_counts.values())
    f_total = sum(f_counts.values())

    # Dominant sex determines which yearly series we use
    sex = 'M' if m_total >= f_total else 'F'
    by_year = m_counts if sex == 'M' else f_counts

    total_count = sum(by_year.values())
    year_min = min(by_year)
    year_max = max(by_year)

    # year_peak: highest percentage of all SSA births that year
    year_peak = max(by_year, key=lambda y: by_year[y] / births_by_year[y])

    return {
        'sex': sex,
        'total_count': total_count,
        'year_min': year_min,
        'year_max': year_max,
        'year_peak': year_peak,
    }


def update_names_csv(new_stats):
    """Rewrites names.csv with corrected fields and recomputed rank."""
    rows = list(csv.DictReader(open(NAMES_CSV)))

    for row in rows:
        stats = new_stats.get(row['name'])
        if stats:
            row['sex'] = stats['sex']
            row['total_count'] = str(stats['total_count'])
            row['year_min'] = str(stats['year_min'])
            row['year_max'] = str(stats['year_max'])
            row['year_peak'] = str(stats['year_peak'])

    # Recompute rank by total_count descending
    rows.sort(key=lambda r: int(r['total_count']) if r['total_count'] else 0, reverse=True)
    for i, row in enumerate(rows, start=1):
        row['rank'] = str(i)

    fieldnames = rows[0].keys()
    with open(NAMES_CSV, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return {row['name']: row['rank'] for row in rows}


def patch_dynamo(new_stats, name_to_rank):
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(TABLE_NAME)

    updated = skipped = errors = 0
    all_names = list(new_stats.keys())

    for i, name in enumerate(all_names):
        stats = new_stats[name]
        rank = name_to_rank.get(name)

        try:
            table.update_item(
                Key={'name': name},
                UpdateExpression=(
                    'SET #sex = :sex, total_count = :tc, '
                    'year_min = :ymin, year_max = :ymax, '
                    'year_peak = :ypeak, #rank = :rank'
                ),
                ExpressionAttributeNames={'#sex': 'sex', '#rank': 'rank', '#n': 'name'},
                ExpressionAttributeValues={
                    ':sex': stats['sex'],
                    ':tc': Decimal(stats['total_count']),
                    ':ymin': Decimal(stats['year_min']),
                    ':ymax': Decimal(stats['year_max']),
                    ':ypeak': Decimal(stats['year_peak']),
                    ':rank': Decimal(rank) if rank else Decimal(0),
                },
                ConditionExpression='attribute_exists(#n)',
            )
            updated += 1
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                skipped += 1
            else:
                print(f'  Error on {name}: {e}')
                errors += 1

        if (i + 1) % 1000 == 0:
            print(f'  {i + 1}/{len(all_names)}  updated={updated}  skipped={skipped}')

    return updated, skipped, errors


def main():
    print('Reading SSA files (1880–2025)...')
    ssa_counts, births_by_year = read_ssa()
    print(f'  {len(ssa_counts):,} unique names  |  {len(births_by_year)} years  |  '
          f'{sum(births_by_year.values()):,} total registered births')

    print('Computing stats...')
    rows = list(csv.DictReader(open(NAMES_CSV)))
    new_stats = {}
    no_ssa = 0
    for row in rows:
        stats = compute_stats(row['name'], ssa_counts, births_by_year)
        if stats:
            new_stats[row['name']] = stats
        else:
            no_ssa += 1
    print(f'  {len(new_stats):,} names updated  |  {no_ssa} names not in SSA (left unchanged)')

    # Spot-check Liam
    if 'Liam' in new_stats:
        s = new_stats['Liam']
        print(f"\n  Liam check: sex={s['sex']}  total={s['total_count']:,}  "
              f"peak={s['year_peak']}  range={s['year_min']}–{s['year_max']}")

    print('\nUpdating names.csv...')
    name_to_rank = update_names_csv(new_stats)
    print(f'  Written. Liam rank: {name_to_rank.get("Liam")}')

    print('\nPatching DynamoDB...')
    updated, skipped, errors = patch_dynamo(new_stats, name_to_rank)
    print(f'\nDone. updated={updated:,}  skipped={skipped}  errors={errors}')


if __name__ == '__main__':
    main()
