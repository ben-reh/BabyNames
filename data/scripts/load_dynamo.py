"""
Loads processed name data into DynamoDB.
Reads processed/names.csv + processed/similar_names.csv, batch-writes to the Names table.
Requires: aws credentials configured, Names table already deployed.
Run after merge.py and compute_similarity.py.
"""
import boto3
import csv
import json
import os
from decimal import Decimal

SCRIPTS_DIR = os.path.dirname(__file__)
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')
TABLE_NAME = 'Names'
BATCH_SIZE = 25  # DynamoDB max per batch_write_item


def load_similar(path):
    similar = {}
    if not os.path.exists(path):
        return similar
    with open(path) as f:
        for row in csv.DictReader(f):
            similar[row['name']] = {
                'vibe_names': json.loads(row.get('vibe_names', '[]')),
                'phonetic_names': json.loads(row.get('phonetic_names', '[]')),
            }
    return similar


def to_item(row, similar):
    item = {}
    for key, val in row.items():
        if val == '':
            continue
        if key in ('total_count', 'rank', 'year_min', 'year_max', 'year_peak'):
            try:
                item[key] = Decimal(val)
            except Exception:
                item[key] = val
        else:
            item[key] = val
    if similar:
        if similar.get('vibe_names'):
            item['vibe_names'] = similar['vibe_names']
        if similar.get('phonetic_names'):
            item['phonetic_names'] = similar['phonetic_names']
    return item


def load():
    names_path = os.path.join(PROCESSED_DIR, 'names.csv')
    similar_path = os.path.join(PROCESSED_DIR, 'similar_names.csv')

    if not os.path.exists(names_path):
        print(f"Error: {names_path} not found. Run merge.py first.")
        return

    print("Loading similar names index...")
    similar = load_similar(similar_path)

    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(TABLE_NAME)

    print(f"Writing to DynamoDB table '{TABLE_NAME}'...")
    total = written = 0
    batch = []

    with open(names_path) as f:
        for row in csv.DictReader(f):
            total += 1
            item = to_item(row, similar.get(row['name'], {}))
            batch.append({'PutRequest': {'Item': item}})

            if len(batch) == BATCH_SIZE:
                table.meta.client.batch_write_item(RequestItems={TABLE_NAME: batch})
                written += len(batch)
                batch = []
                if written % 5000 == 0:
                    print(f"  {written}/{total}...")

    if batch:
        table.meta.client.batch_write_item(RequestItems={TABLE_NAME: batch})
        written += len(batch)

    print(f"Done. Wrote {written} items to '{TABLE_NAME}'.")


if __name__ == '__main__':
    load()
