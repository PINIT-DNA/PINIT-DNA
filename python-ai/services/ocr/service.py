"""Enterprise OCR service — placeholder for Phase 2+ implementation."""
from __future__ import annotations

import shutil
from typing import Any

from ..base import EnterpriseAIService, ServiceResult


class OcrService(EnterpriseAIService):
    name = "ocr"

    def is_available(self) -> bool:
        try:
            import pytesseract  # noqa: F401
        except ImportError:
            return False
        return shutil.which("tesseract") is not None

    def status(self) -> dict[str, Any]:
        return {
            "module": self.name,
            "available": self.is_available(),
            "phase": "infrastructure",
            "capabilities": ["text_extraction", "document_ocr", "screenshot_text"],
        }

    async def extract_text(self, image_bytes: bytes, filename: str = "") -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OCR engine not available", self.name)
        return self.not_implemented("extract_text")


ocr_service = OcrService()
