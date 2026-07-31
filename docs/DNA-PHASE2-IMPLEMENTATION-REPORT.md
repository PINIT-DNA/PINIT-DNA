# PINIT-DNA — Phase 2 Enterprise Forensic DNA Enhancement Report

**Version:** 2.2 Phase 2 Forensic Pack  
**Date:** 29 June 2026  
**Status:** Implemented (modular, feature-flagged, backward compatible)

---

## Executive Summary

Phase 2 extends the existing v2.1 DNA enhancement pack with OCR DNA, Video/Audio DNA, Screenshot/Screen Recording detection, adaptive weighted scoring, DNA explanation, evidence confidence, self-learning profiles, transformation history, cross-media detection, and lightweight DNA APIs for the upcoming Internet Intelligence Engine.

**No existing APIs, user flows, database schema, or DNA records were broken.** All Phase 2 behavior requires `DNA_ENHANCEMENTS_ENABLED=true` **and** `DNA_PHASE2_ENABLED=true`.

---

## 1. Modules Enhanced

| Module | Change |
|--------|--------|
| `dna-enhancement-bundle.service.ts` | Builds v2.2 bundle with OCR/Video/Audio/Screenshot/ScreenRecording |
| `dna.orchestrator.ts` | Passes mimeType/tempPath to enhancement builder (IMAGE upload) |
| `universal-file-router.ts` | Phase 2 bundle for VIDEO/AUDIO/DOCUMENT after engine run |
| `dna.verifier.ts` | Adaptive scoring, explanation, evidence confidence, cross-media, history |
| `comparison-engine.ts` | Tamper vector (from Phase 1, unchanged) |
| `weighted-dna-scoring.service.ts` | Extended with metadata_extended (Phase 1) |
| `ocr.service.ts` | **Reused** — not replaced |

---

## 2. New Forensic Modules (Phase 2)

| Module | Purpose |
|--------|---------|
| `src/config/dna-phase2.ts` | Phase 2 feature flags |
| `ocr-dna.service.ts` | OCR SHA256, SimHash, semantic/layout fingerprints |
| `video-dna-enhancements.service.ts` | Keyframes, scenes, motion, GOP, frame pHashes |
| `audio-dna-enhancements.service.ts` | Spectrogram, Chromaprint, MFCC proxy, voice/noise |
| `screenshot-dna.service.ts` | UI layout, aspect ratio, font, screen artifacts |
| `screen-recording-dna.service.ts` | Frame sequence, motion, playback signature |
| `media-tools.service.ts` | FFmpeg/ffprobe/fpcalc with temp-file fallback |
| `adaptive-scoring.service.ts` | Media-profile weights (image/video/audio/document) |
| `dna-explanation.service.ts` | Human-readable match explanation |
| `evidence-confidence.service.ts` | Ownership, evidence, legal confidence scores |
| `self-learning-dna.service.ts` | Optional transformation profile learning |
| `transformation-history.service.ts` | Variant lineage in JSON |
| `cross-media-detection.service.ts` | Video→Screenshot, PDF→Image, etc. |
| `lightweight-dna.service.ts` | Fast fingerprints for crawler integration |
| `lightweight-dna.controller.ts` | REST APIs for intelligence engine |

---

## 3. Existing Layers Improved

| Layer | Phase 2 Addition |
|-------|------------------|
| L1 Cryptographic | Unchanged (Phase 1 SHA3/BLAKE3/chunk) |
| L2–L4 Image | Unchanged (Phase 1 multi-scale/BM/LAB) |
| L5 Metadata | Unchanged (Phase 1 extended EXIF) |
| L6 Steganography | Unchanged |
| **OCR (new bundle key)** | Generated at upload, not just compare |
| **Video engine supplement** | Enhancement bundle keyframes beyond binary L1–L6 |
| **Audio engine supplement** | Chromaprint/spectral beyond music-metadata |

---

## 4. How OCR DNA Works

1. On upload (when Phase 2 OCR flag ON), `OcrService.extractText()` runs via Tesseract.js
2. Extracted text produces:
   - `ocrSha256` — exact text hash
   - `ocrSimHash` — 64-bit SimHash (minor OCR noise tolerant)
   - `semanticFingerprint` — top unique words hash
   - `layoutFingerprint` — line length/word-count profile
   - `confidence` + `wordCount`
