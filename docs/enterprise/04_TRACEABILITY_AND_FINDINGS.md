# PINIT-DNA — Traceability and Findings

**Document version:** 1.0  
**Purpose:** Answer — *At what level can a file found on the internet be traced back to its PINIT origin?*  
**Rule:** Only capabilities verified in code are marked Implemented. Others marked Planned or Not Applicable.

---

## 1. Traceability Model

PINIT-DNA separates two concepts:

| Concept | Description | Status |
|---------|-------------|--------|
| **DNA identity** | Immutable 15-layer fingerprint stored at generation | Implemented |
| **Custody events** | Append-only lifecycle log (download, share, investigation) | Implemented |
| **Post-download tracking** | Continuous monitoring of file on external devices | Not Yet Implemented (web limitation) |

A file recovered from the internet can be traced **only when it is uploaded back into PINIT Investigation** or opened through a PINIT-controlled mechanism that reports to the server.

---

## 2. Traceability Matrix — Images

| Capability | Current | Future | Implementation |
|------------|---------|--------|----------------|
| Recover owner | Yes — via investigation match + vault record | Enhanced with native app telemetry | `unified-investigation.orchestrator.ts`, vault ownership |
| Recover vault ID | Yes — when candidate accepted | Same | Candidate ranking + manifest |
| Recover certificate | Yes — when certificate exists for DNA record | Same | `certificate.service.ts` |
| Recover DNA record | Yes — authoritative compare locks DNA ID | Same | Authoritative DNA compare |
| Recover watermark | Partial — TEP tail, EXIF, LSB, vault identity token | Stronger DCT embed | `tep.service.ts`, `watermark.service.ts`, `vault-watermark-engine.service.ts` |
| Recover timeline | Yes — provenance + share access logs | Full event bus | `forensic-provenance.service.ts`, `buildTimeline()` |
| Recover download history | Yes — for protected downloads recorded server-side | Native app offline sync | `download-event.service.ts`, provenance `DOWNLOADED` |
| Detect WhatsApp recompression | Partial — preprocessing simulates WhatsApp JPEG; investigation may flag | Dedicated messenger classifier | `forensic-image-preprocessor.service.ts` (whatsapp_compress variant) |
| Detect screenshot | Partial — screenshot DNA enhancement + tamper detector | ML screenshot classifier | `screenshot-dna.service.ts`, tamper registry |
| Detect crop | Yes — partial; local patch DNA rescue for heavy crops | Multi-scale patch index | `candidate-ranking-engine.service.ts`, preprocessor `center_crop` variant |
| Detect resize | Yes — via L3 perceptual + tamper Resize detector | Same | `comparison-engine.ts`, tamper analysis |
| Detect metadata removal | Yes — L5 mismatch + Metadata Removed tamper flag | Same | Tamper analysis |
| Detect AI generation | Partial — L11 heuristic + AI Generated tamper flag | ML deepfake model | `layers-11-15.service.ts`, tamper analysis |
| Detect compression | Yes — L3/L1 delta + Compression tamper flag | Same | Tamper analysis, derivative scoring |

**Internet-found image without PINIT interaction:** No automatic trace. Owner recovery requires upload to Investigation.

---

## 3. Traceability Matrix — Videos

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes — via investigation | Same |
| Recover vault / DNA / certificate | Yes — when match found | Same |
| Recover watermark | Partial — binary tail only | Frame-level watermark |
| Recover timeline / downloads | Yes — server-side events only | Native viewer events |
| Detect re-encoding | Yes — Video Re-encoding tamper detector | ffprobe-based analysis |
| Detect crop / resize | Partial — container-level only | Per-frame analysis (Planned) |
| Detect WhatsApp | Not Applicable directly | Messenger-specific heuristics (Planned) |
| Detect screenshot | Partial — screen recording detector | Same |
| Detect AI generation | Partial — L11 heuristic | ML model (Planned) |

**Limitation:** Video engine uses binary header/chunk SimHash baseline; frame-level pHash not yet implemented.

---

