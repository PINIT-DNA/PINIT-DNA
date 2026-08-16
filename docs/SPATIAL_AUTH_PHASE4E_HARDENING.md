# Spatial Auth — Phase 4E (1×1 Cryptographic Hardening + Production Reference)

**Audit fix:** Phase 4D verdict **B** (live HMAC both sides) → enrolled tag verification.

> Candidate HMAC is compared against an **independently enrolled** dense tag blob (SP1T), not against a live HMAC of vault RGB.

**Production claim (unchanged):** `8x8_cell`  
**Flag:** `SPATIAL_1X1_AUTH_ENABLED` (default `false`)

---

## Architecture choice

| Option | Verdict |
|--------|---------|
| A — Dense per-pixel tags in one blob | **Chosen** |
| B — Full Merkle proofs per pixel | Higher complexity; similar storage if all leaves kept |
| C — Single image commitment only | Insufficient for per-pixel enrolled tags |
| D — Reuse 8×8 blob | Wrong scale |

**Why A:** Independently enrolled 8-byte HMAC tags for every pixel in one `Bytes` column (not millions of rows). O(1) lazy lookup by `y*width+x`. Content-hash root + root MAC authenticate the blob. Enrollment cost is one-time; verify still ≤4 lookups per failed 2×2.

Storage ≈ `width * height * tagBytes` (+ small header). Example: 12MP × 8 ≈ 96MB blob (acceptable as package blob, not DB rows).

---

## Production reference integration

`verifyExactSpatialAuthForDna`:

1. Load `SpatialAuthPackage` for DNA  
2. Decode candidate under `file-pixel-order-v1`  
3. If 4B/4C/4D flags on → `loadVaultSpatialReferenceRgb(dnaRecordId, ownerUserId)` from vault  
4. Pass `referenceRgb` into `verifyExactSpatialAuth`  

**Never** accepts client-supplied reference. Missing vault → fine layers `trusted=false` (`REFERENCE_UNAVAILABLE` / parent untrusted).

---

## Enrollment

When `SPATIAL_1X1_AUTH_ENABLED`:

For each pixel: `HMAC(K, lpbin P1 | algo | dna | ref | parent2x2Id | x | y | w=1 | h=1 | R | G | B)` → 8-byte tag  

Pack into SP1T blob → `pixel1AuthRoot = SHA256(tags)` → `pixel1RootMac`  

Persisted on `SpatialAuthPackage` (`pixel1AuthBlob`, `pixel1AuthRoot`, `pixel1RootMac`, …).

---

## Verification

After trusted 2×2:

1. Decode SP1T; verify root hash + root MAC  
2. For each pixel under failed 2×2 (≤4):  
   `tagCand = HMAC(K, bind(candidate RGB…))`  
   `tagEnrolled = blob[y*w+x]`  
   `timingSafeEqual` → AUTHENTIC / TAMPERED  

**Not** `HMAC(ref)` vs `HMAC(cand)`.

---

## Trust / binding

- Position: `x,y` in HMAC  
- Parent: `parent2x2Id` in HMAC  
- Image/DNA: `dnaRecordId`, `globalDnaRef`, root MAC  
- Secret: HKDF from `SPATIAL_AUTH_SECRET` / masterSecret — never in package  

---

## Limitations

- Global claim still `8x8_cell`  
- Vault identity-embedding may diverge from enroll-time RGB → 4B reference `MATCH` can fail until enroll uses post-vault bytes  
- Full-frame enroll cost scales with megapixels  
- Exact mode only (`file-pixel-order-v1`)
