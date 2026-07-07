# PINIT-DNA — File Type Security Matrix

**Document version:** 1.0  
**Primary reference:** `src/config/supported-file-types.ts`, `src/services/universal-file-router.ts`

---

## 1. Supported File Types (Implemented)

All types below have `engineStatus: 'LIVE'` in configuration.

| File Type | Extensions | Max Size | Engine |
|-----------|------------|----------|--------|
| IMAGE | .jpg, .jpeg, .png, .webp, .tiff, .gif, .bmp | 20 MB | `DnaOrchestrator` |
| TXT | .txt, .log, .md | 10 MB | `engines/txt/txt-dna-engine.ts` |
| CSV | .csv | 50 MB | `engines/csv/csv-dna-engine.ts` |
| JSON | .json | 10 MB | `engines/json/json-dna-engine.ts` |
| PDF | .pdf | 50 MB | `engines/pdf/pdf-dna-engine.ts` |
| DOCX | .docx | 50 MB | `engines/docx/docx-dna-engine.ts` |
| PPTX | .pptx | 100 MB | `engines/pptx/pptx-dna-engine.ts` |
| ZIP | .zip | 500 MB | `engines/zip/zip-dna-engine.ts` |
| VIDEO | .mp4, .mov, .avi, .mkv, .webm | 500 MB | `engines/video/video-dna-engine.ts` |
| AUDIO | .mp3, .wav, .flac, .aac, .m4a | 100 MB | `engines/audio/audio-dna-engine.ts` |

---

## 2. Security Matrix by File Type

### 2.1 Images

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1–L15 | Implemented | Full 15-layer image pipeline |
| L2 algorithm | Sobel edge detection | `layer2.structural.ts` |
| L3 algorithm | DCT pHash64/256 | Best for crop/compress derivatives |
| L6 algorithm | LSB steganography + HMAC | |
| Tracking (TEP / provenance) | Implemented | When vaulted and exported via protected download or share |
| Tamper detection | Implemented | Full tamper registry in investigation; crop/resize/compress/screenshot heuristics |
| Ownership recovery | Implemented | Unified investigation + vector search + local patch DNA |
| Watermark (vault store) | Implemented | DCT + DWT + tail via `vault-watermark-engine.service.ts` |
| Watermark (TEP export) | Implemented | EXIF/metadata + structural tail |
| Certificate | Implemented | `certificate.service.ts` |
| Investigation | Implemented | Full unified investigation pipeline |
| Limitations | | Heavy crop (>60%) may reduce DNA score; camera scan quality affects probe DNA |

### 2.2 Videos

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1–L15 | Implemented | Universal video engine (baseline) |
| L2–L5 | Partially Implemented | Container/box/chunk SimHash; ffprobe/keyframe pHash named in config but not in engine |
| Tracking | Implemented | Same provenance/TEP as other types when vaulted |
| Tamper detection | Implemented | Video re-encoding detector in tamper analysis |
| Ownership recovery | Implemented | Investigation supported; performance slower on large files |
| Watermark | Partially Implemented | Binary tail watermark; limited metadata embed |
| Certificate | Implemented | |
| Limitations | | 500 MB max; deep compare timeouts on Render free tier; no frame-level pHash yet |

### 2.3 PDF

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1–L15 | Implemented | Universal PDF engine |
| L2–L6 | Implemented | Page layout, text SimHash, metadata, HMAC |
| Tracking | Implemented | TEP metadata embed in PDF export |
| Tamper detection | Implemented | OCR/metadata/format conversion detectors |
| Ownership recovery | Implemented | Investigation + vault scan-verify |
| Watermark | Implemented | PDF metadata + invisible page text (`watermark.service.ts`) |
| Certificate | Implemented | |
| Limitations | | Scanned PDFs depend on OCR quality |

### 2.4 Documents (TXT, CSV, JSON, DOCX, PPTX)

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1–L15 | Implemented | Per-type universal engines |
| L1–L6 storage | `universalFingerprints` JSON + L7–L15 tables | |
| Tracking | Implemented | Provenance events when vaulted |
| Tamper detection | Implemented | OCR changes, format conversion |
| Ownership recovery | Implemented | Investigation supported |
| Watermark | Partial | DOCX: custom XML; TXT/CSV: pass-through on share export |
| Certificate | Implemented | |
| Limitations | | Plain TXT has weaker perceptual matching than images |

