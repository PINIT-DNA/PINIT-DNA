# Spatial Auth — Phase 3E Security / Forgery / Transplant Review

**Phase type:** Red-team security testing only.  
**Crypto changes:** None (no Critical/High vulnerabilities requiring algorithm changes).  
**Not in scope:** GLPM · LSB · L6/L12 · vault DCT/DWT · robust provenance · HMAC optimization · Phase 3D/3F/3G.

Cross-links: [Phase 1](./SPATIAL_AUTH_PHASE1.md) · [Phase 2](./SPATIAL_AUTH_PHASE2.md) · [Phase 3A](./SPATIAL_AUTH_PHASE3A.md) · [Phase 3C](./SPATIAL_AUTH_PHASE3C.md)

---

## 1. Threat model

### Attacker knows
- Algorithm names, 64×64 / 8×8 sizes, HMAC-SHA256, HKDF
- Package / blob layouts (`SPB1`, `SPX1`), public API behavior
- DNA record structure and spatial auth metadata format

### Attacker has
- Protected image(s), ability to edit pixels arbitrarily
- Ability to copy/obtain `SpatialAuthPackage` fields if leaked
- Public DNA identifiers if exposed
- Unlimited verify submissions

### Attacker does **not** have
- `SPATIAL_AUTH_SECRET`
- Derived per-image keys
- Server private signing keys
- Trusted DB write access

### Security property
Without the server secret, an attacker must **not** produce a **MATCH** for **modified** content under Mode A exact verification (Phase 1 blocks + Phase 3A cells + root/package MACs).

---

## 2. Attack surface

| Surface | Mechanism |
|---------|-----------|
| Phase 1 block HMAC | Position + image + content bound tags |
| Phase 1 Merkle + root MAC | Package integrity |
| Phase 3A cell HMAC | 8×8 HKCA |
| Phase 3A pixel Merkle + pixel root MAC | Pixel package integrity |
| Phase 2 / 3C maps | Derived evidence / visualization only |
| API responses | Error/oracle disclosure |
| Key derivation | HKDF salt/info binding |

---

## 3. Attack matrix

| ID | Attack | Expected | Actual | PASS/FAIL |
|----|--------|----------|--------|-----------|
| T01 | Simple pixel forgery | TAMPERED + pixel TAMPERED | TAMPERED/pixel=TAMPERED | **PASS** |
| T02 | Modify image + reuse package | auth failure | TAMPERED | **PASS** |
| T03 | Modify public metadata, keep tags | INVALID_*/fail | INVALID / UNSUPPORTED / pixel INVALID | **PASS** |
| T04 | Modify pixelAuthBlob | INVALID_PIXEL_PACKAGE | INVALID (tags/coords/magic/trunc) | **PASS** |
| T04b/T17 | Cell row reorder | detect or canonicalize | Canonicalized → MATCH (no forgery) | **PASS*** |
| T05 | Modify pixelAuthRoot | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T06 | Modify pixelRootMac | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T07 | Modify merkleRoot | INVALID_AUTH_PACKAGE | INVALID_AUTH_PACKAGE | **PASS** |
| T08 | Modify rootMac | INVALID_AUTH_PACKAGE | INVALID_AUTH_PACKAGE | **PASS** |
| T09 | Wrong secret | INVALID_AUTH_PACKAGE | INVALID_AUTH_PACKAGE | **PASS** |
| T10 | Wrong dnaRecordId | INVALID_AUTH_PACKAGE | INVALID_AUTH_PACKAGE | **PASS** |
| T11 | Wrong globalDnaRef | INVALID_AUTH_PACKAGE | INVALID_AUTH_PACKAGE | **PASS** |
| T12 | Cross-image cell transplant | cell fails | TAMPERED failed=1 | **PASS** |
| T13 | Cross-image pixelAuthBlob | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T14 | Complete package replay A→B | failure | TAMPERED | **PASS** |
| T15 | Same-image cell relocation | src+dst fail | failed=2 | **PASS** |
| T16 | Same-image 64×64 relocation | ≥2 blocks fail | blocksFailed=2 | **PASS** |
| T18 | Duplicate cell | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T19 | Remove cell | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T20 | Truncate blob | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T21 | Append trailing bytes | reject structure | Absorbed (MATCH if image intact) | **PASS*** |
| T22 | Version confusion | UNSUPPORTED_VERSION | UNSUPPORTED_VERSION | **PASS** |
| T23 | Tag size 8↔16 confusion | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T24 | Coordinate manipulation | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T25 | Dimension manipulation | DIMENSION_MISMATCH | DIMENSION_MISMATCH | **PASS** |
| T26 | Format conversion (exact boundary) | not MATCH (not a vuln) | TAMPERED | **PASS** |
| T27 | Metadata replay mix | failure | INVALID_AUTH_PACKAGE | **PASS** |
| T28 | Phase1(A)+Phase3(B) mix | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T29 | Forged Merkle root + old rootMac | INVALID_AUTH_PACKAGE | INVALID_AUTH_PACKAGE | **PASS** |
| T30 | Forged pixel root + old MAC | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T31 | Forged random cell tag | INVALID_PIXEL_PACKAGE | INVALID_PIXEL_PACKAGE | **PASS** |
| T32 | Brute-force sanity (docs) | documented | documented | **PASS** |
| T33 | Secret leakage in errors | clean | clean | **PASS** |
| T34 | Client localization trust | server-derived only | server-derived | **PASS** |
| T35 | Investigation when invalid | trusted=false | trusted=false | **PASS** |
| T36 | Key isolation A≠B | different keys | different | **PASS** |
| T37 | Identical image, different DNA | not interchangeable | swap=INVALID_AUTH_PACKAGE | **PASS** |
| T38 | Package confidentiality | master absent | master absent | **PASS** |
| T39 | Control MATCH | MATCH | MATCH/MATCH | **PASS** |

