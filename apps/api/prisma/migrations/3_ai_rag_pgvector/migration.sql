CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "ai_knowledge_chunks" (
  "id" TEXT NOT NULL,
  "source" VARCHAR(120) NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(384) NOT NULL,
  "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("content", ''))) STORED,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_ai_knowledge_chunks_tsv"
  ON "ai_knowledge_chunks" USING GIN ("tsv");

CREATE INDEX IF NOT EXISTS "idx_ai_knowledge_chunks_embedding"
  ON "ai_knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
