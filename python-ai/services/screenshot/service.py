"""Screenshot / screen-capture analysis (placeholder)."""
from __future__ import annotations

from typing import Any

from ..base import EnterpriseAIService, ServiceResult


class ScreenshotService(EnterpriseAIService):
    name = "screenshot"

    def is_available(self) -> bool:
        try:
            from PIL import Image  # noqa: F401
            import imagehash  # noqa: F401
        except ImportError:
            return False
        return True

    def status(self) -> dict[str, Any]:
        return {
            "module": self.name,
            "available": self.is_available(),
            "phase": "infrastructure",
            "capabilities": [
                "screenshot_detection",
                "ui_region_hash",
                "leak_screenshot_match",
            ],
        }

    def analyze(self, image_bytes: bytes) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "Pillow/ImageHash not available", self.name)
        return self.not_implemented("analyze")


screenshot_service = ScreenshotService()