## 4. Traceability Matrix — PDF

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes — via investigation | Same |
| Recover vault / DNA / certificate | Yes | Same |
| Recover watermark | Yes — PDF metadata + invisible text | Same |
| Recover timeline / downloads | Yes — server-side | Same |
| Detect metadata removal | Yes | Same |
| Detect OCR/text changes | Yes — OCR Changes tamper flag | Same |
| Detect crop / resize | Not Applicable (page-level reflow) | Page hash comparison (Planned) |
| Detect compression | Partial — format conversion flag | Same |
| Detect AI generation | Partial — heuristic | Planned |

---

## 5. Traceability Matrix — Documents (TXT, CSV, JSON, DOCX, PPTX)

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes — via investigation | Same |
| Recover vault / DNA / certificate | Yes | Same |
| Recover watermark | Partial — DOCX custom XML; TXT pass-through | Full zero-width encoding |
| Recover timeline / downloads | Yes — server-side | Same |
| Detect text/OCR changes | Yes — for PDF/DOCX paths | Same |
| Detect metadata removal | Partial | Same |
| Detect crop / resize / screenshot | Not Applicable | N/A for text documents |
| Detect compression | Partial — format conversion | Same |

---

## 6. Traceability Matrix — Audio

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes — via investigation | Same |
| Recover vault / DNA / certificate | Yes | Same |
| Recover watermark | Partial — binary tail | Psychoacoustic embed (Planned) |
| Recover timeline / downloads | Yes — server-side | Same |
| Detect re-encoding | Yes — Audio Re-encoding tamper | Chromaprint (Planned) |
| Detect crop / resize / screenshot | Not Applicable | N/A |
| Detect AI generation | Partial — heuristic | Planned |

---

## 7. Traceability Matrix — ZIP

| Capability | Current | Future |
|------------|---------|--------|
| Recover owner | Yes — archive fingerprint match | Inner file extraction (Planned) |
| Recover vault / DNA / certificate | Yes | Same |
| Recover watermark | Partial — `.pinit/` manifest in archive | Same |
| Detect tampering | Partial — tree structure changes | Per-entry hash (Planned) |

---

## 8. What PINIT Can Prove Today

When a suspect file is uploaded to Unified Investigation and a match is found:

```
PROVEN (Implemented):
  - This file matches Vault ID X
  - DNA Record ID Y belongs to Owner Z
  - Certificate C was issued (if exists)
  - File was downloaded via Protected Download at time T from IP/location (if recorded)
  - File was shared via Smart Link (if recorded)
  - Tamper vectors detected on probe vs original
  - Investigation occurred at time T (provenance INVESTIGATED event)

NOT PROVEN (Web limitation):
  - Where the file travelled after download to WhatsApp/Telegram/email
  - Who opened the file on another person's device
  - Continuous GPS tracking of the file offline
  - Automatic detection of file appearing on arbitrary websites (requires Monitor enrollment)
```

---

## 9. Internet / Crawler Recovery

| Capability | Status | Reference |
|------------|--------|-----------|
| URL monitoring enrollment | Implemented | `monitoring.routes.ts`, `MonitorRecord` |
| Crawler filename search | Implemented | `filename-search.provider.ts` |
| Crawler detection provenance event | Not Yet Implemented | `CRAWLER_DETECTION` declared but no append call site |
| Automatic internet-wide search | Not Yet Implemented | Requires enrolled watch URLs |

---

## 10. TEP Re-Discovery

When a TEP-exported file is re-uploaded:

| Step | Status |
|------|--------|
| Extract TEP tail from file | Implemented — `tep.service.ts extractFromFile()` |
| Match to TrackedExportPackage | Implemented |
| Mark REDISCOVERED | Implemented — `duplicate-check.service.ts` |
| Block if TEP revoked | Not Yet Implemented |
| Append RECOVERED provenance event | Not Yet Implemented |

---

## 11. Summary Table

| File found on internet | Can trace to PINIT owner? | Condition |
|------------------------|---------------------------|-----------|
| Original PINIT file (unmodified) | High confidence | Upload to Investigation |
| Compressed/cropped derivative | Medium–High | Investigation + derivative scoring |
| WhatsApp-forwarded image | Medium | Recompression heuristics; no forward event |
| Screenshot of PINIT file | Low–Medium | Screenshot DNA + tamper flags |
| File never exported via PINIT | None | No embedded markers |
| File from protected download | High (if TEP intact) | TEP tail + investigation |
| File found by crawler | Medium | Only if monitor enrolled for that DNA |

---

*End of document*