3. Stored in `universalFingerprints.enhancements.ocr`
4. Verify compares probe OCR bundle vs stored; adaptive scoring weights OCR at 15% (images) or 45% (documents)

---

## 5. How Video DNA Works

1. Detects FFmpeg availability via `media-tools.service.ts`
2. **With FFmpeg:** extracts up to 8 keyframe JPEGs → SHA256 + BM perceptual hashes, scene transition hashes, ffprobe FPS
3. **Without FFmpeg (Render default):** binary chunk keyframe hashes + motion/GOP fingerprints from raw bytes
4. Stores: `keyframeHashes`, `sceneFingerprints`, `motionFingerprint`, `framePHashes`, `gopFingerprint`, `audioFingerprint`
5. Verify uses set-overlap scoring on keyframes + motion/GOP similarity

---

## 6. How Audio DNA Works

1. **Chromaprint:** uses `fpcalc` when installed; SimHash fallback on raw buffer otherwise
2. **Spectrogram fingerprint:** 32-band energy profile from PCM (FFmpeg extract) or raw bytes
3. **MFCC proxy:** 13-frame mean coefficient SimHash
4. **Voice embedding proxy:** low/mid/high band energy profile
5. **Noise fingerprint:** variance profile of sample window
6. Stored in `enhancements.audio`; verify uses chromaprint + spectral scoring

---

## 7. How Screenshot DNA Works

1. Uses Sharp for 64×64 UI layout band hash (horizontal row brightness pattern)
2. Aspect ratio profile (e.g. `16:9`), display scaling vs 1080p reference
3. Font/edge fingerprint via Sobel-like convolution on 32×32
4. Screen artifact fingerprint from channel mean/stdev
5. Links OCR SimHash when text present
6. `screenshotLikelihood` heuristic for common display ratios

---

## 8. How Screen Recording DNA Works

1. Composes Video DNA keyframe sequence + Audio DNA fingerprint
2. `frameSequenceFingerprint` — hash of keyframe chain
3. `playbackSignature` — SimHash of keyframe order
4. `motionSignature` — motion fingerprint + FPS
5. `recordingLikelihood` from FPS + motion heuristics
6. Supports cropped/re-encoded/low-FPS via partial keyframe overlap scoring

---

## 9. How Adaptive Scoring Works

Media profile auto-detected from MIME/fileType:

| Profile | Weight distribution |
|---------|---------------------|
| **Image** | Perceptual 40%, Semantic 30%, OCR 15%, Metadata 5%, Identity 10% |
| **Document** | OCR 45%, Semantic 25%, Crypto 15%, Metadata 10%, Identity 5% |
| **Video** | Frame 40%, Audio 35%, Identity 15%, Metadata 10% |
| **Audio** | Audio 50%, Semantic 20%, Crypto 15%, Metadata 10%, Identity 5% |

Falls back to Phase 1 weighted scoring when `DNA_P2_ADAPTIVE_SCORE=false`.

---

## 10. How DNA Explanation Works

Returns structured explanation in verify `forensic.explanation`:

```
Matched because: SHA256, Perceptual, Watermark, OCR
Not matched: Metadata removed
Overall Confidence: 96.8%
```

Each line includes layer label, pass/fail, score percentage.

---

## 11. How Evidence Confidence Works

Generates investigation scores in `forensic.evidenceConfidence`:

| Score | Meaning |
|-------|---------|
| ownershipScore | Match + steganography + exact crypto |
| evidenceScore | Perceptual + OCR + overall match |
| identityScore | Steganography/identity binding |
| tamperScore | Based on tamper vector severity |
| certificateScore | 85 if certificate linked, 40 otherwise |
| trustScore | Weighted composite |
| legalConfidence | Trust + certificate + tamper inverse |

---

## 12. How Self-Learning DNA Works

**Optional** (`DNA_P2_SELF_LEARNING=false` by default):

1. After each verify, stores tamper vector + layer score pattern in `universalFingerprints.selfLearning`
2. Max 200 profiles per DNA record
3. Future verifications get up to +5% confidence boost when pattern matches learned profile
4. No ML training — pattern matching only

---

## 13. Performance Comparison

