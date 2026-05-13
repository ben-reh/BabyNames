"""
GET /recommendations?sex=F|M|U

Returns the next batch of name recommendations for a user.

For users with swipe history, queries pgvector for names nearest to their
taste vector. For new users (cold start), returns the most popular unswiped
names ordered by birth count.

sex parameter (optional):
  F  — female and unisex names (female_pct >= 0.05)
  M  — male and unisex names   (female_pct <= 0.95)
  U  — unisex only             (0.05 < female_pct < 0.95)
  omit — no filter

Environment variables:
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
"""
import json
import os
import psycopg2
import psycopg2.extras

BATCH_SIZE = 20

UNISEX_MIN = 0.05
UNISEX_MAX = 0.95
SEX_FILTER_F = 0.10   # min female_pct for F recommendations
SEX_FILTER_M = 0.90   # max female_pct for M recommendations


def get_connection():
    return psycopg2.connect(
        host=os.environ['DB_HOST'],
        port=os.environ.get('DB_PORT', 5432),
        dbname=os.environ['DB_NAME'],
        user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'],
    )


def sex_filter_clause(sex: str | None) -> str:
    if sex == 'F':
        return f"AND nv.female_pct >= {SEX_FILTER_F}"
    if sex == 'M':
        return f"AND nv.female_pct <= {SEX_FILTER_M}"
    if sex == 'U':
        return f"AND nv.female_pct > {UNISEX_MIN} AND nv.female_pct < {UNISEX_MAX}"
    return ""


def update_taste(cur, user_id, name_vector, liked):
    cur.execute(
        "SELECT embedding, liked_count, disliked_count FROM user_taste WHERE user_id = %s",
        (user_id,)
    )
    row = cur.fetchone()

    weight = 1.0 if liked else -0.5

    if row is None:
        new_embedding = [x * weight for x in name_vector]
        liked_count = 1 if liked else 0
        disliked_count = 0 if liked else 1
    else:
        current, liked_count, disliked_count = row['embedding'], row['liked_count'], row['disliked_count']
        total = liked_count + disliked_count
        new_embedding = [
            (current[i] * total + name_vector[i] * weight) / (total + 1)
            for i in range(len(name_vector))
        ]
        if liked:
            liked_count += 1
        else:
            disliked_count += 1

    cur.execute(
        """
        INSERT INTO user_taste (user_id, embedding, liked_count, disliked_count, updated_at)
        VALUES (%s, %s::vector, %s, %s, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            embedding      = EXCLUDED.embedding,
            liked_count    = EXCLUDED.liked_count,
            disliked_count = EXCLUDED.disliked_count,
            updated_at     = EXCLUDED.updated_at
        """,
        (user_id, new_embedding, liked_count, disliked_count)
    )


def handler(event, context):
    user_id = event['requestContext']['authorizer']['claims']['sub']
    sex = (event.get('queryStringParameters') or {}).get('sex')

    sex_clause = sex_filter_clause(sex)

    cold_start_query = f"""
        SELECT nv.name
        FROM name_vectors nv
        WHERE nv.name NOT IN (
            SELECT name FROM user_swipes WHERE user_id = %s
        )
        {sex_clause}
        ORDER BY nv.female_pct  -- stable ordering; populated by count in practice
        LIMIT %s
    """

    taste_query = f"""
        SELECT nv.name
        FROM name_vectors nv
        WHERE nv.name NOT IN (
            SELECT name FROM user_swipes WHERE user_id = %s
        )
        {sex_clause}
        ORDER BY nv.embedding <=> (
            SELECT embedding FROM user_taste WHERE user_id = %s
        )
        LIMIT %s
    """

    try:
        conn = get_connection()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT 1 FROM user_taste WHERE user_id = %s",
                (user_id,)
            )
            has_taste = cur.fetchone() is not None

            if has_taste:
                cur.execute(taste_query, (user_id, user_id, BATCH_SIZE))
            else:
                cur.execute(cold_start_query, (user_id, BATCH_SIZE))

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
