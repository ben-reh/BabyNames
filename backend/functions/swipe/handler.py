"""
POST /swipe

Records a swipe and updates the user's taste vector.

Body: { "name": "Emma", "liked": true }

Liked names pull the taste vector toward them.
Disliked names push the taste vector away (at half weight).

Environment variables:
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
"""
import json
import os
import psycopg2
import psycopg2.extras


def get_connection():
    return psycopg2.connect(
        host=os.environ['DB_HOST'],
        port=os.environ.get('DB_PORT', 5432),
        dbname=os.environ['DB_NAME'],
        user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'],
    )


def update_taste(cur, user_id, name_vector, liked):
    cur.execute(
        "SELECT embedding, liked_count, disliked_count FROM user_taste WHERE user_id = %s",
        (user_id,)
    )
    row = cur.fetchone()

    v = name_vector
    weight = 1.0 if liked else -0.5

    if row is None:
        new_embedding = [x * weight for x in v]
        liked_count = 1 if liked else 0
        disliked_count = 0 if liked else 1
    else:
        current, liked_count, disliked_count = row['embedding'], row['liked_count'], row['disliked_count']
        total = liked_count + disliked_count
        new_embedding = [
            (current[i] * total + v[i] * weight) / (total + 1)
            for i in range(len(v))
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

    try:
        body = json.loads(event.get('body') or '{}')
        name = body['name']
        liked = bool(body['liked'])
    except (KeyError, ValueError):
        return {'statusCode': 400, 'body': json.dumps({'error': 'name and liked are required'})}

    try:
        conn = get_connection()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT embedding FROM name_vectors WHERE name = %s",
                (name,)
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'body': json.dumps({'error': f'name not found: {name}'})}

            name_vector = row['embedding']

            cur.execute(
                """
                INSERT INTO user_swipes (user_id, name, liked)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, name) DO UPDATE SET liked = EXCLUDED.liked, swiped_at = NOW()
                """,
                (user_id, name, liked)
            )
            update_taste(cur, user_id, name_vector, liked)

        conn.commit()
        conn.close()
    except Exception as e:
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}

    return {'statusCode': 200, 'body': json.dumps({'ok': True})}
