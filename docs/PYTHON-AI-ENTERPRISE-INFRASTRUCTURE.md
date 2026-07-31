# PINIT Enterprise AI Service — Infrastructure Preparation

**Version:** `2.1.0-enterprise-prep`  
**Scope:** Python microservice only (`python-ai/`). No changes to Node backend APIs, database, frontend, DNA Engine, Vault, Watermarking, or Unified Investigation.

---

## Overview

This phase prepares the `python-ai` FastAPI sidecar for enterprise forensic AI capabilities. Existing endpoints (`/embed`, `/index`, `/search`, `/ocr`, etc.) are unchanged. New infrastructure includes:

- Expanded `requirements.txt` (additive only)
- `diagnostics.py` — startup module probes with non-fatal warnings
- Enhanced `GET /health` — Python version, module availability, GPU, service registry
- Modular `services/` placeholders for future algorithms

---

## Libraries

### Already present (unchanged)

| Package | Purpose | Used by today |
|---------|---------|---------------|
| `fastapi` | HTTP API framework | All endpoints |
| `uvicorn[standard]` | ASGI server | Process manager / Docker |
| `pydantic` | Request validation | All POST bodies |
| `httpx` | HTTP client | Internal / future crawlers |
| `python-multipart` | File uploads | `POST /ocr` |
| `sentence-transformers` | Semantic embeddings | `/embed`, `/index`, `/search`, `/search/hybrid` |
| `faiss-cpu` | Vector index | `/index`, `/search` |
| `numpy` | Numerical arrays | FAISS + embeddings |
| `Pillow` | Image I/O | `/ocr`, vision prep |
| `pytesseract` | OCR Python bindings | `POST /ocr` |

### Newly added

| Package | Purpose | Current PINIT use | Future use |
|---------|---------|-------------------|------------|
| `opencv-python` | CV pipelines | — | Feature extraction, screenshot analysis |
| `scikit-image` | Image processing | — | Perceptual metrics, tamper cues |
| `ImageHash` | Perceptual hashing | — | Screenshot / near-duplicate detection |
| `piexif` | EXIF read/write | — | Camera metadata forensics |
| `torch` | Deep learning runtime | — | Deepfake detection, custom models |
| `torchvision` | Vision models | — | Image classification / features |
| `transformers` | Hugging Face models | — | NLP + multimodal models |
| `timm` | Image model zoo | — | Enterprise CV models |
| `PyMuPDF` | PDF parsing | — | Document OCR / text extraction |
| `python-docx` | Word parsing | — | DOCX content indexing |
| `ffmpeg-python` | FFmpeg bindings | — | Video keyframe / audio decode |
| `librosa` | Audio analysis | — | Audio DNA / similarity |
| `soundfile` | Audio I/O | — | Waveform loading for librosa |

### Optional system binaries (not pip packages)

