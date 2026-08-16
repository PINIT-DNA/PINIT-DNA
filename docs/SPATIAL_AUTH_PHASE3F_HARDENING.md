# Spatial Auth — Phase 3F Security / Package / Serialization Hardening

**Phase type:** Hardening only (L1/L2/L3 from Phase 3E).  
**Not changed:** HMAC-SHA256 · HKDF-SHA256 · Merkle · 64×64 · 8×8 · tag sizes · GLPM/LSB/L6/L12/robust.

Cross-links: [Phase 3E](./SPATIAL_AUTH_PHASE3E_SECURITY.md) · [Phase 3A](./SPATIAL_AUTH_PHASE3A.md) · [Phase 1](./SPATIAL_AUTH_PHASE1.md)

---

## 1. Previous findings (Phase 3E)

| ID | Finding | Severity |
|----|---------|----------|
| L1 | Blob decoders accepted trailing bytes | Low |
| L2 | Cell/block row reorder was silently re-sorted | Low/Info |
| L3 | Pipe-joined (`\|`) MAC / colon-joined HKDF info strings | Low (latent) |

---

## 2. Changes made

1. **Strict blob parsing** — after parse, `offset === blob.length` or reject.  
2. **Canonical order validation** — ascending IDs required; duplicates rejected; **no repair-by-sort** on decode.  
3. **Versioned crypto serialization** — new `*.v1.1` algorithm versions use length-prefixed binary fields; legacy `*.v1` kept verifiable.

---

## 3. Serialization format

### Legacy (`pipe-v1`) — `spatial-auth-v1` / `spatial-pixel-auth-v1`

Unchanged exact behavior:

- MAC payloads: UTF-8 strings joined by `|`
- HKDF info: UTF-8 strings joined by `:`

### Hardened (`lpbin-v1.1`) — `spatial-auth-v1.1` / `spatial-pixel-auth-v1.1`

Deterministic binary payload:

1. Domain string as **u16 BE length + UTF-8 bytes**
2. Each field:
   - `str` → u16 BE length + UTF-8  
   - `u16` → 2-byte big-endian  
   - `u32` → 4-byte big-endian  
   - `bytes` → u16 BE length + raw bytes  

Properties: locale-independent, no JSON, no whitespace dependence, explicit endianness, unambiguous even if strings contain `|` or `:`.

Merkle **leaf** hashing was already binary (prefix + fixed-width ints + tag) and is unchanged.

---

## 4. Canonical ordering

| Blob | Order |
|------|-------|
| `SPB1` blockBlob | `scale` ascending; within scale `blockId` ascending |
| `SPX1` pixelAuthBlob | `cellId` ascending |

Encode still **writes** canonical order.  
Decode **validates** order and duplicates; it does **not** silently re-sort attacker data.

---

## 5. Versioning

| Constant | Value | Role |
|----------|-------|------|
| `SPATIAL_AUTH_ALGORITHM_VERSION_V1` | `spatial-auth-v1` | Legacy verify |
| `SPATIAL_AUTH_ALGORITHM_VERSION_V1_1` | `spatial-auth-v1.1` | **New enroll default** |
| `SPATIAL_PIXEL_ALGORITHM_VERSION_V1` | `spatial-pixel-auth-v1` | Legacy verify |
| `SPATIAL_PIXEL_ALGORITHM_VERSION_V1_1` | `spatial-pixel-auth-v1.1` | **New enroll default** |

Verifier accepts both members of each supported set.  
Unknown versions → `UNSUPPORTED_VERSION`.  
Do **not** reinterpret v1 blobs/tags under v1.1 crypto (or vice versa).

---

## 6. Strict parser behavior

Reject (throw → mapped to `INVALID_*_PACKAGE`):

- empty blob  
- truncated structure  
- bad magic  
- trailing bytes  
- out-of-order IDs  
- duplicate IDs  
- unsupported `tagBytes` (not 8 or 16) in pixel blob  

---

## 7. Backward compatibility

- Existing **valid** production packages stamped `spatial-auth-v1` / `spatial-pixel-auth-v1` remain verifiable.  
- New enrollments use **v1.1** (hardened serialization + HKDF info encoding).  
- No migration rewrite required for stored v1 packages.  
- Optional re-enroll to v1.1 for new packages only.

**Migration:** none mandatory. Re-enroll when ready to mint hardened packages.

---

## 8. Domain separation

Unchanged conceptual domains (versioned encodings):

| Context | Domain / info id |
|---------|------------------|
| Block HMAC | `A` + algo fields |
| Pixel cell HMAC | `P3` + algo fields |
| Merkle leaf | `SPATIAL-LEAF-v1` / `SPATIAL-PIXEL-LEAF-v1` |
| Root MAC | `ROOT-MAC-v1` |
| Pixel root MAC | `PIXEL-ROOT-MAC-v1` |
| HKDF block | `pinit-spatial-block-hmac-v1` |
| HKDF root | `pinit-spatial-root-mac-v1` |
| HKDF pixel | `pinit-spatial-pixel-hmac-v1` |
| HKDF pixel root | `pinit-spatial-pixel-root-mac-v1` |

---

## 9. Fuzz testing

`tests/spatial/spatial-auth-phase3f-hardening.test.ts` mutates headers, lengths, magic, truncation, trailing bytes, and mid-blob bytes. Parser must not crash; malformed input must not yield trusted MATCH.

---

## 10. Security implications

| Finding | Status |
|---------|--------|
| L1 trailing bytes | **FIXED** |
| L2 canonical ordering | **FIXED** |
| L3 serialization ambiguity | **FIXED** (new version; legacy preserved) |

Hardening does not increase localization resolution and does not change Mode A exact-vs-robust boundary.

---

## 11. Migration requirements

- **None** for verifying existing v1 packages.  
- New enrollments automatically mint v1.1.  
- To mint legacy v1 in tests/tools, pass `algorithmVersion: 'spatial-auth-v1'` / `'spatial-pixel-auth-v1'`.

---

## Files

**Created:** `crypto-encoding.ts`, `SPATIAL_AUTH_PHASE3F_HARDENING.md`, `spatial-auth-phase3f-hardening.test.ts`  
**Modified:** config versions, key derivation, block/cell MAC builders, root MACs, blob decoders, verify version gates, Phase 3E expectations for L1/L2
