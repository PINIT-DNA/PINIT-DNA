"""Video analysis — keyframes, fingerprints, crawler hooks (placeholder)."""
from __future__ import annotations

import shutil
from typing import Any

from ..base import EnterpriseAIService, ServiceResult


class VideoService(EnterpriseAIService):
    name = "video"

    def is_available(self) -> bool:
        return shutil.which("ffmpeg") is not None or shutil.which("ffprobe") is not None

    def status(self) -> dict[str, Any]:
        return {
            "module": self.name,
            "available": self.is_available(),
            "phase": "infrastructure",
            "capabilities": ["keyframe_extract", "video_fingerprint", "temporal_hash"],
        }

    def analyze(self, video_bytes: bytes, filename: str = "") -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "FFmpeg not available on PATH", self.name)
        return self.not_implemented("analyze")


video_service = VideoService()
