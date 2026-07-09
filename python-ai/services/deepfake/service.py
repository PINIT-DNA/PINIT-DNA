"""AI manipulation / synthetic edit detection (heuristic + optional model path)."""
from __future__ import annotations

import io
from typing import Any

import numpy as np
from PIL import Image

from ..base import EnterpriseAIService, ServiceResult


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

            if ela > 0.08:
                reasons.append("JPEG recompression artifacts (possible edit/export)")
                score += min(0.35, ela * 2)

            if noise_inc > 0.45:
                reasons.append("Inconsistent noise patterns across regions")
                score += min(0.30, noise_inc * 0.4)

            # Smooth background vs sharp foreground (inpaint / replace hint)
            blur = cv2.GaussianBlur(gray, (15, 15), 0)
            edge = cv2.Canny(gray, 60, 140)
            fg = edge > 0
            if fg.sum() > 100:
                bg_noise = blur[~fg].std() if (~fg).sum() > 0 else 0
                fg_noise = gray[fg].std() if fg.sum() > 0 else 0
                if bg_noise < fg_noise * 0.45:
                    reasons.append("Background smoother than foreground (possible replacement)")
                    score += 0.22

            ai_edited = score >= 0.35
            confidence = round(min(0.95, score + 0.1 if len(reasons) >= 2 else score), 4)

            return ServiceResult(True, {
                "aiEdited": ai_edited,
                "confidence": confidence,
                "confidencePercent": round(confidence * 100, 1),
                "reason": reasons[0] if reasons else "No strong AI-edit indicators",
                "reasons": reasons,
                "signals": {
                    "elaScore": round(ela, 4),
                    "noiseInconsistency": round(noise_inc, 4),
                },
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)


deepfake_service = DeepfakeService()
