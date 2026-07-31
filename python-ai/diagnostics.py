"""
PINIT Enterprise AI Service — startup dependency diagnostics.

Probes optional and core packages without crashing when modules are missing.
"""
from __future__ import annotations

import importlib.util
import logging
import platform
import shutil
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

log = logging.getLogger("pinit-dna-ai.diagnostics")


@dataclass
class ModuleProbe:
    key: str
    label: str
    import_name: str
    check: Optional[Callable[[], tuple[bool, str]]] = None
    optional: bool = True


@dataclass
class DiagnosticState:
    python_version: str = ""
    probes: dict[str, dict[str, Any]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def to_health_dict(self) -> dict[str, Any]:
        return {
            "pythonVersion": self.python_version,
            "modules": {k: v["available"] for k, v in self.probes.items()},
            "moduleDetails": self.probes,
            "ocrAvailable": self.probes.get("ocr", {}).get("available", False),
            "opencvAvailable": self.probes.get("opencv", {}).get("available", False),
            "torchAvailable": self.probes.get("torch", {}).get("available", False),
            "gpuAvailable": self.probes.get("gpu", {}).get("available", False),
            "warnings": self.warnings,
        }


_STATE = DiagnosticState(python_version=platform.python_version())


def _spec_exists(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _try_import(name: str) -> tuple[bool, str]:
    try:
        importlib.import_module(name)
        return True, "import ok"
    except Exception as exc:  # noqa: BLE001 — diagnostic only
        return False, str(exc)[:200]


def _check_tesseract() -> tuple[bool, str]:
    if not _spec_exists("pytesseract"):
        return False, "pytesseract package not installed"
    binary = shutil.which("tesseract")
    if not binary:
        return False, "pytesseract installed but tesseract binary not on PATH"
    return True, f"tesseract at {binary}"


def _check_ffmpeg() -> tuple[bool, str]:
    if not _spec_exists("ffmpeg"):
        return False, "ffmpeg-python not installed"
    binary = shutil.which("ffmpeg")
    if not binary:
        return False, "ffmpeg-python installed but ffmpeg binary not on PATH"
    return True, f"ffmpeg at {binary}"


def _check_gpu() -> tuple[bool, str]:
    if not _spec_exists("torch"):
        return False, "torch not installed"
    try:
        import torch

        if torch.cuda.is_available():
            return True, f"CUDA — {torch.cuda.get_device_name(0)}"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return True, "Apple MPS available"
        return False, "torch installed — CPU only"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)[:200]


PROBES: list[ModuleProbe] = [
    ModuleProbe("fastapi", "FastAPI", "fastapi", optional=False),
    ModuleProbe("uvicorn", "Uvicorn", "uvicorn", optional=False),
    ModuleProbe("numpy", "NumPy", "numpy", optional=False),
    ModuleProbe("faiss", "FAISS", "faiss", optional=False),
    ModuleProbe("sentence_transformers", "Sentence-Transformers", "sentence_transformers", optional=False),
    ModuleProbe("pillow", "Pillow", "PIL"),
    ModuleProbe("opencv", "OpenCV", "cv2"),
    ModuleProbe("skimage", "scikit-image", "skimage"),
    ModuleProbe("imagehash", "ImageHash", "imagehash"),
    ModuleProbe("piexif", "piexif", "piexif"),
    ModuleProbe("torch", "Torch", "torch"),
    ModuleProbe("torchvision", "TorchVision", "torchvision"),
    ModuleProbe("transformers", "Transformers", "transformers"),
    ModuleProbe("timm", "timm", "timm"),
    ModuleProbe("ocr", "OCR", "pytesseract", check=_check_tesseract),
    ModuleProbe("pymupdf", "PDF Engine (PyMuPDF)", "fitz"),
    ModuleProbe("docx", "DOCX Engine", "docx"),
    ModuleProbe("ffmpeg", "FFmpeg", "ffmpeg", check=_check_ffmpeg),
    ModuleProbe("librosa", "Librosa", "librosa"),
    ModuleProbe("soundfile", "SoundFile", "soundfile"),
    ModuleProbe("gpu", "GPU", "torch", check=_check_gpu),
]


def _probe_one(probe: ModuleProbe) -> dict[str, Any]:
    if probe.check:
        ok, detail = probe.check()
    else:
        ok, detail = _try_import(probe.import_name)

    entry = {
        "label": probe.label,
        "available": ok,
        "optional": probe.optional,
        "detail": detail,
    }
    if not ok and not probe.optional:
        _STATE.warnings.append(f"Required module unavailable: {probe.label} — {detail}")
    elif not ok:
        _STATE.warnings.append(f"Optional module unavailable: {probe.label} — {detail}")
    return entry


def run_startup_diagnostics() -> DiagnosticState:
    """Run all probes and print human-readable startup lines."""
    log.info("PINIT Enterprise AI — dependency diagnostics (Python %s)", _STATE.python_version)
    for probe in PROBES:
        entry = _probe_one(probe)
        _STATE.probes[probe.key] = entry
        mark = "✓" if entry["available"] else "⚠"
        level = log.info if entry["available"] else log.warning
        level("%s %s %s", mark, probe.label, "Loaded" if entry["available"] else f"Unavailable ({entry['detail']})")

    if _STATE.warnings:
        log.warning("%d module warning(s) — service starts with reduced capabilities", len(_STATE.warnings))
    else:
        log.info("All probed modules available")
    return _STATE


def get_diagnostic_state() -> DiagnosticState:
    return _STATE


def get_health_extensions() -> dict[str, Any]:
    """Extra fields merged into GET /health (backward compatible)."""
    state = _STATE
    if not state.probes:
        run_startup_diagnostics()
    ext = state.to_health_dict()
    ext["platform"] = {
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
    }
    return ext
