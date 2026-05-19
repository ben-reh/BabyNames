"""
Patches the 'meaning' attribute onto existing DynamoDB name items.
Reads processed/meanings.csv, issues update_item for each name.
Requires: aws credentials configured, Names table already deployed.
Run after extract_meanings.py and generate_meanings.py.
"""
import boto3
import csv
import os
from botocore.exceptions import ClientError

SCRIPTS_DIR = os.path.dirname(__file__)
PROCESSED_DIR = os.path.join(SCRIPTS_DIR, '..', 'processed')
MEANINGS_CSV = os.path.join(PROCESSED_DIR, 'meanings.csv')
TABLE_NAME = 'Names'


def load():
    if not os.path.exists(MEANINGS_CSV):
        print(f"Error: {MEANINGS_CSV} not found.")
        return

    with open(MEANINGS_CSV) as f:
        rows = [r for r in csv.DictReader(f) if r['meaning'].strip()]

    print(f"Meanings to load: {len(rows)}")

    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(TABLE_NAME)

    updated = skipped = errors = 0

    for i, row in enumerate(rows):
        try:
            table.update_item(
                Key={'name': row['name']},
                UpdateExpression='SET meaning = :m',
                ExpressionAttributeValues={':m': row['meaning']},
                ConditionExpression='attribute_exists(#n)',
                ExpressionAttributeNames={'#n': 'name'},
            )
            updated += 1
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                skipped += 1  # name not in DB — expected for rare names
            else:
                print(f"  Error on {row['name']}: {e}")
                errors += 1

        if (i + 1) % 500 == 0:
            print(f"  {i + 1}/{len(rows)}  updated={updated}  skipped={skipped}")

    print(f"Done. updated={updated}  skipped={skipped}  errors={errors}")


if __name__ == '__main__':
    load()
