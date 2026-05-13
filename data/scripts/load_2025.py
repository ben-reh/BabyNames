"""
Extracts yob2025.txt from data/raw/names.zip and upserts it into RDS.
Run after replacing data/raw/names.zip with the latest SSA download.
"""
import io
import os
import json
import zipfile
import boto3
import psycopg2
import psycopg2.extras

SCRIPTS_DIR = os.path.dirname(__file__)
ZIP_PATH = os.path.join(SCRIPTS_DIR, '..', 'raw', 'names.zip')
SSA_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw', 'ssa')
TARGET_YEAR = 2025

INSERT_SQL = """
INSERT INTO name_popularity (name, year, gender, count)
VALUES %s
ON CONFLICT (name, year, gender) DO UPDATE SET count = EXCLUDED.count;
"""


def get_db_config():
    host = os.environ.get('DB_HOST')
    if host:
        return {
            'host': host,
            'dbname': os.environ.get('DB_NAME', 'babynames'),
            'user': os.environ.get('DB_USER', 'babynames'),
            'password': os.environ.get('DB_PASSWORD'),
            'port': int(os.environ.get('DB_PORT', 5432)),
        }
    secret_id = os.environ.get('DB_SECRET_ARN', 'baby-names/db-credentials')
    print(f"Fetching credentials from Secrets Manager ({secret_id})...")
    client = boto3.client('secretsmanager')
    secret = json.loads(client.get_secret_value(SecretId=secret_id)['SecretString'])
    return {
        'host': secret['host'],
        'dbname': secret.get('dbname', 'babynames'),
        'user': secret['username'],
        'password': secret['password'],
        'port': int(secret.get('port', 5432)),
    }


def main():
    zip_path = os.path.abspath(ZIP_PATH)
    if not os.path.exists(zip_path):
        print(f"ERROR: {zip_path} not found. Download names.zip from https://www.ssa.gov/oact/babynames/limits.html first.")
        return

    target_file = f'yob{TARGET_YEAR}.txt'
    with zipfile.ZipFile(zip_path) as zf:
        years = sorted(int(n[3:7]) for n in zf.namelist() if n.startswith('yob') and n.endswith('.txt'))
        print(f"Zip contains years: {years[0]}–{years[-1]}")
        if target_file not in zf.namelist():
            print(f"ERROR: {target_file} not found in zip. The zip may not include 2025 yet.")
            return

        # Also extract to SSA dir so other scripts stay in sync
        os.makedirs(SSA_DIR, exist_ok=True)
        zf.extract(target_file, SSA_DIR)
        print(f"Extracted {target_file} to {SSA_DIR}/")

        raw = zf.read(target_file).decode('utf-8')

    rows = []
    for line in raw.strip().splitlines():
        parts = line.strip().split(',')
        if len(parts) == 3:
            name, gender, count = parts
            rows.append((name, TARGET_YEAR, gender, int(count)))

    print(f"Parsed {len(rows):,} rows for {TARGET_YEAR}")

    config = get_db_config()
    print(f"Connecting to {config['host']}...")
    conn = psycopg2.connect(**config)
    conn.autocommit = False
    cur = conn.cursor()
    psycopg2.extras.execute_values(cur, INSERT_SQL, rows, page_size=1000)
    conn.commit()
    print(f"Upserted {len(rows):,} rows into name_popularity for {TARGET_YEAR}.")
    cur.close()
    conn.close()


if __name__ == '__main__':
    main()
