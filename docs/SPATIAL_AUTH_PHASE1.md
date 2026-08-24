# Spatial Auth — Phase 1 (Mode A Exact Block Integrity)

> See also: [Phase 2 — Block-Level Tamper Localization](./SPATIAL_AUTH_PHASE2.md) · [Phase 3A — 8×8 HKCA](./SPATIAL_AUTH_PHASE3A.md)

## Exact integrity vs robust provenance

| Mode | Purpose | Phase |
|------|---------|-------|
| **Mode A — Exact** | Cryptographic proof that pixels match the enrolled geometry under a fixed decode policy | **This document (Phase 1)** |
| **Mode B — Robust** | Recognize a registered asset after JPEG, resize, crop, social re-encode, etc. | Later phases |

> **Mode A provides exact spatial integrity only when the candidate image is evaluated under the enrolled geometry/normalization policy. It must not be interpreted as robust provenance.**

Resized, re-compressed, or recolored images must **not** be reported as Mode A matches. Dimension changes yield `DIMENSION_MISMATCH`, not “tampered exact match.”

---

## What Phase 1 adds

Additive `SpatialAuthPackage` (one row per DNA record):

- Configurable block grids (default **64×64** primary + **128×128** secondary; **32×32** flag-off)
- Position-bound **HMAC-SHA256** tags (16-byte truncated) per block
- Deterministic **Merkle root** over block leaves
- **Root MAC** over package metadata + Merkle root (server secret via HKDF)
- Compact **binary `blockBlob`** (no per-pixel DB rows)
- Mode A verify API + block-level tamper map

**Does not change:** L1–L15 generation semantics, L6 ownership watermark, L12 DB watermark claim, vault DCT/DWT algorithms, LocalDnaPatch.

---

## Decode / orientation policy

Policy id: `file-pixel-order-v1`

- Sharp: `removeAlpha().raw()` → RGB
- **No** EXIF `.rotate()`
- Matches DNA L1–L6 pixel order

Changing EXIF-only metadata without changing stored pixel order does **not** fail Mode A.

---

## Block authentication

For each block:

```
tag = HMAC-SHA256(
  K_image,
  "A|algoVersion|dnaRecordId|globalDnaRef|scale|blockId|x|y|w|h|sha256(blockRgb)"
)[0:16]
```

- `K_image = HKDF-SHA256(SPATIAL_AUTH_SECRET, salt=dnaRecordId, info=…owner…globalDnaRef…keyId)`
- Moving a block to another `(x,y)` fails (geometry in MAC)
- Transplanting a block from another image fails (`dnaRecordId` + `globalDnaRef` + different `K_image`)

Edge blocks store actual `width`/`height` when the image is not a multiple of the scale.

---

## Key derivation

| Key | Derivation | Stored? |
|-----|------------|---------|
| Master | `SPATIAL_AUTH_SECRET` (env) | Never in DB / image |
| Block HMAC key | HKDF → 32 bytes | Ephemeral |
| Root MAC key | HKDF → 32 bytes | Ephemeral |
| `keyId` | `SPATIAL_AUTH_KEY_ID` | Yes (package metadata) |

---

## Merkle structure

1. Sort leaves by `(scale ASC, blockId ASC)`
2. Leaf hash = `SHA256("SPATIAL-LEAF-v1" || scale || blockId || x || y || w || h || tag)`
3. Internal = `SHA256(left || right)`; odd node promoted unchanged
4. `rootMac = HMAC(K_root, ROOT-MAC-v1|…|merkleRoot)`

Package integrity checks:

1. Verify `rootMac`
2. Recompute Merkle from stored `blockBlob` tags → must equal `merkleRoot`
3. Else `INVALID_AUTH_PACKAGE`

---

## Tamper-map semantics

Mode A verify returns cryptographic counts — not soft confidence:

- `status`: `MATCH` | `TAMPERED` | `DIMENSION_MISMATCH` | `INVALID_AUTH_PACKAGE` | `UNSUPPORTED_VERSION` | `ERROR`
- Failed HMAC ⇒ block `status: "TAMPERED"`
- `exactPassRate` = `blocksPassed / blocksChecked` (diagnostic only; not a substitute for MAC)

---

## Feature flag

```
SPATIAL_AUTH_ENABLED=false   # default — existing behavior unchanged
```

When disabled: DNA generate skips enrollment; enroll/verify APIs return 503.

---

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/dna/spatial-auth/status` | Flag + algo/key metadata |
| POST | `/api/v1/dna/:id/spatial-auth/enroll` | Build/store package |
| POST | `/api/v1/dna/:id/spatial-auth/verify-exact` | Mode A verify + tamper map |

---

## Limitations (Phase 1)

- Exact geometry only — not robust to JPEG/resize/crop
- No pixel residual PRF / new watermark embedding
- Primary-scale tamper map in API (Merkle still covers all enrolled scales)
- Enrollment after DNA generate is best-effort (non-fatal)

---

## Algorithm version

`spatial-auth-v1`
