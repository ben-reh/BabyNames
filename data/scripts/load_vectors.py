"""
Loads name_vectors.csv into PostgreSQL (name_vectors table).
Applies schema.sql first to create the table and ivfflat index.
Requires: DB_HOST/DB_NAME/DB_USER/DB_PASSWORD env vars, or DB_SECRET_ARN for Secrets Manager.
Run after compute_vectors.py.
"""
import csv
import json
import os
import boto3
import psycopg2
import psycopg2.extras

SCRIPTS_DIR = os.path.dirname(__file__)
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')
SCHEMA_PATH = os.path.join(SCRIPTS_DIR, '..', '..', 'backend', 'infra', 'schema.sql')
VECTORS_PATH = os.path.join(PROCESSED_DIR, 'name_vectors.csv')

BATCH_SIZE = 500


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


def apply_schema(cur):
    with open(SCHEMA_PATH) as f:
        cur.execute(f.read())


def load():
    config = get_db_config()
    print(f"Connecting to {config['host']}...")
    conn = psycopg2.connect(**config)
    conn.autocommit = False
    cur = conn.cursor()

    print("Applying schema...")
    apply_schema(cur)
    conn.commit()

    print("Loading name vectors...")
    rows = []
    total = 0

    with open(VECTORS_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            vector = json.loads(row['vector'])
            female_pct = float(row.get('female_pct', 0.5))
            rows.append((row['name'], vector, female_pct))

            if len(rows) == BATCH_SIZE:
                psycopg2.extras.execute_values(
                    cur,
                    "INSERT INTO name_vectors (name, embedding, female_pct) VALUES %s "
                    "ON CONFLICT (name) DO UPDATE SET embedding = EXCLUDED.embedding, female_pct = EXCLUDED.female_pct",
                    rows,
                    template="(%s, %s::vector, %s)",
                    page_size=BATCH_SIZE,
                )
                conn.commit()
                total += len(rows)
                print(f"  Inserted {total:,}...")
                rows = []

    if rows:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO name_vectors (name, embedding, female_pct) VALUES %s "
            "ON CONFLICT (name) DO UPDATE SET embedding = EXCLUDED.embedding, female_pct = EXCLUDED.female_pct",
            rows,
            template="(%s, %s::vector, %s)",
            page_size=BATCH_SIZE,
        )
        conn.commit()
        total += len(rows)

    print(f"Done. Inserted {total:,} name vectors.")
    cur.close()
    conn.close()


if __name__ == '__main__':
    load()