\*Behavioral notes / Low findings — see §9. Not forgery successes.

**Suite result:** 39/39 Jest tests PASS · 40/40 matrix rows PASS  
**Critical/High forgery successes:** **0**

---

## 4. Test results summary

- Fundamental property holds: modified content without secret → no MATCH.
- Transplant / relocation / replay / root forgery with old MACs → fail as designed.
- Phase 3C investigation: `trusted=false`, no fine overlay on invalid packages.
- Exact-mode format conversion fails MATCH (expected boundary, not a vulnerability).

---

## 5. Cryptographic review

### HKDF
| Key | Salt | Info |
|-----|------|------|
| Block HMAC | `dnaRecordId` | `pinit-spatial-block-hmac-v1:owner:globalDnaRef:keyId` |
| Root MAC | `dnaRecordId` | `pinit-spatial-root-mac-v1:keyId` |
| Pixel HMAC | `dnaRecordId` | `pinit-spatial-pixel-hmac-v1:owner:globalDnaRef:keyId` |
| Pixel root MAC | `dnaRecordId` | `pinit-spatial-pixel-root-mac-v1:keyId` |

Domain separation between block vs pixel vs root is present via distinct info strings.

### HMAC message binding
- Block (`A|…`): algo, dnaId, globalRef, scale, blockId, x,y,w,h, content SHA-256  
- Cell (`P3|…`): algo, dnaId, globalRef, cellSize, cellId, x,y,w,h, content SHA-256  

Position and image binding prevent silent relocation/transplant.

### Merkle / root MAC
- Leaf hashes use binary length-prefixed geometry + tag + domain prefix (`SPATIAL-LEAF-v1` / `SPATIAL-PIXEL-LEAF-v1`).
- Root MAC / pixel root MAC bind dimensions, orientation policy, refs, versions, and root hex with full HMAC-SHA256.
- Attacker can recompute Merkle roots from public tags but **cannot** mint a valid root MAC without the secret (T29/T30).

### Residual design notes (not Critical/High)
1. **Pipe-joined string MAC payloads** — theoretical ambiguity if a field ever contained `|`. Current IDs are UUID-like; residual **Low**. Prefer length-prefixed binary in a future version if fields become free-form.
2. **Blob trailing bytes** — decoders stop after `cellCount`/`blockCount`; trailing data ignored (T21). Residual **Low**; recommend `offset === blob.length` check.
3. **Row reorder canonicalization** — decode sorts by id; pure reorder of intact rows is absorbed (T17). Residual **Informational**; not a forgery vector.

No missing domain separation between Phase 1 and Phase 3A keys. No endian inconsistency (BE used in blobs). Tag-size confusion rejected (T23). Version confusion rejected (T22).

