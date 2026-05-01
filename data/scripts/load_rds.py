"""
Loads SSA yearly name data into PostgreSQL (Aurora Serverless v2).
Reads data/raw/ssa/yob*.txt, creates the name_popularity table, bulk-inserts rows.
Requires: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD env vars (or pulls from Secrets Manager).
Run after download_ssa.py.
"""
import os
import glob
import json
import boto3
import psycopg2
import psycopg2.extras

SCRIPTS_DIR = os.path.dirname(__file__)
SSA_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw', 'ssa')

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS name_popularity (
    name    TEXT    NOT NULL,
    year    SMALLINT NOT NULL,
    gender  CHAR(1) NOT NULL,
    count   INTEGER NOT NULL,
    PRIMARY KEY (name, year, gender)
);
"""

CREATE_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_name_popularity_name ON name_popularity (name);
CREATE INDEX IF NOT EXISTS idx_name_popularity_year ON name_popularity (year);
"""

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
    print(f"DB_HOST not set — fetching credentials from Secrets Manager ({secret_id})...")
    client = boto3.client('secretsmanager')
    secret = json.loads(client.get_secret_value(SecretId=secret_id)['SecretString'])
    return {
        'host': secret['host'],
        'dbname': secret.get('dbname', 'babynames'),
        'user': secret['username'],
        'password': secret['password'],
        'port': int(secret.get('port', 5432)),
    }


def parse_ssa_file(path, year):
    rows = []
    with open(path) as f:
        for line in f:
            parts = line.strip().split(',')
            if len(parts) != 3:
                continue
            name, gender, count = parts
            rows.append((name, year, gender, int(count)))
    return rows


def load():
    yob_files = sorted(glob.glob(os.path.join(SSA_DIR, 'yob*.txt')))
    if not yob_files:
        print(f"No SSA files found in {SSA_DIR}. Run download_ssa.py first.")
        return

    print(f"Found {len(yob_files)} SSA files ({os.path.basename(yob_files[0][:7])}–{os.path.basename(yob_files[-1][:7])})")

    config = get_db_config()
    print(f"Connecting to {config['host']}...")
    conn = psycopg2.connect(**config)
    conn.autocommit = False
    cur = conn.cursor()

    print("Creating table and indexes...")
    cur.execute(CREATE_TABLE_SQL)
    cur.execute(CREATE_INDEX_SQL)
    conn.commit()

    total = 0
    for path in yob_files:
        year = int(os.path.basename(path)[3:7])
        rows = parse_ssa_file(path, year)
        psycopg2.extras.execute_values(cur, INSERT_SQL, rows, page_size=1000)
        conn.commit()
        total += len(rows)
        if year % 10 == 0:
            print(f"  {year}: {len(rows)} rows (total: {total:,})")

    print(f"Done. Inserted {total:,} rows into name_popularity.")
    cur.close()
    conn.close()


if __name__ == '__main__':
    load()
