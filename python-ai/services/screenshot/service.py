"""Screenshot / platform UI detection."""
from __future__ import annotations

import io
import re
from typing import Any

import numpy as np
from PIL import Image

from ..base import EnterpriseAIService, ServiceResult

PHONE_ASPECTS = [(9 / 19.5, 0.04), (9 / 16, 0.04)]
COMMON_SCREEN = [(16 / 9, 0.06), (4 / 3, 0.06)]


class ScreenshotService(EnterpriseAIService):
    name = "screenshot"

    def is_available(self) -> bool:
        try:
            from PIL import Image  # noqa: F401
            import cv2  # noqa: F401
        except ImportError:
            return False
        return True

    def status(self) -> dict[str, Any]:
        return {
            "module": self.name,
            "available": self.is_available(),
            "capabilities": [
                "screenshot_detection",
                "platform_ui_detection",
                "status_bar_detection",
                "bezel_detection",
            ],
        }

    def _aspect_match(self, w: int, h: int, targets: list[tuple[float, float]]) -> bool:
        if w <= 0 or h <= 0:
            return False
        ratio = min(w, h) / max(w, h)
        return any(abs(ratio - t) <= tol for t, tol in targets)

    def _detect_status_bar(self, rgb: np.ndarray) -> bool:
        import cv2

        h, w = rgb.shape[:2]
        if h < 80:
            return False
        top = rgb[: max(24, h // 20), :, :]
        gray = cv2.cvtColor(top, cv2.COLOR_RGB2GRAY)
        std = float(gray.std())
        mean = float(gray.mean())
        # Uniform thin bar (iOS/Android status)
        return std < 28 and (mean < 60 or mean > 200)

    def _detect_bezel(self, gray: np.ndarray) -> bool:
        h, w = gray.shape[:2]
        margin = max(4, min(w, h) // 40)
        borders = [
            gray[:margin, :].mean(),
            gray[-margin:, :].mean(),
            gray[:, :margin].mean(),
            gray[:, -margin:].mean(),
        ]
        center = gray[margin : h - margin, margin : w - margin].mean()
        return sum(1 for b in borders if abs(b - center) > 35) >= 2

    def analyze(self, image_bytes: bytes) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)

        import cv2

        try:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            w, h = img.size
            rgb = np.array(img)
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

            signals: list[str] = []
            score = 0.0

            if self._aspect_match(w, h, PHONE_ASPECTS):
                signals.append("phone_aspect_ratio")
                score += 0.22

            if self._detect_status_bar(rgb):
                signals.append("status_bar")
                score += 0.28

            if self._detect_bezel(gray):
                signals.append("device_bezel")
                score += 0.18

            # High-frequency UI chrome at edges
            edges = cv2.Canny(gray, 40, 120)
            border_edges = (
                edges[: h // 12, :].mean()
                + edges[-h // 12 :, :].mean()
                + edges[:, : w // 12].mean()
                + edges[:, -w // 12 :].mean()
            ) / 4
            if border_edges > 12:
                signals.append("ui_chrome_edges")
                score += 0.15

            platform = "unknown"
            filename_hint = ""
            # Color heuristics for common apps
            top_mean = rgb[: h // 8, :, :].mean(axis=(0, 1))
            if top_mean[0] > 200 and top_mean[1] > 200 and top_mean[2] > 200:
                signals.append("light_header_ui")
                score += 0.08
                platform = "instagram_or_messenger"

            bottom = rgb[-h // 6 :, :, :]
            if bottom[:, :, 1].mean() > bottom[:, :, 0].mean() + 15:
                signals.append("green_accent_bottom")
                platform = "whatsapp"

            is_screenshot = score >= 0.35
            confidence = round(min(0.98, score + (0.1 if len(signals) >= 3 else 0)), 4)

            return ServiceResult(True, {
                "isScreenshot": is_screenshot,
                "confidence": confidence,
                "confidencePercent": round(confidence * 100, 1),
                "platform": platform if is_screenshot else "original_capture",
                "signals": signals,
                "evidence": "Screenshot indicators: " + ", ".join(signals) if signals else "No screenshot UI detected",
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)


screenshot_service = ScreenshotService()
