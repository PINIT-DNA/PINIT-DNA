# PINIT-DNA — Architecture & Development Roadmap

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 20 + TypeScript 5 | Strong typing for fingerprint data contracts |
| Framework | Express 4 | Lightweight, well-understood, easy to extend |
| Database | PostgreSQL 16 | JSONB support for histograms; UUID primary keys |
| ORM | Prisma 5 | Type-safe queries; migration management |
| File uploads | Multer | Stream-safe multipart handling |
| Validation | Zod | Runtime schema validation with TypeScript inference |
| Logging | Winston | Structured JSON logs for production observability |
| Security | Helmet + express-rate-limit | Headers hardening + abuse prevention |
| Image processing (future) | sharp | Native libvips bindings — fastest Node.js image lib |
| Edge detection (future) | @techstark/opencv-js | Canny/Sobel in pure WASM — no native install required |
| Metadata extraction (future) | exifr | Unified EXIF/IPTC/XMP parser |

---

## Folder Structure

```
pinit-dna/
├── prisma/
│   └── schema.prisma          ← Database schema for all 6 layers
├── src/
│   ├── app.ts                 ← Express bootstrap, middleware, route wiring
│   ├── config/
│   │   └── index.ts           ← Typed env-var config (single source of truth)
│   ├── lib/
│   │   ├── logger.ts          ← Winston logger singleton
│   │   └── prisma.ts          ← PrismaClient singleton
│   ├── types/
│   │   └── dna.types.ts       ← All shared TS interfaces (layer results, API shapes)
│   ├── services/
│   │   ├── dna.orchestrator.ts  ← Runs all 6 layers; persists to DB
│   │   ├── dna.verifier.ts      ← Loads record; scores probe image per layer
│   │   └── layers/
│   │       ├── layer1.cryptographic.ts
│   │       ├── layer2.structural.ts
│   │       ├── layer3.perceptual.ts
│   │       ├── layer4.semantic.ts
│   │       ├── layer5.metadata.ts
│   │       └── layer6.steganography.ts
│   └── api/
│       ├── routes/
│       │   └── dna.routes.ts
│       ├── controllers/
│       │   └── dna.controller.ts
│       └── middleware/
│           ├── upload.middleware.ts
│           └── error.middleware.ts
└── tests/
    ├── health.test.ts
    └── layers/
        └── layer1.cryptographic.test.ts
```

---

## Database Schema

Seven tables total:

| Table | Purpose |
|---|---|
| `dna_records` | Root record — image metadata + status |
| `crypto_layers` | Layer 1: SHA-256 raw + normalized + BLAKE3 |
| `structural_layers` | Layer 2: edge map, vectors, 64-bit signature |
| `perceptual_layers` | Layer 3: pHash64, pHash256, aHash, dHash |
| `semantic_layers` | Layer 4: RGB/HSV histograms, dominant colors |
| `metadata_layers` | Layer 5: EXIF/IPTC/XMP provenance, device, GPS |
| `stego_layers` | Layer 6: embedding status, HMAC, carrier path |
| `verification_logs` | Every verification run with per-layer scores |

All foreign keys cascade on delete. All IDs are UUIDs.

---

## API Design

Base URL: `POST /api/v1`

### `POST /api/v1/dna/generate`
- Body: `multipart/form-data`, field `image`
- Returns: `201` with `dnaRecordId`, status, and per-layer summary

### `POST /api/v1/dna/:id/verify`
- Body: `multipart/form-data`, field `image` (probe image)
- Optional JSON field `layers`: array of layer names to check
- Returns: `200` with `passed`, `confidenceScore`, per-layer results

### `GET /api/v1/dna/:id`
- Returns: `200` with record metadata and which layers are present

### `GET /health`
- Returns: `200` with service name, version, timestamp

---

## 6-Layer Fingerprint Architecture

