# Spatial Auth — Phase 3C (Fine Tamper Map UX + Phase 2 Drill-down)

**Implemented:** Hierarchical investigation / visualization over Phase 2 + Phase 3A results.  
**Not implemented:** GLPM · LSB · robust provenance · crop/JPEG recovery · HMAC optimization · Phase 3D–3G · 4×4 cells.

> Phase 3C provides visualization and investigation of Phase 3A 8×8 authentication results.  
> It does **not** increase cryptographic resolution beyond the enrolled 8×8 cell.

---

## Trust hierarchy (unchanged)

1. **Phase 1** — cryptographic block integrity (HMAC / Merkle / root MAC)  
2. **Phase 2** — block localization (derived)  
3. **Phase 3A** — cryptographic 8×8 HKCA  
4. **Phase 3C** — visualization / investigation only  

Phase 3C **never** recalculates or reinterprets authentication.  
Client-provided localization must **never** be treated as trusted server-side evidence.

Cross-links: [Phase 1](./SPATIAL_AUTH_PHASE1.md) · [Phase 2](./SPATIAL_AUTH_PHASE2.md) · [Phase 3A](./SPATIAL_AUTH_PHASE3A.md)

---

## Architecture

```
IMAGE
  └── Phase 1/2 Block (64×64)
        └── Phase 3A Cells (8×8)
              └── Phase 3C overlay / drill-down (presentation)
```

Multi-scale view support:

| Scale | Role in 3C |
|-------|------------|
| 64 | Overview (Phase 2) |
| 8 | Fine drill-down (Phase 3A) |
| 4 | Reserved in `multiScale.futureScalesReserved` — **not implemented** |

---

## What Phase 3C adds

Additive field on Mode A verify result:

| Field | Meaning |
|-------|---------|
| `result.investigation` | Hierarchical investigation payload |
| `investigation.hierarchicalBlocks[]` | Block → nested 8×8 cells |
| `investigation.regions[]` | Phase-2 regions + 8×8 cell counts |
| `investigation.stats` | Investigation statistics |
| `investigation.fineMask` | `cell-byte-v1` compact mask |
| `investigation.overlay` | `spatial-overlay-rects-v1` presentation descriptor |
| `investigation.localizationClaim` | Always `"8x8_cell"` |

API also returns `investigationDisclaimer`.

Integration helpers (extended):

- `buildSpatialInvestigation` / `drillDownBlock`
- `buildFineTamperMask` / `buildSpatialOverlayDescriptor`
- `spatialLocalizationForTamperAnalysis` (includes hierarchy + fine mask)
- `attachSpatialLocalizationToImageDiff` (adds `spatialInvestigation`)
- `fineLocalizationToChangedRegions`

UI:

- `SpatialAuthInvestigationPanel` — overview / fine / regions + canvas overlay  
- Wired into Forensic Diff + Investigation side-by-side when investigation data is present

---

## Mask format (`cell-byte-v1`)

- One **byte per 8×8 cell**, row-major `cellId`  
- `0` = AUTHENTIC, `1` = TAMPERED, `2` = UNKNOWN  
- **No blur / interpolation** on the forensic mask  
- UI smoothing (if any) is presentation-only  

---

## Coordinate system

- Same as enrollment: `file-pixel-order-v1` decoded RGB  
- Overlay rects use **original image pixel coordinates**  
- Aspect ratio / dimensions preserved in coordinate math  
- Overlay does **not** alter the original image bytes  

---

## Localization claim

Every investigation result:

```
localizationClaim = "8x8_cell"
```

For a modification at `(400,500)` the system may report the containing cell:

```
x=400, y=496, width=8, height=8, status=TAMPERED
```

It must **not** say “pixel (400,500) is proven to be modified.”

---

## Invalid states

No trusted fine map / overlay when verify status is:

- `INVALID_AUTH_PACKAGE`
- `INVALID_PIXEL_PACKAGE` (fine mask null; coarse Phase-2 may still be present when Phase 1/2 trusted)
- `DIMENSION_MISMATCH`
- `UNSUPPORTED_VERSION`
- `ERROR`

`investigation.trusted === false` → `overlay` / `fineMask` null (or unavailable); UI shows unavailable panel.

---

## Example — one pixel `(400,500)`

```json
{
  "blockId": 76,
  "x": 384,
  "y": 448,
  "width": 64,
  "height": 64,
  "status": "TAMPERED",
  "fineLocalization": {
    "cellSize": 8,
    "localizationClaim": "8x8_cell",
    "cells": [ /* 8×8 grid for this block */ ],
    "tamperedCells": [
      { "cellId": 5010, "x": 400, "y": 496, "width": 8, "height": 8, "status": "TAMPERED" }
    ]
  }
}
```

## Example — full 64×64 modification

- Phase 2: one block TAMPERED  
- Phase 3C drill-down: **64/64** nested 8×8 cells TAMPERED  

---

## API

`POST /api/v1/dna/:id/spatial-auth/verify-exact` — additive:

- `result.investigation`
- `investigationDisclaimer`

Existing `localization` / `fineLocalization` / `pixelLayer` unchanged.  
No dedicated drill-down endpoint required — hierarchy is embedded; clients filter by `blockId`.

---

## Limitations

- Visualization only — not a new trust source  
- Claim remains **8×8 cell**  
- Does not fix HMAC performance  
- Does not implement robust / crop / JPEG recovery  
- Soft CV heatmap remains separate analytical evidence  

---

## Security boundary

| Layer | Role |
|-------|------|
| Phase 1 | Cryptographic block integrity |
| Phase 2 | Block localization |
| Phase 3A | Cryptographic 8×8 cell authentication |
| Phase 3C | Visualization / investigation |

Do not allow client-provided localization to become server evidence.
