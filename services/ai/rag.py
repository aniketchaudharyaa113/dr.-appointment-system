"""
Hybrid pgvector + PostgreSQL tsvector RAG Engine for MediBook AI.
- Parses markdown knowledge corpus into section-level chunks.
- Computes dense normalized embeddings via EmbeddingProvider (all-MiniLM-L6-v2, 384 dims).
- Persists chunks & embeddings into PostgreSQL `ai_knowledge_chunks` with pgvector HNSW + GIN tsvector indexes.
- Executes hybrid search merging cosine similarity (`1 - (embedding <=> q)`) + PostgreSQL `ts_rank_cd(tsv, plainto_tsquery)` via Reciprocal Rank Fusion + cosine score gating.
- Abstains cleanly when retrieval confidence falls below threshold so unrelated/out-of-domain queries receive zero fabricated citations.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import numpy as np
import psycopg2
from pgvector.psycopg2 import register_vector

from embeddings import EmbeddingProvider, get_embedding_provider


CORPUS_DIR = Path(__file__).resolve().parent / "corpus"

MIN_COSINE_SCORE = float(os.getenv("RAG_MIN_COSINE_SCORE", "0.24"))
MIN_RRF_HYBRID_SCORE = float(os.getenv("RAG_MIN_HYBRID_SCORE", "0.24"))


@dataclass
class KnowledgeChunk:
    id: str
    source: str
    title: str
    content: str
    embedding: Optional[np.ndarray] = None


def load_corpus_chunks(corpus_dir: Path = CORPUS_DIR) -> List[KnowledgeChunk]:
    chunks: List[KnowledgeChunk] = []
    for md_file in sorted(corpus_dir.glob("*.md")):
        raw = md_file.read_text(encoding="utf-8").strip()
        sections = re.split(r"\n(?=##\s+)", raw)
        doc_title = md_file.stem.replace("_", " ").title()
        first_line = raw.splitlines()[0] if raw else ""
        if first_line.startswith("# "):
            doc_title = first_line[2:].strip()

        for idx, sec in enumerate(sections):
            sec = sec.strip()
            if not sec:
                continue
            lines = sec.splitlines()
            sec_title = doc_title
            if lines[0].startswith("## "):
                sec_title = f"{doc_title} — {lines[0][3:].strip()}"
            elif lines[0].startswith("# "):
                sec_title = lines[0][2:].strip()
            chunks.append(
                KnowledgeChunk(
                    id=f"{md_file.name}#sec{idx}",
                    source=md_file.name,
                    title=sec_title,
                    content=sec,
                )
            )
    return chunks


class HybridRagStore:
    def __init__(
        self,
        database_url: Optional[str] = None,
        embedder: Optional[EmbeddingProvider] = None,
        corpus_dir: Path = CORPUS_DIR,
    ):
        self.database_url = database_url if database_url is not None else os.getenv("DATABASE_URL")
        self.embedder = embedder or get_embedding_provider()
        self.corpus_dir = corpus_dir
        self.chunks: List[KnowledgeChunk] = []
        self.matrix: Optional[np.ndarray] = None
        self.backend = "in_memory_dense"
        self.initialize()

    def initialize(self):
        chunks = load_corpus_chunks(self.corpus_dir)
        texts = [f"{c.title}\n{c.content}" for c in chunks]
        embeddings = self.embedder.embed_texts(texts)
        for c, emb in zip(chunks, embeddings):
            c.embedding = emb
        self.chunks = chunks
        self.matrix = embeddings

        if self.database_url:
            try:
                self._sync_to_pgvector()
                self.backend = "pgvector_hybrid"
            except Exception as err:
                # Honest reporting if Postgres unreachable during initialization
                self.backend = f"in_memory_dense_fallback ({type(err).__name__})"

    def _connect(self):
        conn = psycopg2.connect(self.database_url)
        register_vector(conn)
        return conn

    def _sync_to_pgvector(self):
        dim = self.embedder.dimension
        # Ensure vector extension exists BEFORE calling register_vector
        raw_conn = psycopg2.connect(self.database_url)
        try:
            with raw_conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            raw_conn.commit()
        finally:
            raw_conn.close()

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
                      id TEXT PRIMARY KEY,
                      source VARCHAR(120) NOT NULL,
                      title VARCHAR(255) NOT NULL,
                      content TEXT NOT NULL,
                      embedding vector({dim}) NOT NULL,
                      tsv tsvector GENERATED ALWAYS AS (
                        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
                      ) STORED,
                      updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_tsv ON ai_knowledge_chunks USING GIN (tsv);"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_embedding ON ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops);"
                )
                for c in self.chunks:
                    cur.execute(
                        """
                        INSERT INTO ai_knowledge_chunks (id, source, title, content, embedding, updated_at)
                        VALUES (%s, %s, %s, %s, %s, NOW())
                        ON CONFLICT (id) DO UPDATE SET
                          source = EXCLUDED.source,
                          title = EXCLUDED.title,
                          content = EXCLUDED.content,
                          embedding = EXCLUDED.embedding,
                          updated_at = NOW();
                        """,
                        (c.id, c.source, c.title, c.content, c.embedding.tolist()),
                    )
            conn.commit()

    def search(self, query: str, top_k: int = 3) -> Tuple[List[Dict], bool, float]:
        """
        Returns (hits, abstained, max_score).
        Uses PostgreSQL pgvector cosine + tsvector RRF hybrid search when DB is active.
        """
        q_vec = self.embedder.embed_query(query)

        if self.database_url and self.backend == "pgvector_hybrid":
            return self._search_pgvector(query, q_vec, top_k)
        return self._search_in_memory(query, q_vec, top_k)

    def _build_or_tsquery(self, query: str) -> str:
        stop = {"what", "which", "when", "where", "who", "how", "does", "with", "that", "this", "from", "have", "into", "about", "should", "there", "their", "your"}
        tokens = [
            re.sub(r"[^a-z0-9]", "", w)
            for w in re.findall(r"[a-zA-Z0-9]+", query.lower())
        ]
        terms = [t for t in tokens if len(t) >= 3 and t not in stop]
        if not terms:
            terms = [t for t in tokens if t]
        return " | ".join(dict.fromkeys(terms)) if terms else ""

    def _search_pgvector(
        self, query: str, q_vec: np.ndarray, top_k: int
    ) -> Tuple[List[Dict], bool, float]:
        vec_list = q_vec.tolist()
        or_tsq = self._build_or_tsquery(query)
        sql = """
        WITH semantic AS (
          SELECT
            id,
            source,
            title,
            content,
            1 - (embedding <=> %s::vector) AS cosine_score,
            ROW_NUMBER() OVER (ORDER BY embedding <=> %s::vector ASC) AS sem_rank
          FROM ai_knowledge_chunks
          ORDER BY embedding <=> %s::vector ASC
          LIMIT 10
        ),
        lexical AS (
          SELECT
            id,
            ts_rank_cd(tsv, to_tsquery('english', %s)) AS fts_score,
            ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, to_tsquery('english', %s)) DESC) AS lex_rank
          FROM ai_knowledge_chunks
          WHERE %s <> '' AND tsv @@ to_tsquery('english', %s)
          LIMIT 10
        )
        SELECT
          s.id,
          s.source,
          s.title,
          s.content,
          s.cosine_score,
          COALESCE(l.fts_score, 0.0) AS fts_score,
          (
            0.70 * GREATEST(s.cosine_score, 0.0)
            + 0.30 * LEAST(COALESCE(l.fts_score, 0.0) * 2.0, 1.0)
            + (1.0 / (60.0 + s.sem_rank)) * 10.0
            + CASE WHEN l.lex_rank IS NOT NULL THEN (1.0 / (60.0 + l.lex_rank)) * 10.0 ELSE 0.0 END
          ) AS hybrid_score
        FROM semantic s
        LEFT JOIN lexical l ON s.id = l.id
        ORDER BY hybrid_score DESC
        LIMIT %s;
        """
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    sql,
                    (vec_list, vec_list, vec_list, or_tsq, or_tsq, or_tsq, or_tsq, top_k),
                )
                rows = cur.fetchall()

        hits = []
        for row in rows:
            cid, source, title, content, cos_s, fts_s, hyb_s = row
            hits.append(
                {
                    "id": cid,
                    "source": source,
                    "title": title,
                    "content": content,
                    "cosine_score": round(float(cos_s), 4),
                    "fts_score": round(float(fts_s), 4),
                    "hybrid_score": round(float(hyb_s), 4),
                }
            )

        if not hits:
            return [], True, 0.0

        best_cos = max(h["cosine_score"] for h in hits)
        best_fts = max(h["fts_score"] for h in hits)
        if best_cos < MIN_COSINE_SCORE and best_fts < 0.08:
            return [], True, best_cos

        filtered = [h for h in hits if h["cosine_score"] >= (MIN_COSINE_SCORE - 0.04) or h["fts_score"] >= 0.08]
        if not filtered:
            return [], True, best_cos

        return filtered, False, best_cos

    def _search_in_memory(
        self, query: str, q_vec: np.ndarray, top_k: int
    ) -> Tuple[List[Dict], bool, float]:
        if self.matrix is None or len(self.chunks) == 0:
            return [], True, 0.0

        cos_scores = self.matrix @ q_vec
        q_terms = {t for t in re.findall(r"[a-z0-9]{3,}", query.lower())}

        ranked: List[Dict] = []
        for idx, chunk in enumerate(self.chunks):
            cos_s = float(cos_scores[idx])
            doc_terms = set(re.findall(r"[a-z0-9]{3,}", (chunk.title + " " + chunk.content).lower()))
            overlap = len(q_terms & doc_terms) / max(len(q_terms), 1) if q_terms else 0.0
            hybrid_s = 0.80 * cos_s + 0.20 * overlap
            ranked.append(
                {
                    "id": chunk.id,
                    "source": chunk.source,
                    "title": chunk.title,
                    "content": chunk.content,
                    "cosine_score": round(cos_s, 4),
                    "fts_score": round(overlap, 4),
                    "hybrid_score": round(hybrid_s, 4),
                }
            )

        ranked.sort(key=lambda r: r["hybrid_score"], reverse=True)
        top = ranked[:top_k]
        best_cos = top[0]["cosine_score"] if top else 0.0
        if best_cos < MIN_COSINE_SCORE:
            return [], True, best_cos
        filtered = [h for h in top if h["cosine_score"] >= (MIN_COSINE_SCORE - 0.05)]
        return filtered, len(filtered) == 0, best_cos


_cached_rag: HybridRagStore | None = None


def get_rag_store(force_reinit: bool = False) -> HybridRagStore:
    global _cached_rag
    if _cached_rag is None or force_reinit:
        _cached_rag = HybridRagStore()
    return _cached_rag
