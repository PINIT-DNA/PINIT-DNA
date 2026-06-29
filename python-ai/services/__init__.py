"""
PINIT Enterprise AI — modular service registry.

Each submodule is optional; unavailable modules disable only their own features.
"""
from __future__ import annotations

from typing import Any

from .audio import audio_service
from .computer_vision import computer_vision_service
from .deepfake import deepfake_service
from .embeddings import embeddings_service
from .ocr import ocr_service
from .screenshot import screenshot_service
from .video import video_service

ALL_SERVICES = [
    ocr_service,
    computer_vision_service,
    embeddings_service,
    video_service,
    audio_service,
    deepfake_service,
    screenshot_service,
]


def enterprise_services_status() -> list[dict[str, Any]]:
    return [svc.status() for svc in ALL_SERVICES]
