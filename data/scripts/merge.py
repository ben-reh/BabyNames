"""
Merges dxdc name data with Wiktionary-derived origins into the final dataset.
Reads raw/all-names.csv + raw/origins.csv, writes processed/names.csv.
Run after parse_origins.py.
"""
import csv
import os

SCRIPTS_DIR = os.path.dirname(__file__)
RAW_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw')
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')

SOURCE_COLUMNS = ['name', 'spelling_variants', 'sex', 'total_count', 'year_min', 'year_max', 'year_peak']
OUT_COLUMNS = SOURCE_COLUMNS + ['rank', 'origin', 'etymology_raw']


def load_origins():
    path = os.path.join(RAW_DIR, 'origins.csv')
    with open(path) as f:
        return {row['name']: row for row in csv.DictReader(f)}


def merge():
    os.makedirs(PROCESSED_DIR, exist_ok=True)
    origins = load_origins()

    names_path = os.path.join(RAW_DIR, 'all-names.csv')
    output_path = os.path.join(PROCESSED_DIR, 'names.csv')

    # Read all rows, deduplicate by name keeping highest total_count, then rank
    with open(names_path) as infile:
        raw_rows = list(csv.DictReader(infile))
    seen = {}
    for r in raw_rows:
        name = r['name']
        if name not in seen or int(r.get('total_count') or 0) > int(seen[name].get('total_count') or 0):
            seen[name] = r
    all_rows = sorted(seen.values(), key=lambda r: int(r.get('total_count') or 0), reverse=True)

    total = matched = 0
    with open(output_path, 'w', newline='') as outfile:
        writer = csv.DictWriter(outfile, fieldnames=OUT_COLUMNS)
        writer.writeheader()

        for rank, row in enumerate(all_rows, start=1):
            total += 1
            name = row['name']
            origin_data = origins.get(name, {'origin': '', 'etymology_raw': ''})
            if origin_data['origin']:
                matched += 1

            out_row = {col: row.get(col, '') for col in SOURCE_COLUMNS}
            out_row['rank'] = rank
            out_row['origin'] = origin_data['origin']
            out_row['etymology_raw'] = origin_data['etymology_raw']
            writer.writerow(out_row)

    print(f"Merged {total} names — {matched} with origin ({100 * matched // total if total else 0}%)")
    print(f"Saved to {output_path}")


if __name__ == '__main__':
    merge()