| Binary | Required for | Windows | Render/Docker |
|--------|--------------|---------|---------------|
| `tesseract` | OCR | [UB Mannheim build](https://github.com/UB-Mannheim/tesseract/wiki) | `apt install tesseract-ocr` (in Dockerfile) |
| `ffmpeg` | Video/audio | [ffmpeg.org](https://ffmpeg.org/download.html) | `apt install ffmpeg` (in Dockerfile) |

If a binary is missing, only that capability is disabled — the service still starts.

---

## Module layout

```
python-ai/
  config.py              # Service name / version constants
  diagnostics.py         # Startup probes + health extensions
  main.py                # Existing API (unchanged routes)
  services/
    ocr/                 # OCR placeholder
    computer_vision/     # CV / similarity placeholder
    embeddings/          # Embedding extensions placeholder
    video/               # Video analysis placeholder
    audio/               # Audio analysis placeholder
    deepfake/            # Synthetic media placeholder
    screenshot/          # Screenshot forensics placeholder
```

Each service exposes `is_available()`, `status()`, and stub methods returning `not_implemented` until future phases.

---

## Installation

### Windows (development)

```powershell
cd python-ai
python -m pip install --upgrade pip
pip install -r requirements.txt
```

**OCR (optional):** Install Tesseract and add to PATH.

**Video/audio (optional):** Install FFmpeg and add to PATH.

**Heavy ML note:** `torch` + `transformers` download large wheels. For embeddings-only dev you can install core deps first:

```powershell
pip install fastapi uvicorn[standard] sentence-transformers faiss-cpu numpy Pillow pytesseract python-multipart httpx pydantic
```

Missing optional packages produce startup warnings only.

### Render / Docker

The `python-ai/Dockerfile` installs system packages (`tesseract-ocr`, `ffmpeg`, `libsndfile1`, OpenCV GL libs) then `pip install -r requirements.txt`.

Deploy as a separate Render **Background Worker** or **Web Service** on port `8001` (or `7860` in Docker CMD). Point the Node backend via:

```env
AI_SERVICE_URL=http://localhost:8001
AI_SERVICE_PORT=8001
```

Local `npm run dev` auto-starts Python on 8001. On Render, set `AI_SERVICE_URL` to your external AI service only (no local spawn).

---

## Startup diagnostics

On boot, the service logs lines such as:

```
✓ FastAPI Loaded
✓ FAISS Loaded
⚠ OpenCV Unavailable (...)
⚠ Torch Unavailable (...)
```

Warnings do **not** crash the server unless a **required** core package (`fastapi`, `numpy`, `faiss`, `sentence-transformers`) is missing.

---

## Enhanced `GET /health`

Existing fields preserved (`status`, `service`, `version`, `model`, `dimension`, `indexed`, `timestamp`).

**Additive fields:**

| Field | Description |
|-------|-------------|
| `pythonVersion` | e.g. `3.11.x` |
| `ocrAvailable` | Tesseract + pytesseract ready |
| `opencvAvailable` | OpenCV importable |
| `torchAvailable` | PyTorch importable |
| `gpuAvailable` | CUDA or MPS available |
| `installedModules` | Map of probe key → bool |
| `moduleDetails` | Per-module detail strings |
| `enterpriseServices` | Placeholder service registry |
| `diagnosticWarnings` | List of non-fatal warnings |

---

## Production safety

| Missing | Effect |
|---------|--------|
| Torch / transformers / timm | Deepfake module disabled only |
| FFmpeg | Video module disabled only |
| Tesseract binary | OCR endpoint returns 503 (existing behaviour) |
| OpenCV / ImageHash | Computer vision + screenshot modules disabled |
| librosa | Audio module disabled |

Node.js backend continues normally if Python AI is unavailable (features degrade gracefully).

---

## Future capabilities enabled

| Capability | Service module | Dependencies |
|------------|----------------|----------------|
| Enterprise OCR pipelines | `services/ocr/` | pytesseract, tesseract, PyMuPDF |
| Image similarity / pHash | `services/computer_vision/` | OpenCV, ImageHash, scikit-image |
| Screenshot leak detection | `services/screenshot/` | Pillow, ImageHash |
| Video fingerprinting | `services/video/` | ffmpeg, torch (future) |
| Audio fingerprinting | `services/audio/` | librosa, soundfile |
| Deepfake / synthetic media | `services/deepfake/` | torch, transformers, timm |
| Crawler semantic intelligence | `services/embeddings/` | sentence-transformers, faiss |
| Document text for indexing | PyMuPDF, python-docx | Vault AI indexer (future) |

---

## Verification

Run diagnostics only (no server):

```powershell
cd python-ai
python -c "from diagnostics import run_startup_diagnostics; run_startup_diagnostics()"
```

Start service:

```powershell
python -m uvicorn main:app --host 0.0.0.0 --port 8001
curl http://localhost:8001/health
```

---

## Constraints honoured

- No API route changes (only additive `/health` fields)
- No database or Prisma changes
- No frontend changes
- No DNA / Vault / Watermark / Unified Investigation code changes
- No new forensic algorithms in this phase
