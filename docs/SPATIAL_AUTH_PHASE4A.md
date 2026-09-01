# Spatial Auth — Phase 4A Hierarchical Design (64→8→4→2→1)

**Phase type:** Architecture / contracts spike.  
**Not implemented:** cryptographic 4×4, 2×2, or 1×1 authentication.  
**Unchanged:** Phase 1–3F crypto, L6/L12, vault DCT/DWT, GLPM, robust provenance.

**Production claim (unchanged):** `localizationClaim = "8x8_cell"`  
**Planned claim (after 4B–4D validation only):** `"1x1_pixel"`

Flag: `SPATIAL_HIERARCHY_ENABLED` (default **false**).

---

## 1. Canonical hierarchy

```
LEVEL 0: 64×64  — Phase 1 (crypto exists)
LEVEL 1: 8×8    — Phase 3A (crypto exists)
LEVEL 2: 4×4    — Phase 4A geometry only → crypto in 4B+
LEVEL 3: 2×2    — Phase 4A geometry only → crypto in 4B+
LEVEL 4: 1×1    — Phase 4A geometry only → crypto in 4B+
```

All five levels are first-class in the data model. Do not skip 4×4 or 2×2 in the architecture.

---

## 2. Progressive localization purpose

```
modification
  → 64×64 TAMPERED
  → 8×8 TAMPERED
  → 4×4 TAMPERED
  → 2×2 TAMPERED
  → 1×1 exact pixel
```

Lazy expansion: only evaluate children of failed parents (never full-frame 1×1 by default).

---

## 3. Coordinate rules

- Origin `(0,0)` = top-left  
- Policy: `file-pixel-order-v1` (no EXIF rotate, no resize, no interpolation)  
- Unit origin: `floor(pixel / scale) * scale`  
- Edge units may have `width`/`height` &lt; scale  

### Example — pixel `(400,500)`

| Level | Origin (x,y) | Size |
|-------|--------------|------|
| 64×64 | (384,448) | up to 64×64 |
| 8×8 | (400,496) | up to 8×8 |
| 4×4 | (400,500) | up to 4×4 |
| 2×2 | (400,500) | up to 2×2 |
| 1×1 | (400,500) | 1×1 |

8×8 `(400,496)` → 4×4 children: `(400,496)`, `(404,496)`, `(400,500)`, `(404,500)`.

---

## 4. Authentication model (design choice for 4B+)

Compared options:

| Option | Security | Storage | Perf | 1×1 | Complexity |
|--------|----------|---------|------|-----|------------|
| A Store all 4/2/1 tags | Strong | Very high | Slow if full | Yes | Med |
| B Parent commits to children only | Needs leaf/ref | Medium | Good w/ proofs | Needs leaves/ref | High |
| **C Hybrid lazy vault + HMAC** | Strong | Low extra | Localized | Yes | Med |

**Selected: Option C (hybrid)**  
- Keep Phase 1 / 3A stored tags.  
- For 4×4 / 2×2 / 1×1: authenticate **lazily** against enrolled vault lossless RGB under position/image-bound HMAC (implemented in 4B+).  
- Optional later: persist tags for offline-without-vault.

A secret alone cannot reconstruct RGB; reference = vault original under `file-pixel-order-v1`.

---

## 5. Parent–child relationship

| Parent | Child | Max children (full) |
|--------|-------|---------------------|
| 64×64 | 8×8 | 64 |
| 8×8 | 4×4 | 4 |
| 4×4 | 2×2 | 4 |
| 2×2 | 1×1 | 4 |

`subdivideUnit` / `ancestryForPixel` / `planLazyExpansion` encode this.

---

## 6. Storage analysis (geometry counts)

Exact for square side \(s=\mathrm{round}(\sqrt{\mathrm{MP}\times10^6})\):

| Level | Formula |
|-------|---------|
| 64×64 | \(\lceil s/64\rceil^2\) |
| 8×8 | \(\lceil s/8\rceil^2\) |
| 4×4 | \(\lceil s/4\rceil^2\) |
| 2×2 | \(\lceil s/2\rceil^2\) |
| 1×1 | \(s^2\) |

Approximate (near-square):

| MP | ~side | 64 | 8 | 4 | 2 | 1 |
|----|-------|----|---|---|---|---|
| 1 | 1000 | 256 | 15,625 | 62,500 | 250,000 | 1,000,000 |
| 5 | 2236 | ~1,225 | ~78,084 | ~312,481 | ~1.25M | ~5.0M |
| 12 | 3464 | ~2,916 | ~187,489 | ~750,000 | ~3.0M | ~12.0M |
| 25 | 5000 | ~6,084 | 390,625 | 1,562,500 | 6,250,000 | 25,000,000 |

Full per-level tag storage is impractical at 1×1; lazy vault hybrid avoids storing all fine tags by default.

---

## 7. Performance model (lazy)

**One modified pixel:** evaluate ~1 unit per level along the ancestry (plus siblings only when a parent fails — typically 4 children checked at 4×4/2×2, 4 at 1×1 inside failed 2×2). Far below 12M ops.

**100×100 region:** units intersecting the rect at each scale (see `estimateLazyOpsForRect`); still ≪ full-frame 1×1.

Known bottleneck remains Phase 3A per-cell HMAC; 4A adds negligible geometry cost.

---

## 8. Result contract

```ts
HierarchicalLocalizationContract {
  productionClaim: '8x8_cell';      // 4A mandatory
  plannedClaim: '1x1_pixel';        // not emitted as live claim yet
  cryptoImplementedLevels: ['64x64','8x8'];
  canonicalLevels: ['64x64','8x8','4x4','2x2','1x1'];
  levels: { ... optional skeleton units ... };
  drillDown: { order: [...], description };
  referenceStrategy / authModel / note;
}
```

Returned only when `SPATIAL_HIERARCHY_ENABLED=true`; otherwise `null`.

---

## 9. UI drill-down contract

```
IMAGE → 64×64 overview → 8×8 → 4×4 → 2×2 → 1×1 pixels
```

Each unit exposes: `x,y,width,height,status,unitId,parentId,parentScale`.  
UI not fully implemented in 4A — contract only.

---

## 10. Security considerations

- Hierarchy must not bypass Phase 1 / 3A: fine levels only run after parents fail crypto (4B+).  
- Transplant / relocation / wrong secret / package replay remain blocked by existing layers.  
- Parent/child mismatch: child outside parent geometry is invalid (`containsRect`).  
- Do not trust client-supplied hierarchy maps (same rule as Phase 3C).

---

## 11. Limitations (4A)

- No cryptographic verification at 4×4 / 2×2 / 1×1 yet.  
- Statuses at those levels are `NOT_EVALUATED`.  
- Must not advertise `1x1_pixel` production claim.

---

## 12. What remains for Phase 4B

- Cryptographic authentication for 4×4 (first fine level below 8×8) and/or begin 1×1 path inside failed cells  
- Single-pixel detection tests with real HMAC vs vault reference  
- Wire lazy verify into `verify-exact` without changing Phase 1/3A formulas  
- Keep claim `8x8_cell` until 4D validated
