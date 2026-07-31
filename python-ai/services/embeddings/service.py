"""Semantic embeddings — wraps sentence-transformers / FAISS (placeholder extensions)."""
from __future__ import annotations

from typing import Any

from ..base import EnterpriseAIService, ServiceResult


class EmbeddingsService(EnterpriseAIService):
    name = "embeddings"

    def is_available(self) -> bool:
        try:
            import faiss  # noqa: F401
            from sentence_transformers import SentenceTransformer  # noqa: F401
        except ImportError:
            return False
        return True

    def status(self) -> dict[str, Any]:
        return {
            "module": self.name,
            "available": self.is_available(),
            "phase": "infrastructure",
            "capabilities": [
                "semantic_embed",
                "faiss_index",
                "hybrid_search",
                "vault_content_indexing",
            ],
        }

    def embed_text(self, text: str) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "Embeddings stack not available", self.name)
        return self.not_implemented("embed_text")


embeddings_service = EmbeddingsService()