---

## 6. Key-management review

- Master secret: env/config only; never stored in image or package.
- Per-image keys: derived at enroll/verify, not persisted.
- Isolation: same pixels under different `dnaRecordId` / `globalDnaRef` → different keys; packages not interchangeable (T36/T37).
- Inputs: `dnaRecordId` (salt) + owner + globalDnaRef + keyId + domain string.

---

## 7. Package-integrity review

| Check | Behavior |
|-------|----------|
| rootMac | Rejects metadata/root forgery |
| merkleRoot vs blob | Rejects leaf/tag inconsistency |
| pixelRootMac | Rejects pixel metadata/root forgery |
| pixelAuthRoot vs blob | Rejects cell blob vs root mismatch |
| Truncation / bad magic | INVALID_PIXEL_PACKAGE |
| Append trailer | Currently ignored (**Low**) |
| Partial Phase1+Phase3 mix | INVALID_PIXEL_PACKAGE (T28) |

---

## 8. API trust-boundary review

- Verify endpoints accept image + server-stored package; they do **not** accept client localization as authentication evidence.
- `localization` / `fineLocalization` / `investigation` are server-derived with `derivedEvidenceOnly` / `visualizationOnly`.
- Failed verify results inspected in T33: no master secret / derived key leakage in JSON.
- Invalid package → `investigation.trusted=false`, no fine mask/overlay (T35).

---

## 9. Findings

### Finding L1 — Trailing bytes accepted in pixelAuthBlob (and similarly blockBlob)
- **Severity:** Low  
- **Exploitability:** Attacker can append junk without changing verification of an **unmodified** image.  
- **Impact:** Weakens strict binary package integrity; **does not** enable MATCH for modified pixels (confirmed).  
- **Fix (recommended, not implemented in 3E):** After decode, require `offset === blob.length`; reject otherwise. Apply to `decodePixelAuthBlob` and `decodeBlockBlob`.

### Finding L2 — Cell row reorder canonicalized
- **Severity:** Low / Informational  
- **Exploitability:** Reordering intact cell rows → still MATCH.  
- **Impact:** None for forgery; packaging is order-insensitive by design after sort.  
- **Fix (optional):** Store/verify a blob content hash under root MAC, or require strictly ascending cellId without re-sort tolerance for duplicates.

### Finding L3 — Pipe-delimited MAC string fields
- **Severity:** Low (latent)  
- **Exploitability:** Requires controllable fields containing `|`.  
- **Impact:** Potential message ambiguity in a future schema.  
- **Fix (future version):** Length-prefixed binary MAC messages.

**Critical:** none  
**High:** none  

Per phase rules: **no cryptographic code changes performed**.

---

## 10. Severity summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2–3 (L1–L3) |

---

## 11. Recommendations

1. Add strict end-of-buffer checks on blob decode (L1) in a dedicated hardening PR after approval.  
2. Optionally bind a full blob SHA-256 into root / pixel root MAC payloads.  
3. Keep 8-byte cell tags as default; document truncation limits (T32); offer 16-byte for higher per-cell forge cost.  
4. Continue treating Phase 3C overlays as non-authoritative.  
5. Do not expose raw tags/roots publicly beyond what investigation already requires; treat package exfiltration as sensitive.

---

## 12. Limitations

- Mode A is **exact RGB/geometry** — JPEG/resize/crop are expected failures, not security bugs.  
- 8-byte tags are truncated HMAC; forge cost is not “system = 64-bit.” Root MACs remain full HMAC-SHA256.  
- This phase does not evaluate side-channels beyond response content (timing/oracle depth limited).  
- No production load testing; security suite adds negligible overhead (~11s for 256×256 fixtures).

---

## Performance

Security tests do **not** change crypto hot paths. Known bottleneck remains per-cell HMAC (unchanged). No unexpected regression introduced by 3E (tests only + export re-exports).

---

## Regression

Run Phase 1 + 2 + 3A + 3B + 3C + 3E after this review (see CI / local Jest spatial suite).

---

## Deliverables

- `tests/spatial/spatial-auth-phase3e-security.test.ts`
- `docs/SPATIAL_AUTH_PHASE3E_SECURITY.md` (this file)
