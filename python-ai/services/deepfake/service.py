"""AI manipulation / synthetic edit detection (heuristic + optional model path)."""
from __future__ import annotations

import io
from typing import Any

import numpy as np
from PIL import Image

from ..base import EnterpriseAIService, ServiceResult
try:
    from ..semantic_embeddings import semantic_embeddings_service
except ImportError:
    semantic_embeddings_service = None


class DeepfakeService(EnterpriseAIService):
    name = "deepfake"

    def is_available(self) -> bool:
        try:
            import cv2  # noqa: F401
            from PIL import Image  # noqa: F401
        except ImportError:
            return False
        return True

    def status(self) -> dict[str, Any]:
        return {
            "module": self.name,
            "available": self.is_available(),
            "capabilities": [
                "ai_edit_heuristics",
                "clip_zero_shot_ai_generation",
                "ela_analysis",
                "noise_inconsistency",
                "background_replacement_hint",
            ],
        }

    def _ela_score(self, rgb: np.ndarray) -> float:
        import cv2

        pil = Image.fromarray(rgb)
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=90)
        recompressed = np.array(Image.open(io.BytesIO(buf.getvalue())).convert("RGB"))
        diff = cv2.absdiff(rgb, recompressed)
        gray = cv2.cvtColor(diff, cv2.COLOR_RGB2GRAY)
        return float(gray.mean()) / 255.0

    def _noise_inconsistency(self, gray: np.ndarray) -> float:
        import cv2

        h, w = gray.shape[:2]
        if h < 64 or w < 64:
            return 0.0
        blocks = []
        bs = 32
        for y in range(0, h - bs, bs):
            for x in range(0, w - bs, bs):
                patch = gray[y : y + bs, x : x + bs].astype(np.float32)
                blocks.append(patch.std())
        if len(blocks) < 4:
            return 0.0
        arr = np.array(blocks)
        return float(arr.std() / max(arr.mean(), 1.0))

    def analyze(self, media_bytes: bytes, mime_type: str = "") -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV not available", self.name)
        if mime_type and not mime_type.startswith("image/"):
            return ServiceResult(True, {
                "aiEdited": False,
                "confidence": 0,
                "reason": "Non-image media — AI edit scan skipped",
            }, "OK", self.name)

        import cv2

        try:
            rgb = np.array(Image.open(io.BytesIO(media_bytes)).convert("RGB"))
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

            ela = self._ela_score(rgb)
            noise_inc = self._noise_inconsistency(gray)

            reasons: list[str] = []
            score = 0.0
            hard_hits = 0
            ai_generated = False
            generated_confidence = 0.0
            clip_result: dict[str, Any] | None = None

            # Elevated ELA = possible edit / re-export (not missing EXIF)
            if ela > 0.12:
                reasons.append("JPEG recompression artifacts (possible edit/export)")
                score += min(0.35, ela * 1.6)
                hard_hits += 1
            elif ela > 0.08:
                reasons.append("Mild JPEG recompression residual")
                score += min(0.15, ela)

            if noise_inc > 0.55:
                reasons.append("Inconsistent noise patterns across regions")
                score += min(0.30, noise_inc * 0.35)
                hard_hits += 1

            # Smooth background vs sharp foreground (inpaint / replace hint) — strict gate
            blur = cv2.GaussianBlur(gray, (15, 15), 0)
            edge = cv2.Canny(gray, 60, 140)
            fg = edge > 0
            if fg.sum() > 500:
                bg_noise = float(blur[~fg].std()) if (~fg).sum() > 0 else 0.0
                fg_noise = float(gray[fg].std()) if fg.sum() > 0 else 0.0
                if fg_noise > 8 and bg_noise < fg_noise * 0.30:
                    reasons.append("Background much smoother than foreground (possible replacement)")
                    score += 0.18
                    hard_hits += 1

            edge_density = float(fg.sum()) / float(gray.size)

            # CLIP is the primary AI-generation signal — heuristics alone must not dominate
            if semantic_embeddings_service and semantic_embeddings_service.is_available():
                clip = semantic_embeddings_service.classify_ai_generation(media_bytes)
                if clip.success:
                    clip_result = clip.data
                    generated_confidence = float(clip.data.get("aiGeneratedConfidence", 0.0) or 0.0)
                    ai_generated = bool(clip.data.get("aiGenerated", False))
                    top_prompt = clip.data.get("topPrompt")
                    if generated_confidence >= 0.58:
                        reasons.append(
                            f'CLIP zero-shot matched "{top_prompt}" ({round(generated_confidence * 100, 1)}%)'
                        )
                        hard_hits += 1
                    score += min(0.40, generated_confidence * 0.40)

            # Confusion-matrix style gate: need CLIP agreement OR ≥2 hard forensic hits
            # Clean photos without elevated ELA must NOT be labeled edited
            ai_edited = False
            if ela > 0.12 and hard_hits >= 2 and score >= 0.50:
                ai_edited = True
            elif generated_confidence >= 0.58 and ela > 0.10 and score >= 0.45:
                ai_edited = True
            elif hard_hits >= 3 and score >= 0.70:
                ai_edited = True

            confidence = round(min(0.95, score if ai_edited else min(score, 0.22)), 4)

            return ServiceResult(True, {
                "aiEdited": ai_edited,
                "aiGenerated": ai_generated or generated_confidence >= 0.62,
                "aiGeneratedConfidence": round(generated_confidence, 4),
                "generatedConfidencePercent": round(generated_confidence * 100, 1),
                "confidence": confidence,
                "confidencePercent": round(confidence * 100, 1),
                "reason": reasons[0] if reasons else "No strong AI-edit indicators",
                "reasons": reasons,
                "signals": {
                    "elaScore": round(ela, 4),
                    "noiseInconsistency": round(noise_inc, 4),
                    "edgeDensity": round(edge_density, 4),
                },
                "clip": clip_result,
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)


deepfake_service = DeepfakeService()
