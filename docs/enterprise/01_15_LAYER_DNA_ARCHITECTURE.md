# PINIT-DNA — 15-Layer DNA Architecture

**Document version:** 1.0  
**Source of truth:** Codebase analysis (not marketing claims)  
**Primary references:** `src/constants/dna-layer-registry.ts`, `src/services/dna.orchestrator.ts`, `src/services/universal-file-router.ts`, `prisma/schema.prisma`

---

## 1. Overview

PINIT-DNA assigns every supported file a **15-layer forensic identity**. Layers L1–L10 are core content and context fingerprints. Layers L11–L15 are advanced registry layers generated only when an authenticated owner (`ownerUserId`) is present at generation time.

Two related models exist in code:

| Model | Purpose | Location |
|-------|---------|----------|
| Generation registry | DNA creation, storage, comparison | `src/constants/dna-layer-registry.ts` |
| Investigation report map (`15-layer-v1`) | Unified investigation UI and reports | `src/types/dna-layer.types.ts`, `dna-layer-standardization.service.ts` |

**Constants:** `TOTAL_DNA_LAYERS = 15`, `CORE_DNA_LAYERS = 10`, `ADVANCED_DNA_LAYERS = 5` (`src/constants/dna-layers.ts`).

---

## 2. Summary Table

| Layer | Name | Primary Algorithm | Images | Video | PDF | Documents | Audio | Security Level | Immutable | Status |
|-------|------|-------------------|--------|-------|-----|-----------|-------|----------------|-----------|--------|
| L1 | Cryptographic | SHA-256 (+ optional BLAKE3 for images) | Yes | Yes | Yes | Yes | Yes | High | Yes | Implemented |
| L2 | Structural | Sobel edges (image) / type-specific structure hash | Yes | Yes | Yes | Yes | Yes | Medium–High | Yes | Implemented |
| L3 | Perceptual | DCT pHash (image) / SimHash (universal) | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L4 | Semantic | RGB/HSV histograms / distribution fingerprints | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L5 | Metadata | EXIF/IPTC/XMP / container metadata hash | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L6 | Signature | LSB steganography + HMAC (image) / HMAC over L1–L5 | Yes | Yes | Yes | Yes | Yes | High | Yes | Implemented |
| L7 | Behavioral | SHA-256 behavior bundle (filename, size, session) | Yes | Yes | Yes | Yes | Yes | Low–Medium | Yes | Implemented |
| L8 | Relationship | SHA-256 graph hash (duplicate linkage) | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L9 | Origin | SHA-256 origin bundle (IP, geo, user agent) | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented (geo when provided) |
| L10 | Evolution | Merkle root over mutation log | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L11 | Deepfake Detection | Heuristic byte/pixel analysis | Yes | Partial | Yes | Yes | Yes | Low–Medium | Yes | Partially Implemented |
| L12 | Invisible Watermark | DCT frequency watermark record (hash stored) | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Partially Implemented |
| L13 | Chain of Custody | Legal custody chain JSON + evidence hash | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Implemented |
| L14 | ZK Ownership Proof | Hash commitment + AES-GCM secret | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Partially Implemented |
| L15 | Biometric Bind | SHA-256 of face embedding or NOT_REGISTERED | Yes | Yes | Yes | Yes | Yes | Medium | Yes | Partially Implemented |

**Notes on “Documents”:** TXT, CSV, JSON, DOCX, PPTX, and ZIP are supported via universal engines (`src/services/engines/`).

---

## 3. Layer-by-Layer Detail

### Layer 1 — Cryptographic

| Field | Detail |
|-------|--------|
| Purpose | Byte-exact and normalized content identity |
| Generation | `layer1.cryptographic.ts` (images); universal engines L1 (all types) |
| Algorithm | SHA-256 of raw bytes; images also compute normalized pixel hash; optional BLAKE3 via `dna-enhancements.ts` |
| Storage | `crypto_layers` table (images); `DnaRecord.universalFingerprints` JSON (non-image L1–L6) |
| Verification | Binary exact match in `comparison-engine.ts`; weight 35% |
| Immutability | Yes — stored at generation; never overwritten |
| PASS | Probe fingerprint equals vault fingerprint (score 1.0) |
| FAIL | Fingerprints differ (score 0) |
| SKIPPED | Layer not generated for probe or vault side |

### Layer 2 — Structural

| Field | Detail |
|-------|--------|
| Purpose | Layout and structural organization fingerprint |
| Generation | `layer2.structural.ts` (Sobel edge detection → 64-bit signature); universal per-type L2 |
| Media | All 10 supported file types |
| Algorithm | Image: Sobel edges. PDF: page layout. Video: container/box structure. Others: type-specific |
| Storage | `structural_layers` / universal JSON |
| Verification | Hex/Hamming similarity; threshold 0.80; weight 20% |
| Status | Implemented |