```
Upload Image
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│  DnaOrchestrator                                              │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Layer 1     │  │  Layer 2     │  │  Layer 3         │   │
│  │  SHA-256     │  │  Edge-Based  │  │  pHash           │   │
│  │  Crypto Hash │  │  Structural  │  │  Perceptual      │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│          ▲                ▲                   ▲               │
│          │                │  (run in parallel)│               │
│  ┌──────────────┐  ┌──────────────┐                          │
│  │  Layer 4     │  │  Layer 5     │                          │
│  │  RGB Hist.   │  │  Metadata    │                          │
│  │  Semantic    │  │  Provenance  │                          │
│  └──────────────┘  └──────────────┘                          │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Layer 6 — LSB Steganography (runs after 1–5)        │    │
│  │  Embeds: { dnaRecordId, timestamp } + HMAC           │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  Persist all layers in one DB transaction                     │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
  DnaRecord stored (COMPLETE | PARTIAL | FAILED)
```

---

## Verification Architecture

```
Probe Image + dnaRecordId
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│  DnaVerifier                                                  │
│                                                               │
│  1. Load stored DnaRecord from DB (all 6 layers)             │
│  2. Re-generate probe fingerprints for each requested layer  │
│  3. Score each layer (0.0–1.0):                              │
│                                                               │
│   Layer 1 (30%): exact hash match → 1.0 or 0.0              │
│   Layer 2 (20%): Hamming dist. on edge signature             │
│   Layer 3 (20%): Hamming dist. on pHash64/aHash/dHash        │
│   Layer 4 (15%): histogram intersection similarity           │
│   Layer 5 ( 5%): metadata field matching                     │
│   Layer 6 (10%): HMAC verification → 1.0, 0.5, or 0.0       │
│                                                               │
│  4. Confidence = weighted average of layer scores            │
│  5. Pass = confidence ≥ 0.70 AND (layer1 OR layer3 passes)   │
│  6. Persist VerificationLog                                   │
└───────────────────────────────────────────────────────────────┘
```

---

## Development Roadmap

### Phase 1 — Foundation (DONE)
- [x] Project architecture and folder structure
- [x] TypeScript types for all 6 layers
- [x] Database schema (Prisma)
- [x] API endpoints: generate, verify, get record
- [x] Service interfaces with placeholder implementations
- [x] Orchestrator (parallel layers 1–5, sequential layer 6)
- [x] Verifier with weighted scoring model
- [x] Upload middleware, error handling, rate limiting

### Phase 2 — Algorithm Implementation
- [ ] Layer 1: `crypto.createHash('sha256')` + `sharp` EXIF strip
- [ ] Layer 2: Canny edge detection via `@techstark/opencv-js`
- [ ] Layer 3: DCT pHash, aHash, dHash
- [ ] Layer 4: RGB/HSV histogram extraction + K-means color clustering
- [ ] Layer 5: EXIF/IPTC/XMP parsing via `exifr`
- [ ] Layer 6: LSB bit encoding/decoding + HMAC-SHA256

### Phase 3 — Hardening
- [ ] Add `sharp` image dimension extraction (widthPx, heightPx)
- [ ] Add Zod validation on all API request bodies
- [ ] Integration tests for full generate → verify flow
- [ ] Layer-specific unit tests with real fixture images
- [ ] Docker + docker-compose setup

### Phase 4 — Vault Integration
- [ ] AES-256-GCM encryption of DNA record fields before storage
- [ ] Key management interface (rotate, revoke)
- [ ] Encrypted DNA export endpoint
- [ ] Decryption at verification time (in-memory only, never persisted decrypted)

---

## Future Integration Notes

- **Encryption**: The `sha256Hash`, `pHash64`, and `payloadHmac` fields are the
  primary candidates for AES-256-GCM encryption before vault storage. The
  `StegoLayer.carrierPath` must also be encrypted — it reveals where the
  carrier image is stored.
- **Scaling**: The orchestrator is designed to be extracted into a job queue
  (BullMQ + Redis) for async processing of large uploads.
- **Batch verification**: The verifier can be parallelized across multiple
  record IDs with `Promise.allSettled`.
