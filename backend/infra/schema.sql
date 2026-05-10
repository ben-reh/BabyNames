CREATE EXTENSION IF NOT EXISTS vector;

-- Name feature vectors (loaded from data pipeline).
-- 65 dimensions — see data/scripts/compute_vectors.py for layout.
CREATE TABLE name_vectors (
    name        TEXT PRIMARY KEY,
    embedding   vector(65) NOT NULL
);

-- IVFFlat index for approximate nearest-neighbor search.
-- lists = 100 is a reasonable default for ~5,000 rows; tune upward if the
-- dataset grows significantly.
CREATE INDEX name_vectors_embedding_idx
    ON name_vectors USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Per-user taste vector, updated on every swipe.
CREATE TABLE user_taste (
    user_id         TEXT PRIMARY KEY,
    embedding       vector(65) NOT NULL,
    liked_count     INT NOT NULL DEFAULT 0,
    disliked_count  INT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Record of every name a user has swiped (used to exclude from recommendations).
CREATE TABLE user_swipes (
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    liked       BOOLEAN NOT NULL,
    swiped_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, name)
);

CREATE INDEX user_swipes_user_id_idx ON user_swipes (user_id);
