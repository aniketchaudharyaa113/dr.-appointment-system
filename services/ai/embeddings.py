"""
Embedding provider abstraction for MediBook AI.
Supports local SentenceTransformer (default, all-MiniLM-L6-v2, 384 dims)
and Ollama embeddings (when EMBEDDING_PROVIDER=ollama).
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import List
import numpy as np
import httpx


class EmbeddingProvider(ABC):
    dimension: int

    @abstractmethod
    def embed_texts(self, texts: List[str]) -> np.ndarray:
        """Return L2-normalized float32 matrix of shape (len(texts), dimension)."""

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed_texts([text])[0]


class SentenceTransformerEmbedder(EmbeddingProvider):
    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        from sentence_transformers import SentenceTransformer

        self.model_name = model_name
        self.model = SentenceTransformer(model_name, device="cpu")
        self.dimension = int(self.model.get_embedding_dimension())

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dimension), dtype=np.float32)
        vecs = self.model.encode(
            texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return np.asarray(vecs, dtype=np.float32)


class OllamaEmbedder(EmbeddingProvider):
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        dimension: int = 384,
    ):
        self.base_url = (base_url or os.getenv("OLLAMA_URL", "http://localhost:11434")).rstrip("/")
        self.model = model or os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
        self.dimension = dimension

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dimension), dtype=np.float32)
        out = []
        for t in texts:
            resp = httpx.post(
                f"{self.base_url}/api/embeddings",
                json={"model": self.model, "prompt": t},
                timeout=15.0,
            )
            resp.raise_for_status()
            vec = np.asarray(resp.json()["embedding"], dtype=np.float32)
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = vec / norm
            out.append(vec)
        mat = np.vstack(out)
        self.dimension = int(mat.shape[1])
        return mat


_cached_embedder: EmbeddingProvider | None = None


def get_embedding_provider() -> EmbeddingProvider:
    global _cached_embedder
    if _cached_embedder is not None:
        return _cached_embedder

    provider = os.getenv("EMBEDDING_PROVIDER", "sentence-transformers").lower()
    if provider == "ollama":
        _cached_embedder = OllamaEmbedder()
    else:
        model_name = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
        _cached_embedder = SentenceTransformerEmbedder(model_name=model_name)
    return _cached_embedder
