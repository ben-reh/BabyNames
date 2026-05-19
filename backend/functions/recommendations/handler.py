"""
GET /recommendations?sex=F|M|U

Returns the next batch of name recommendations for a user.

For users with >= CLUSTER_MIN_LIKES liked names, clusters their taste into
2-3 style groups via k-means and queries pgvector against each centroid
(multi-vector). Results are round-robin interleaved to keep style diversity
in the swipe deck. For users below the threshold, falls back to a single
taste vector. For new users (cold start), returns popular unswiped names.

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
import numpy as np
import psycopg2
import psycopg2.extras

BATCH_SIZE = 20
CLUSTER_MIN_LIKES = 8    # activate multi-vector above this threshold
CLUSTER_K_HIGH = 3       # use 3 clusters when liked_count >= CLUSTER_K_HIGH_THRESHOLD
CLUSTER_K_HIGH_THRESHOLD = 20

UNISEX_MIN = 0.05
UNISEX_MAX = 0.95
SEX_FILTER_F = 0.10
SEX_FILTER_M = 0.90


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


def parse_vector(raw) -> list[float]:
    """Parse a pgvector value to a Python list (handles string and list forms)."""
    if isinstance(raw, list):
        return raw
    return json.loads(raw)


def kmeans(vectors: np.ndarray, k: int, max_iter: int = 20) -> np.ndarray:
    """K-means++ clustering over liked name vectors; returns k centroids."""
    rng = np.random.default_rng(42)
    centroids = [vectors[rng.integers(len(vectors))]]
    for _ in range(k - 1):
        dists = np.min(
            np.stack([np.sum((vectors - c) ** 2, axis=1) for c in centroids]),
            axis=0,
        )
        probs = dists / dists.sum()
        centroids.append(vectors[rng.choice(len(vectors), p=probs)])
    centroids = np.array(centroids, dtype=np.float32)

    for _ in range(max_iter):
        diffs = vectors[:, None, :] - centroids[None, :, :]   # (N, k, D)
        labels = np.argmin(np.sum(diffs ** 2, axis=2), axis=1)
        new_centroids = np.array([
            vectors[labels == i].mean(axis=0) if (labels == i).any() else centroids[i]
            for i in range(k)
        ], dtype=np.float32)
        if np.allclose(centroids, new_centroids, atol=1e-6):
            break
        centroids = new_centroids

    return centroids


def get_liked_vectors(cur, user_id: str) -> np.ndarray:
    cur.execute(
        """
        SELECT nv.embedding
        FROM user_swipes us
        JOIN name_vectors nv ON us.name = nv.name
        WHERE us.user_id = %s AND us.liked = true
        """,
        (user_id,),
    )
    rows = cur.fetchall()
    return np.array([parse_vector(row['embedding']) for row in rows], dtype=np.float32)


def multi_vector_recs(cur, user_id: str, centroids: np.ndarray, sex_clause: str, top_n: int) -> list[str]:
    """Run one ANN query per centroid and round-robin interleave results."""
    cluster_lists: list[list[str]] = []
    for centroid in centroids:
        cur.execute(
            f"""
            SELECT nv.name
            FROM name_vectors nv
            WHERE nv.name NOT IN (
                SELECT name FROM user_swipes WHERE user_id = %s
            )
            {sex_clause}
            ORDER BY nv.embedding <=> %s::vector
            LIMIT %s
            """,
            (user_id, centroid.tolist(), top_n),
        )
        cluster_lists.append([row['name'] for row in cur.fetchall()])

    seen: set[str] = set()
    result: list[str] = []
    for i in range(max((len(lst) for lst in cluster_lists), default=0)):
        for lst in cluster_lists:
            if i < len(lst) and lst[i] not in seen:
                seen.add(lst[i])
                result.append(lst[i])
                if len(result) >= top_n:
                    return result
    return result


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
        ORDER BY nv.female_pct
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
                "SELECT liked_count FROM user_taste WHERE user_id = %s",
                (user_id,),
            )
            row = cur.fetchone()
            liked_count = row['liked_count'] if row else 0

            if liked_count >= CLUSTER_MIN_LIKES:
                liked_vecs = get_liked_vectors(cur, user_id)
                k = CLUSTER_K_HIGH if liked_count >= CLUSTER_K_HIGH_THRESHOLD else 2
                if len(liked_vecs) >= k:
                    centroids = kmeans(liked_vecs, k)
                    names = multi_vector_recs(cur, user_id, centroids, sex_clause, BATCH_SIZE)
                else:
                    cur.execute(taste_query, (user_id, user_id, BATCH_SIZE))
                    names = [row['name'] for row in cur.fetchall()]
            elif liked_count > 0:
                cur.execute(taste_query, (user_id, user_id, BATCH_SIZE))
                names = [row['name'] for row in cur.fetchall()]
            else:
                cur.execute(cold_start_query, (user_id, BATCH_SIZE))
                names = [row['name'] for row in cur.fetchall()]

        conn.close()
    except Exception as e:
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'names': names}),
    }