| Operation | v2.1 OFF | v2.1 ON (image) | v2.2 ON (image) | v2.2 ON (video) |
|-----------|----------|-----------------|-----------------|-----------------|
| DNA generate | Baseline | +150–400ms | +400–800ms (OCR lazy) | +500ms–2s |
| DNA verify | Baseline | +100–250ms | +150–350ms | +200–500ms |
| Lightweight API | N/A | N/A | +50–200ms | +200–800ms |

OCR is the main cost on images — use `DNA_P2_OCR_LAZY=true` (default) to skip when no text detected early.

FFmpeg/Chromaprint add latency only when binaries are installed; pure-JS fallbacks are fast.

---

## 14. Backward Compatibility Verification

| Check | Status |
|-------|--------|
| Flags OFF (default) | Identical to pre-Phase 2 |
| Legacy v2.1 bundles | Parse and verify normally |
| No `enhancements.ocr/video/audio` on old records | Graceful — those layers skipped in scoring |
| Prisma schema | ✅ No migration |
| `/dna/generate`, `/compare`, `/:id/verify` | ✅ Same response shape + optional fields |
| Vault, certificates, share tracking | ✅ Untouched |

---

## 15. API Compatibility

| Endpoint | Impact |
|----------|--------|
| `POST /dna/generate` | Unchanged; v2.2 bundle in JSON when flags ON |
| `POST /dna/:id/verify` | Additive `forensic.explanation`, `evidenceConfidence`, `crossMedia`, `transformationHistory` |
| `POST /dna/compare` | Unchanged (+ Phase 1 `enhancedForensic`) |
| **NEW** `POST /dna/generate-lightweight-dna` | Feature-flagged |
| **NEW** `POST /dna/compare-lightweight-dna` | Feature-flagged |
| **NEW** `POST /dna/extract-image-fingerprint` | Feature-flagged |
| **NEW** `POST /dna/extract-video-fingerprint` | Feature-flagged |
| **NEW** `POST /dna/extract-audio-fingerprint` | Feature-flagged |

New routes return **503** when Phase 2 lightweight API flag is OFF.

---

## 16. Database Changes

**None.** All Phase 2 data stored in existing JSON columns:

- `dna_records.universalFingerprints.enhancements` (v2.2 bundle)
- `dna_records.universalFingerprints.selfLearning` (optional)
- `dna_records.universalFingerprints.transformationHistory` (optional)

---

## 17. Unit Test Results

```
tests/forensics/dna-enhancements.test.ts  — 6 passed (Phase 1)
tests/forensics/dna-phase2.test.ts        — 8 passed (Phase 2)
Total: 14 passed
```

Run: `npm test -- tests/forensics/`

---

## 18. Remaining Work Before Internet Intelligence & Crawler

| Item | Status |
|------|--------|
| Lightweight DNA APIs | ✅ Ready for crawler consumption |
| Full FFmpeg on Render | ⏳ Install in Docker/buildpack for production video keyframes |
| Chromaprint (fpcalc) on Render | ⏳ Optional native binary |
| CLIP/SigLIP embeddings | ⏳ Phase 3 (`DNA_L11_CLIP`) |
| Compare page UI for explanation/evidence | ⏳ Backend ready |
| Crawler service itself | ⏳ Not built (by design) |
| Bing/reverse-image integration | ⏳ Separate from DNA engine |
| pgvector embedding store | ⏳ Future |

---

## Enable Phase 2 (Production)

```env
DNA_ENHANCEMENTS_ENABLED=true
DNA_PHASE2_ENABLED=true
DNA_P2_OCR=true
DNA_P2_VIDEO=true
DNA_P2_AUDIO=true
DNA_P2_SCREENSHOT=true
DNA_P2_ADAPTIVE_SCORE=true
DNA_P2_EXPLANATION=true
DNA_P2_EVIDENCE=true
DNA_P2_LIGHTWEIGHT_API=true
```

Optional on server with FFmpeg installed:
```env
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
FPCALC_PATH=fpcalc
```

---

## Conclusion

Phase 2 delivers enterprise forensic capabilities — OCR-at-upload, rich media fingerprints, adaptive scoring, explainable verification, and crawler-ready lightweight APIs — **without redesigning** the 15-layer DNA engine or breaking existing PINIT workflows.

---

*End of Phase 2 implementation report*
