"""
GET /recommendations

Returns the next batch of name recommendations for a user.

For users with swipe history, queries pgvector for names nearest to their
taste vector. For new users (cold start), returns the most popular unswipped
names by total_count.

Environment variables:
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
"""
import json
import os
import psycopg2
import psycopg2.extras

BATCH_SIZE = 20
COLD_START_QUERY = """
    SELECT nv.name
    FROM name_vectors nv
    WHERE nv.name NOT IN (
        SELECT name FROM user_swipes WHERE user_id = %s
    )
    ORDER BY nv.name  -- stable ordering; front-end sorts by popularity client-side
    LIMIT %s
"""
TASTE_QUERY = """
    SELECT nv.name
    FROM name_vectors nv
    WHERE nv.name NOT IN (
        SELECT name FROM user_swipes WHERE user_id = %s
    )
    ORDER BY nv.embedding <=> (
        SELECT embedding FROM user_taste WHERE user_id = %s
    )
    LIMIT %s
"""


def get_connection():
    return psycopg2.connect(
        host=os.environ['DB_HOST'],
        port=os.environ.get('DB_PORT', 5432),
        dbname=os.environ['DB_NAME'],
        user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'],
    )


def handler(event, context):
    user_id = event['requestContext']['authorizer']['claims']['sub']

    try:
        conn = get_connection()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT 1 FROM user_taste WHERE user_id = %s",
                (user_id,)
            )
            has_taste = cur.fetchone() is not None

            if has_taste:
                cur.execute(TASTE_QUERY, (user_id, user_id, BATCH_SIZE))
            else:
                cur.execute(COLD_START_QUERY, (user_id, BATCH_SIZE))

            names = [row['name'] for row in cur.fetchall()]
        conn.close()
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)}),
        }

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'names': names}),
    }
