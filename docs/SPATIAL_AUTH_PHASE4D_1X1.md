# Spatial Auth — Phase 4D (True 1×1 Pixel Authentication)

**Implemented:** Lazy 1×1 keyed authentication under failed Phase-4C 2×2 cells.  
**Not implemented:** GLPM · LSB embedding · robust watermarking · crop/resize/JPEG recovery.

> **1×1 authentication is exact-mode authentication under `file-pixel-order-v1`. It is not robust against resize, JPEG re-encoding, crop, screenshot, or arbitrary image transformations.**

**Global product claim (`SPATIAL_HIERARCHY_PRODUCTION_CLAIM`):** remains `8x8_cell` (Phase 3C / 4A–4C contracts unchanged).  
**Trusted 1×1 result claim:** `localizationClaim = "1x1_pixel"`  
**Flag:** `SPATIAL_1X1_AUTH_ENABLED` (default `false`)

Requires: trusted Phase 4B + 4C + enrolled lossless reference RGB.

Cross-links: [Phase 4C](./SPATIAL_AUTH_PHASE4C_2X2.md) · [Phase 4B](./SPATIAL_AUTH_PHASE4B_4X4.md) · [Phase 3F](./SPATIAL_AUTH_PHASE3F_HARDENING.md)

---

## Exact 1×1 architecture

```
Phase 1 64×64 (unchanged)
  → Phase 3A 8×8 (unchanged)
    → Phase 4B 4×4 (unchanged)
      → Phase 4C 2×2 (unchanged)
        → Phase 4D: only failed 2×2 cells
             → up to four 1×1 pixels
             → exact RGB vs vault reference
             → position-bound HMAC (identity binding)
```

One failed 2×2 ⇒ **maximum 4** pixels inspected.

---

## Reference strategy

Expected RGB comes from the enrolled lossless vault original:

- `file-pixel-order-v1` (removeAlpha().raw() → RGB)
- No EXIF rotation / resize / interpolation
- Not JPEG / thumbnail / preview

The HMAC key does **not** reconstruct pixel RGB.

---

## Cryptographic binding

HKDF-SHA256, salt=`dnaRecordId`, domain **`pinit-spatial-pixel1-hmac-v1`** (distinct from Q4/Q2).

MAC domain **`P1`**, algorithm `spatial-pixel1-auth-v1`, tag **8 bytes**.

lpbin payload binds:

algorithmVersion · dnaRecordId · globalDnaRef · parent2x2Id · x · y · R · G · B

Status: AUTHENTIC iff exact RGB match **and** HMAC tags match.

---

## Serialization

Phase 3F **lpbin only**. No pipe strings, no JSON crypto inputs, no silent sorting.

---

## Lazy hierarchy

Untouched image ⇒ 0 pixels inspected.  
Single-pixel tamper ⇒ inspect ≤4 pixels inside the failed 2×2.

No per-pixel DB rows. No full-frame 1×1 blob by default.

---

## Trust chain

Trusted 1×1 only when:

Phase 1 valid ∧ Phase 3A valid ∧ 4×4 trusted ∧ 2×2 trusted ∧ reference trusted ∧ dims match ∧ orientation policy matches.

Otherwise: `trusted=false` (e.g. `PARENT_2X2_REQUIRED`, `PARENT_2X2_UNTRUSTED:…`, `REFERENCE_UNAVAILABLE`).

---

## Crop / dimension mismatch

If candidate dimensions change ⇒ `DIMENSION_MISMATCH` (exact mode).  
This phase does **not** recover cropped coordinates.

---

## Attack model

Cross-image transplant, relocation, coordinate/DNA/secret/package forgery → TAMPERED or untrusted / INVALID_*. Never false MATCH.

---

## Acceptance

Single-pixel `(400,500)` R+1 ⇒ only that pixel TAMPERED; siblings AUTHENTIC.  
Controlled synthetic sets ⇒ precision = 1.0, recall = 1.0.

---

## Performance

Correctness-first. Stats: parentsInspected, pixelsInspected, comparisonMs, authMs, pixel1VerificationMs.

---

## Limitations

- Exact mode only  
- Not robust transforms  
- Crop provenance out of scope  
- Global `SPATIAL_HIERARCHY_PRODUCTION_CLAIM` not auto-flipped (investigation claim remains `8x8_cell`)
