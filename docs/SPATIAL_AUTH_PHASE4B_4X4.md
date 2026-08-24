# Spatial Auth — Phase 4B (4×4 Cryptographic Authentication)

**Implemented:** Lazy 4×4 keyed authentication under failed Phase-3A 8×8 cells.  
**Not implemented:** 2×2 crypto · 1×1 crypto · GLPM · robust provenance.

> Phase 4B provides exact **4×4** localization.  
> It does **not** yet provide 1×1 pixel localization.

**Production claim (unchanged):** `8x8_cell`  
**Internal unit:** `4x4_cell`  
**Flag:** `SPATIAL_4X4_AUTH_ENABLED` (default `false`)

Cross-links: [Phase 4A](./SPATIAL_AUTH_PHASE4A.md) · [Phase 3A](./SPATIAL_AUTH_PHASE3A.md) · [Phase 3F](./SPATIAL_AUTH_PHASE3F_HARDENING.md)

---

## Authentication model

```
Phase 1 64×64 (unchanged)
  → Phase 3A 8×8 (unchanged)
    → Phase 4B: only failed 8×8 cells
         → up to four 4×4 children
         → HMAC(ref RGB) vs HMAC(candidate RGB)
```

Reference: enrolled lossless vault RGB, `file-pixel-order-v1` (no EXIF rotate / resize / interpolate).

No full-frame 4×4 tag blob is stored by default (lazy hybrid).

---

## Key derivation

- HKDF-SHA256, salt = `dnaRecordId`
- Info = length-prefixed (`lpbin-v1.1`): domain `pinit-spatial-quad4-hmac-v1` + owner + globalDnaRef + keyId  
- Domain separated from Phase 1 / 3A keys  
- Secret and derived keys never stored in package

---

## Serialization

MAC payload uses Phase 3F **lpbin only** (`buildCryptoPayload('lpbin-v1.1', 'Q4', …)`):

algorithmVersion · dnaRecordId · globalDnaRef · parentCellId · cellId · x · y · width · height · SHA-256(cellRgb)

Tag: truncated HMAC-SHA256 (**8 bytes**).

---

## Trust rules

Trusted 4×4 only when:

1. Phase 1 package valid  
2. Phase 3A pixel package valid (`MATCH` or `TAMPERED`)  
3. `SPATIAL_4X4_AUTH_ENABLED`  
4. Reference RGB provided  
5. Reference dimensions match  
6. Reference itself verifies as **MATCH** against the package  
7. Orientation policy matches  

Otherwise: `trusted=false` + `unavailableReason` (e.g. `REFERENCE_UNAVAILABLE`, `REFERENCE_NOT_AUTHENTIC`).

---

## Lazy verification

One failed 8×8 ⇒ **exactly 4** 4×4 children inspected (fewer on partial edge cells).  
Unrelated regions are not scanned.

---

## API / result

`verifyExactSpatialAuth({ …, referenceRgb, referenceWidth, referenceHeight, skipQuad4? })`

Additive field:

```ts
result.quad4Localization?: {
  trusted, localizationUnit: '4x4_cell', productionClaim: '8x8_cell',
  cells[], tamperedCells[], stats{ parentsInspected, cellsInspected, … }
}
```

---

## Example — pixel (400,500)

- 64×64 `(384,448)` TAMPERED  
- 8×8 `(400,496)` TAMPERED  
- 4×4 `(400,500)` TAMPERED  
- Other three 4×4 siblings AUTHENTIC  
- Public claim still `8x8_cell`

---

## Security

Transplant, relocation, wrong reference, wrong secret, invalid package, DNA forgery → fail / untrusted 4×4.  
Cannot bypass Phase 1/3A.

---

## Limitations

- Not 1×1 / 2×2 yet  
- Exact mode only  
- Requires reference at verify for trusted 4×4  
- Production claim not upgraded