### Layer 3 — Perceptual

| Field | Detail |
|-------|--------|
| Purpose | Near-duplicate and perceptual similarity |
| Generation | `layer3.perceptual.ts` (DCT pHash64/256); universal SimHash |
| Algorithm | Image: pHash/aHash/dHash. Universal: SimHash on content chunks |
| Verification | Hamming distance on hex hashes; threshold 0.75; weight 20% |
| Status | Implemented — primary layer for derivative matching when L1 differs |

### Layer 4 — Semantic

| Field | Detail |
|-------|--------|
| Purpose | Content meaning / distribution fingerprint |
| Generation | `layer4.semantic.ts`; universal semantic distributions |
| Algorithm | Image: RGB/HSV histograms. Text: word frequencies. Video/audio: codec/tag profiles |
| Verification | Hex/Hamming; threshold 0.70; weight 10% |
| Status | Implemented |

### Layer 5 — Metadata

| Field | Detail |
|-------|--------|
| Purpose | Provenance and container metadata fingerprint |
| Generation | `layer5.metadata.ts`; universal metadata extractors |
| Algorithm | Image: EXIF/IPTC/XMP + C2PA-style manifest hash. PDF: info dict. DOCX/PPTX: OPC core.xml |
| Verification | Binary match; threshold 0.60; weight 5% |
| Status | Implemented |
| Investigation note | Report slot “AI Fingerprint” maps here in UI but is often SKIPPED in reports |

### Layer 6 — Signature

| Field | Detail |
|-------|--------|
| Purpose | Integrity seal and hidden signature |
| Generation | `layer6.steganography.ts` (LSB blue-channel + HMAC); universal HMAC over L1–L5 |
| Algorithm | Image: LSB steganography. Universal: HMAC-SHA256 |
| Verification | Binary match; threshold 0.90; weight 10% |
| Comparison note | Probe and vault L6 stabilised via `HMAC("COMPARE:" + fileType + L1–L5)` for fair comparison |
| Status | Implemented |

### Layer 7 — Behavioral

| Field | Detail |
|-------|--------|
| Purpose | Upload session behavior fingerprint |
| Generation | `layer7.behavioral.ts` |
| Algorithm | SHA-256 of filename, size, mime, upload timing, user agent, session |
| Storage | `behavioral_layers` |
| Verification | Compared if present; **weight 0** in overall DNA score |
| Status | Implemented — registry evidence, not content identity |

### Layer 8 — Relationship

| Field | Detail |
|-------|--------|
| Purpose | Duplicate and graph linkage |
| Generation | `layer8.relationship.ts` — Prisma lookup for same SHA-256, sorted related IDs |
| Algorithm | SHA-256 graph hash |
| Verification | Weight 0 in score; vault-compare mode may credit when content verified |
| Status | Implemented |

### Layer 9 — Origin

| Field | Detail |
|-------|--------|
| Purpose | Upload origin context |
| Generation | `layer9.origin.ts` |
| Algorithm | SHA-256 bundle: IP, user agent, country, city, filename, timestamp |
| Verification | Weight 0; geo only when router receives IP/GPS |
| Status | Implemented |

### Layer 10 — Evolution

| Field | Detail |
|-------|--------|
| Purpose | Version and mutation chain |
| Generation | `layer10.evolution.ts` |
| Algorithm | Merkle root over mutation log (starts with ORIGIN entry) |
| Verification | Weight 0 |
| Status | Implemented |

### Layer 11 — Deepfake Detection

| Field | Detail |
|-------|--------|
| Purpose | AI/manipulation signal heuristics |
| Generation | `layers-11-15.service.ts` — pixel noise, JPEG quantization, channel stats |
| Algorithm | `ai_deepfake_analysis` — heuristic, not ML model (`modelVersion: '1.0'`) |
| Condition | Requires `ownerUserId`; media analysis emphasised for image/video MIME |
| Status | **Partially Implemented** — heuristic only |

### Layer 12 — Invisible Watermark

| Field | Detail |
|-------|--------|
| Purpose | Owner identity watermark record |
| Generation | `layers-11-15.service.ts` |
| Algorithm | SHA-256 payload hash; method varies by MIME (`dct-frequency`, `psychoacoustic`, `structural-encoding`) |
| Status | **Partially Implemented** — record stored; actual DCT embed in file depends on vault/TEP watermark pipeline |

### Layer 13 — Chain of Custody

| Field | Detail |
|-------|--------|
| Purpose | Legal custody chain entry at DNA generation |
| Generation | `layers-11-15.service.ts` |
| Algorithm | JSON custody entry + evidence hash |
| Storage | `custody_layers` |
| Status | Implemented — separate from append-only `forensic_provenance_events` timeline |

### Layer 14 — ZK Ownership Proof

