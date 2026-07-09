"""
Semantic image embeddings — CLIP (OpenAI ViT-B/32) for filter/compress/AI-robust matching.
Lazy-loaded; graceful offline when torch/transformers unavailable.
"""
from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ..base import EnterpriseAIService, ServiceResult

BASE_DIR = Path(__file__).resolve().parents[2]
CLIP_INDEX_FILE = BASE_DIR / "data" / "clip_faiss_index.bin"
CLIP_META_FILE = BASE_DIR / "data" / "clip_metadata.json"
CLIP_DIM = 512
CLIP_MODEL_ID = "openai/clip-vit-base-patch32"


class SemanticEmbeddingsService(EnterpriseAIService):
    name = "semantic_embeddings"

    def __init__(self) -> None:
        self._model = None
        self._processor = None
        self._clip_index = None
        self._clip_meta: list[dict[str, Any]] = []
        self._load_clip_index()

    def is_available(self) -> bool:
        try:
            import torch  # noqa: F401
            from transformers import CLIPModel  # noqa: F401
        except ImportError:
            return False
        return True

    def status(self) -> dict[str, Any]:
        return {
            "module": self.name,
            "available": self.is_available(),
            "model": CLIP_MODEL_ID,
            "dimension": CLIP_DIM,
            "indexed": self._clip_index.ntotal if self._clip_index else 0,
            "capabilities": ["clip_image_embedding", "clip_faiss_search"],
        }

    def _load_clip_index(self) -> None:
        import faiss

        if CLIP_INDEX_FILE.exists() and CLIP_META_FILE.exists():
            try:
                self._clip_index = faiss.read_index(str(CLIP_INDEX_FILE))
                self._clip_meta = json.loads(CLIP_META_FILE.read_text())
                return
            except Exception:
                pass
        self._clip_index = faiss.IndexFlatIP(CLIP_DIM)
        self._clip_meta = []

    def _save_clip_index(self) -> None:
        import faiss

        CLIP_INDEX_FILE.parent.mkdir(exist_ok=True)
        faiss.write_index(self._clip_index, str(CLIP_INDEX_FILE))
        CLIP_META_FILE.write_text(json.dumps(self._clip_meta, indent=2))

    def _ensure_model(self) -> bool:
        if self._model is not None:
            return True
        if not self.is_available():
            return False
        try:
            import torch
            from transformers import CLIPModel, CLIPProcessor

            self._processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID)
            self._model = CLIPModel.from_pretrained(CLIP_MODEL_ID)
            self._model.eval()
            if torch.cuda.is_available():
                self._model = self._model.cuda()
            return True
        except Exception:
            return False

    def encode_image(self, image_bytes: bytes) -> ServiceResult:
        if not self._ensure_model():
            return ServiceResult(False, {}, "CLIP model unavailable", self.name)

        import torch

        try:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            inputs = self._processor(images=img, return_tensors="pt")
            if torch.cuda.is_available():
                inputs = {k: v.cuda() for k, v in inputs.items()}
            with torch.no_grad():
                feats = self._model.get_image_features(**inputs)
                feats = feats / feats.norm(dim=-1, keepdim=True)
            vec = feats[0].cpu().numpy().astype(np.float32)
            return ServiceResult(True, {
                "embedding": vec.tolist(),
                "dimension": len(vec),
                "model": CLIP_MODEL_ID,
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)

    def index_vault_image(
        self,
        image_bytes: bytes,
        vault_id: str,
        dna_record_id: str,
        filename: str = "",
    ) -> ServiceResult:
        enc = self.encode_image(image_bytes)
        if not enc.success:
            return enc

        vec = np.array(enc.data["embedding"], dtype=np.float32).reshape(1, -1)
        self._clip_meta = [m for m in self._clip_meta if m.get("vaultId") != vault_id]
        self._clip_index.add(vec)
        self._clip_meta.append({
            "vaultId": vault_id,
            "dnaRecordId": dna_record_id,
            "filename": filename,
        })
        self._save_clip_index()
        return ServiceResult(True, {
            "vaultId": vault_id,
            "clipIndexed": True,
            "totalVectors": self._clip_index.ntotal,
        }, "OK", self.name)

    def search(self, image_bytes: bytes, top_k: int = 20) -> ServiceResult:
        if not self._clip_index or self._clip_index.ntotal == 0:
            return ServiceResult(True, {"candidates": []}, "Empty CLIP index", self.name)

        enc = self.encode_image(image_bytes)
        if not enc.success:
            return enc

        vec = np.array(enc.data["embedding"], dtype=np.float32).reshape(1, -1)
        k = min(top_k, self._clip_index.ntotal)
        D, I = self._clip_index.search(vec, k)

        seen: set[str] = set()
        candidates: list[dict[str, Any]] = []
        for score, idx in zip(D[0], I[0]):
            if idx < 0 or idx >= len(self._clip_meta):
                continue
            meta = self._clip_meta[idx]
            vid = meta["vaultId"]
            if vid in seen:
                continue
            seen.add(vid)
            sim = float(max(0, min(1, score)))
            candidates.append({
                "vaultId": vid,
                "dnaRecordId": meta.get("dnaRecordId"),
                "filename": meta.get("filename", ""),
                "clipSimilarity": round(sim, 4),
                "clipPercent": round(sim * 100, 1),
            })

        return ServiceResult(True, {"candidates": candidates}, "OK", self.name)


semantic_embeddings_service = SemanticEmbeddingsService()