### 2.5 Audio

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1–L15 | Implemented | Universal audio engine |
| L3 | Partially Implemented | Chunk SimHash + ID3; Chromaprint listed in config but not implemented |
| Tracking | Implemented | TEP binary tail |
| Tamper detection | Implemented | Audio re-encoding detector |
| Ownership recovery | Implemented | Investigation supported |
| Watermark | Partial | Binary tail only |
| Certificate | Implemented | |
| Limitations | | Re-encoded/transcoded audio reduces match confidence |

### 2.6 ZIP

| Capability | Status | Notes |
|------------|--------|-------|
| DNA layers L1–L15 | Implemented | Directory tree + entry SimHash |
| Tracking | Implemented | `.pinit/` manifest in ZIP comment when vault watermarked |
| Tamper detection | Partial | Archive structure changes detectable; inner file edits may vary |
| Ownership recovery | Implemented | Investigation on archive fingerprint |
| Watermark | Partial | ZIP comment + hidden manifest |
| Certificate | Implemented | |
| Limitations | | 500 MB max; inner file replacement changes fingerprint |

---

## 3. Future Supported Formats

| Format | Status | Notes |
|--------|--------|-------|
| XLSX | Planned | Not in `SUPPORTED_FILE_TYPES` registry |
| Additional image RAW formats | Planned | Not registered |
| Email (.eml, .msg) | Planned | Not registered |
| Additional video codecs | Planned | Enhancement noted in video engine comments |

Non-`LIVE` types would throw: *"DNA engine for X is not yet available"* from `universal-file-router.ts`.

---

## 4. Cross-Cutting Capabilities

| Capability | Images | Video | PDF | Documents | Audio | ZIP |
|------------|--------|-------|-----|-----------|-------|-----|
| Vault AES-256-GCM encryption | Yes | Yes | Yes | Yes | Yes | Yes |
| Supabase Storage persistence | Yes | Yes | Yes | Yes | Yes | Yes |
| Share links (Smart Links) | Yes | Yes | Yes | Yes | Yes | Yes |
| Protected Download (TEP) | Yes | Yes | Yes | Yes | Yes | Yes |
| Unified Investigation | Yes | Yes | Yes | Yes | Yes | Yes |
| Monitoring / Crawler enrollment | Yes | Partial | Partial | Partial | Partial | Partial |
| Semantic AI search | Yes | Yes | Yes | Yes | Yes | Yes |
| Location tracking (custody) | Optional GPS at generation | Same | Same | Same | Same | Same |

---

## 5. DNA Layer Availability by Type

| Layer | Image | Video | PDF | DOCX/PPTX/TXT/CSV/JSON | Audio | ZIP |
|-------|-------|-------|-----|------------------------|-------|-----|
| L1–L6 (content) | Full image algorithms | Universal engine | Universal | Universal | Universal | Universal |
| L7–L10 (context) | Yes | Yes | Yes | Yes | Yes | Yes |
| L11–L15 (advanced) | Yes (if owner) | Yes (if owner) | Yes (if owner) | Yes (if owner) | Yes (if owner) | Yes (if owner) |

Probe DNA during investigation generates L1–L6 (and L7–L10 where applicable) **without** L11–L15 unless owner context exists on probe path.

---

## 6. Known Limitations (All Types)

1. **Web application** — cannot track files after download unless recovered via investigation or PINIT-controlled viewer.
2. **WhatsApp sharing** — no automatic detection of WhatsApp forwarding; recompression may be inferred during investigation preprocessing.
3. **Free-tier Render** — cold starts cause 30–90 second delays; investigation timeouts configured in `investigation-performance.ts`.
4. **DNA immutability** — lifecycle events never modify stored DNA; corrections require new DNA generation.
5. **TEP expiry** — stored in database but not enforced at extraction time (Not Yet Implemented).

---

*End of document*