| Field | Detail |
|-------|--------|
| Purpose | Ownership commitment |
| Generation | `layers-11-15.service.ts` |
| Algorithm | `H(secret || fileHash || ownerUserId)` with AES-GCM encrypted secret |
| Status | **Partially Implemented** — hash commitment, not a zero-knowledge protocol |

### Layer 15 — Biometric Bind

| Field | Detail |
|-------|--------|
| Purpose | Bind DNA to uploader biometrics |
| Generation | `layers-11-15.service.ts` |
| Algorithm | SHA-256 of user `faceEmbedding` from database, or `NOT_REGISTERED` |
| Status | **Partially Implemented** — `embeddedInFile: false` when not registered |

---

## 4. PASS / FAIL / SKIPPED Meanings

Three status systems exist in code:

### A. Generation status (`DnaRecord.status`)

| Value | Meaning |
|-------|---------|
| COMPLETE | All 15 layers succeeded |
| PARTIAL | Some layers succeeded |
| FAILED | No layers succeeded |
| PENDING / PROCESSING | In progress |

### B. Comparison (`comparison-engine.ts`)

Uses `matched: boolean`, `skipped: boolean`, `similarityScore` — not PASS/FAIL strings.

Skip reasons include: layer not generated for file type; registry layers L7–L15 not regenerated on probe.

### C. Investigation report (`ChannelState`)

| Value | Meaning |
|-------|---------|
| PASS | Channel contributed positively to Acceptance Engine scorecard |
| FAIL | Channel failed or DNA classification DIFFERENT / score below 40 |
| SKIPPED | Channel not applicable or evidence unavailable |

Mapped in `src/services/forensics/dna-layer-standardization.service.ts`.

---

## 5. DNA Generation Workflow

```
User uploads file
        |
        v
FileTypeDetector (src/services/file-type-detector.ts)
        |
        +--- IMAGE --------------------------> DnaOrchestrator
        |                                      |
        |                                      L1-L4 parallel
        |                                      L5 (needs L1)
        |                                      L6 (needs record ID)
        |                                      L7-L10 parallel
        |                                      Persist L1-L10 to Prisma
        |                                      L11-L15 if ownerUserId
        |
        +--- TXT, CSV, JSON, PDF, DOCX,      Universal engine L1-L6
             PPTX, ZIP, VIDEO, AUDIO  -----> L7-L10 parallel
                                               L11-L15 if ownerUserId
                                               Persist to Prisma + universalFingerprints JSON
        |
        v
Optional: dna-enhancement-bundle (OCR, screenshot DNA, video/audio extras)
        |
        v
Optional: forensicProvenanceService.appendAsync(DNA_GENERATED)
        |
        v
DnaRecord status: COMPLETE | PARTIAL | FAILED
```

**Image pipeline:** `src/services/dna.orchestrator.ts`  
**Universal pipeline:** `src/services/universal-file-router.ts`  
**Supported types config:** `src/config/supported-file-types.ts` (all 10 types marked `LIVE`)

---

## 6. Storage Architecture

| Layer | Prisma Model | Table |
|-------|--------------|-------|
| L1 | CryptoLayer | crypto_layers |
| L2 | StructuralLayer | structural_layers |
| L3 | PerceptualLayer | perceptual_layers |
| L4 | SemanticLayer | semantic_layers |
| L5 | MetadataLayer | metadata_layers |
| L6 | StegoLayer | stego_layers |
| L7 | BehavioralLayer | behavioral_layers |
| L8 | RelationshipLayer | relationship_layers |
| L9 | OriginLayer | origin_layers |
| L10 | EvolutionLayer | evolution_layers |
| L11 | DeepfakeLayer | deepfake_layers |
| L12 | DctWatermarkLayer | dct_watermark_layers |
| L13 | CustodyLayer | custody_layers |
| L14 | ZkProofLayer | zk_proof_layers |
| L15 | BiometricBindLayer | biometric_bind_layers |

Non-image L1–L6 also stored in `DnaRecord.universalFingerprints` JSON.

**Immutability rule:** DNA layers are write-once at generation. Lifecycle events (download, share, investigation) are stored separately in `forensic_provenance_events` — never merged into DNA.

---

## 7. Implementation Status Summary

| Category | Status |
|----------|--------|
| L1–L10 generation (all 10 file types) | Implemented |
| L11–L15 generation (when owner present) | Implemented |
| L1–L6 comparison scoring | Implemented |
| L7–L15 comparison | Partial — weight 0 or skipped; vault credit in compare mode |
| Investigation 15-slot report standardisation | Implemented |
| Video ffprobe / keyframe pHash (config names) | Planned — not in current `video-dna-engine.ts` |
| Chromaprint for audio (config names) | Planned — engine uses chunk SimHash |
| True ZK proof (L14) | Planned |
| ML-based deepfake (L11) | Planned |

---

*End of document*
