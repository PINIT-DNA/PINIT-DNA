# Spatial Auth — Phase 2 (Block-Level Tamper Localization)

Phase 1 = cryptographic block integrity (HMAC / Merkle / root MAC).  
Phase 2 = **derived** spatial tamper map from Phase 1 results.  
Phase 3 = pixel-level participation (not in this document).

> The tamper map is **derived evidence**. It is **not** a new trust source.  
> Trust order: server secret → HMAC → Merkle → root MAC → SpatialAuthPackage → (then) map.

---

## What Phase 2 adds

When Mode A verification status is `MATCH` or `TAMPERED` (package trusted + geometry OK):

| Field | Meaning |
|-------|---------|
| `localization.blocks[]` | Every primary-scale block: `AUTHENTIC` / `TAMPERED` / `UNKNOWN` |
| `localization.tamperedBlocks[]` | Failed blocks with coordinates |
| `localization.stats` | counts, diagnostic `exactPassRate`, tampered area |
| `localization.regions[]` | 4-connected components of failed blocks |
| `localization.pattern` | `NONE` / `LOCAL_*` / `LARGE_*` / `GLOBAL_*` (not edit-op claims) |
| `localization.mask` | `block-byte-v1` compact mask |

When status is `INVALID_AUTH_PACKAGE`, `DIMENSION_MISMATCH`, `UNSUPPORTED_VERSION`, or `ERROR`:

- `localization` is **`null`** — do not trust or fabricate a map.

---

## Block statuses

| Status | Meaning |
|--------|---------|
| **AUTHENTIC** | Primary-scale HMAC passed |
| **TAMPERED** | Primary-scale HMAC failed |
| **UNKNOWN** | Block could not be evaluated reliably (not coerced to TAMPERED) |

One-pixel edits prove **block** failure only — never “exact pixel cryptographically identified.”

---

## Mask format (`block-byte-v1`)

- One **byte per primary block**, row-major `blockId` order  
- `0` = AUTHENTIC, `1` = TAMPERED, `2` = UNKNOWN  
- **No blur / interpolation** on the forensic mask  
- UI smoothing (if any) is presentation-only  

Encoded as Base64 in `localization.mask.dataBase64`.

---

## Connected regions

4-connected components over `TAMPERED` blocks → axis-aligned bounding boxes.

Pattern hints (for later classifiers — **not** operation labels):

- `LOCAL_MODIFICATION` — small isolated region  
- `MULTIPLE_LOCAL_MODIFICATIONS` — ≥2 regions  
- `LARGE_MODIFICATION` — one large region  
- `GLOBAL_MODIFICATION` — ≥80% blocks failed  
- `NONE` — no failures  

Do **not** auto-label crop / JPEG / watermark removal here.

---

## API

`POST /api/v1/dna/:id/spatial-auth/verify-exact` — additive `result.localization` (+ `localizationDisclaimer`).

Integration helpers:

- `attachSpatialLocalizationToImageDiff`  
- `spatialLocalizationForTamperAnalysis` → optional `tamperAnalysis.spatialAuthBlockLocalization`

---

## Limitations

- Primary **64×64** grid localization (Phase 2)  
- Exact geometry only (Mode A)  
- No pixel residual / new watermarks (Phase 3+)  
- `exactPassRate` is diagnostic only  
