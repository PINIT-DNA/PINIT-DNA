# Spatial Auth — Phase 3A (8×8 HKCA)

**Implemented:** Hierarchical Keyed Cell Authentication — **server-side only**.  
**Not implemented:** GLPM / any LSB embedding / Phase 3B–3G.

## Tag size evaluation (finalized for 3A)

| Size | Verdict |
|------|---------|
| 4-byte | **Rejected** — weak truncation |
| **8-byte** | **Default** — keyed HMAC-64; forgery still needs secret; ~½ storage of 16-byte |
| 16-byte | Optional via `SPATIAL_PIXEL_TAG_BYTES=16` |

## Localization claim

**8×8 fine-grained localization only.**  
Do **not** claim exact single-pixel cryptographic identification.

`fineLocalization.localizationClaim === "8x8_cell"`

## What 3A stores

Additive nullable fields on `SpatialAuthPackage`:

- `pixelAlgoVersion` = `spatial-pixel-auth-v1`
- `pixelScheme` = `hkca-8`
- `pixelKeyId`, `pixelCellSize` (8), `pixelTagBytes` (8|16)
- `pixelAuthBlob` (SPX1 binary)
- `pixelAuthRoot`, `pixelRootMac` (separate from Phase 1 root)

**Secret never in DB/image.** No blue/green LSB writes in 3A.

## Flags

```
SPATIAL_AUTH_ENABLED=true          # required for enroll
SPATIAL_PIXEL_AUTH_ENABLED=true    # enables 3A HKCA on enroll
SPATIAL_PIXEL_TAG_BYTES=8          # or 16
```

## Exact vs robust

Phase 3A is **exact** only (same `file-pixel-order-v1` policy).  
JPEG/resize/crop → not Phase 3A success; defer to robust layers.

## Verify API

`POST .../spatial-auth/verify-exact` returns additive:

- `result.pixelLayer`
- `result.fineLocalization`

Phase 1/2 fields unchanged.

Phase 3C (visualization) attaches `result.investigation` — see [SPATIAL_AUTH_PHASE3C.md](./SPATIAL_AUTH_PHASE3C.md).
