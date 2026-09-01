# Spatial Auth — Phase 4C (2×2 Cryptographic Authentication)

**Implemented:** Lazy 2×2 keyed authentication under failed Phase-4B 4×4 cells.  
**Not implemented:** 1×1 crypto · GLPM · LSB embedding · robust watermarking.

> Phase 4C provides exact **2×2** localization.  
> It does **not** yet provide 1×1 pixel localization.

**Production claim (unchanged):** `8x8_cell`  
**Internal unit:** `2x2_cell`  
**Flag:** `SPATIAL_2X2_AUTH_ENABLED` (default `false`)

Requires: trusted Phase 4B (`SPATIAL_4X4_AUTH_ENABLED`) + enrolled lossless reference RGB.

Cross-links: [Phase 4B](./SPATIAL_AUTH_PHASE4B_4X4.md) · [Phase 4A](./SPATIAL_AUTH_PHASE4A.md) · [Phase 3F](./SPATIAL_AUTH_PHASE3F_HARDENING.md)

---

## Authentication model

```
Phase 1 64×64 (unchanged)
  → Phase 3A 8×8 (unchanged)
    → Phase 4B 4×4 (unchanged)
      → Phase 4C: only failed 4×4 cells
           → up to four 2×2 children
           → HMAC(ref RGB) vs HMAC(candidate RGB)
```

Reference: enrolled lossless vault RGB, `file-pixel-order-v1` (no EXIF rotate / resize / interpolate).

No full-frame 2×2 tag blob is stored by default (lazy hybrid).

---

## Hierarchy

```
64×64 → 8×8 → 4×4 → 2×2 → 1×1 (geometry only until 4D)
```

One failed 4×4 ⇒ maximum **4** × 2×2 children ⇒ maximum **16** pixels referenced.

---

## Key derivation

- HKDF-SHA256, salt = `dnaRecordId`
- Info = length-prefixed (`lpbin-v1.1`): domain `pinit-spatial-quad2-hmac-v1` + owner + globalDnaRef + keyId  
- **Domain-separated** from Phase 1 / 3A / 4B (`pinit-spatial-quad4-hmac-v1`)  
- Secret and derived keys never stored in package

---

## Serialization

MAC payload uses Phase 3F **lpbin only** (`buildCryptoPayload('lpbin-v1.1', 'Q2', …)`):

algorithmVersion · dnaRecordId · globalDnaRef · parentCellId · cellId · x · y · width · height · SHA-256(cellRgb)

Tag: truncated HMAC-SHA256 (**8 bytes**, same as Phase 4B).

---

## Trust rules

Trusted 2×2 only when:

1. Phase 1 package valid  
2. Phase 3A pixel package valid  
3. Phase 4B 4×4 result **trusted**  
4. `SPATIAL_2X2_AUTH_ENABLED`  
5. Reference RGB provided (same vault original as 4B)  
6. Orientation policy matches  

Otherwise: `trusted=false` + `unavailableReason` (e.g. `PARENT_4X4_REQUIRED`, `PARENT_4X4_UNTRUSTED:…`).

---

## Lazy verification

One failed 4×4 ⇒ **exactly 4** 2×2 children inspected (fewer on partial edge cells).  
Unrelated regions are not scanned.

---

## API / result

Additive field on `verifyExactSpatialAuth`:

```ts
result.quad2Localization?: {
  trusted, localizationUnit: '2x2_cell', productionClaim: '8x8_cell',
  cellSize: 2, cells[], tamperedCells[],
  stats{ parentsInspected, cellsInspected, pixelsReferenced, comparisonMs }
}
```

---

## Example — pixel (400,500)

- 64×64 `(384,448)` TAMPERED  
- 8×8 `(400,496)` TAMPERED  
- 4×4 `(400,500)` TAMPERED  
- 2×2 `(400,500)` TAMPERED  
- Other three 2×2 siblings AUTHENTIC  
- Public claim still `8x8_cell`  
- Exact pixel identity deferred to Phase 4D

---

## Edge handling

Partial 2×2 units at right/bottom edges when dimensions are not divisible by 2.  
Every valid pixel belongs to exactly one 2×2 unit (Phase 4A coverage).

---

## Performance

Correctness-first. For one failed 4×4: ≤4 cells, ≤16 pixels. Stats recorded; no optimization in 4C.

---

## Security

Transplant, relocation, wrong reference, wrong secret, invalid package, DNA forgery, parent 4×4 untrusted → fail / untrusted 2×2.  
Cannot bypass Phase 1/3A/4B.

---

## Limitations

- Not 1×1 yet  
- Exact mode only  
- Requires trusted 4×4 + reference at verify  
- Production claim not upgraded (`8x8_cell`)
