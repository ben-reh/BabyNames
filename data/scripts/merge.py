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

# Columns to carry forward from the dxdc dataset
DXDC_COLUMNS = [
    'name',
    'spelling_variants',
    'unisex_dominant',   # M or F
    'total_count',
    'rank',
    'year_min',
    'year_max',
    'year_peak',
]

OUT_COLUMNS = DXDC_COLUMNS + ['origin', 'etymology_raw']


def load_origins():
    path = os.path.join(RAW_DIR, 'origins.csv')
    with open(path) as f:
        return {row['name']: row for row in csv.DictReader(f)}


def merge():
    os.makedirs(PROCESSED_DIR, exist_ok=True)
    origins = load_origins()

    names_path = os.path.join(RAW_DIR, 'all-names.csv')
    output_path = os.path.join(PROCESSED_DIR, 'names.csv')

    total = matched = 0
    with open(names_path) as infile, open(output_path, 'w', newline='') as outfile:
        reader = csv.DictReader(infile)
        writer = csv.DictWriter(outfile, fieldnames=OUT_COLUMNS)
        writer.writeheader()

        for row in reader:
            total += 1
            name = row['name']
            origin_data = origins.get(name, {'origin': '', 'etymology_raw': ''})
            if origin_data['origin']:
                matched += 1

            out_row = {col: row.get(col, '') for col in DXDC_COLUMNS}
            out_row['origin'] = origin_data['origin']
            out_row['etymology_raw'] = origin_data['etymology_raw']
            writer.writerow(out_row)

    print(f"Merged {total} names — {matched} with origin ({100 * matched // total if total else 0}%)")
    print(f"Saved to {output_path}")


if __name__ == '__main__':
    merge()
