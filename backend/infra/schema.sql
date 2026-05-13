CREATE EXTENSION IF NOT EXISTS vector;

-- Drop and recreate name_vectors on each pipeline run (pipeline-owned data).
DROP TABLE IF EXISTS name_vectors CASCADE;

-- 564 dimensions (52 hand-crafted + 512 OpenAI) — see data/scripts/compute_vectors.py for layout.
CREATE TABLE name_vectors (
    name        TEXT PRIMARY KEY,
    embedding   vector(564) NOT NULL,
    female_pct  FLOAT NOT NULL DEFAULT 0.5
);

-- IVFFlat index for approximate nearest-neighbor search.
-- lists = 150 ~ sqrt(15,000); tune upward if the dataset grows significantly.
CREATE INDEX name_vectors_embedding_idx
    ON name_vectors USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 150);

-- Per-user taste vector, updated on every swipe.
CREATE TABLE IF NOT EXISTS user_taste (
    user_id         TEXT PRIMARY KEY,
    embedding       vector(564) NOT NULL,
    liked_count     INT NOT NULL DEFAULT 0,
    disliked_count  INT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Record of every name a user has swiped (used to exclude from recommendations).
CREATE TABLE IF NOT EXISTS user_swipes (
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    liked       BOOLEAN NOT NULL,
    swiped_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, name)
);

CREATE INDEX IF NOT EXISTS user_swipes_user_id_idx ON user_swipes (user_id);
