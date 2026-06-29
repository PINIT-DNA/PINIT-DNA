"""Computer vision — feature extraction, similarity, perceptual hashing (placeholder)."""
from __future__ import annotations

from typing import Any

from ..base import EnterpriseAIService, ServiceResult


class ComputerVisionService(EnterpriseAIService):
    name = "computer_vision"

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
            "phase": "infrastructure",
            "capabilities": [
                "feature_extraction",
                "image_similarity",
                "perceptual_hash",
                "metadata_analysis",
            ],
        }

    def extract_features(self, image_bytes: bytes) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)
        return self.not_implemented("extract_features")

    def compare_images(self, a: bytes, b: bytes) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)
        return self.not_implemented("compare_images")


computer_vision_service = ComputerVisionService()
