# PINIT-DNA — Protected Download Implementation Report

**Date:** 29 June 2026  
**Status:** Implemented (non-breaking, additive)

---

## 1. Files Modified

| File | Change |
|------|--------|
| `src/services/vault/protected-download.service.ts` | **NEW** — verification + decrypt orchestration |
| `src/api/controllers/vault.controller.ts` | Added `prepareProtectedDownload`, `protectedDownloadFromVault` |
| `src/api/routes/vault.routes.ts` | Two new routes |
| `client/src/services/dashboard.api.ts` | API helpers for protected download |
| `client/src/pages/VaultPage.tsx` | Protected Download button + modal with step UI |
| `tests/vault/protected-download.test.ts` | **NEW** — unit tests |
| `.env.example` | `PROTECTED_DOWNLOAD_ENABLED` documented |

**Unchanged:** `vault.service.ts` store/retrieve, encryption, DNA generate, certificates issue flow, compare engine.

---

## 2. New Download Flow

```
Owner clicks "Protected Download" (Vault Explorer)
        ↓
POST /vault/:id/protected-download
        ↓
1. Verify ownership (JWT + requireVaultOwnership)
2. Decrypt AES-256-GCM (existing vault.retrieve)
3. Verify DNA record status (COMPLETE/PARTIAL)
4. Verify certificate (if issued — blocks if REVOKED/INVALID)
5. Verify embedded identity (identityEmbeddingService.extractAndVerify)
6. Stream decrypted bytes UNCHANGED
        ↓
Audit log: PROTECTED_DOWNLOAD
        ↓
Browser saves file with original filename
```

Optional prepare-only endpoint (no double download on server if client uses download only):

```
POST /vault/:id/protected-download/prepare → JSON steps manifest
```

---

## 3. How Forensic Identity Is Preserved

| Mechanism | Preserved? | Why |
|-----------|------------|-----|
| 15-Layer DNA in database | ✅ | Unchanged — registry entry intact |
| Identity embedding (LSB/EXIF/tail) | ✅ | Decrypt returns exact bytes stored at vault time |
| Layer 6 steganography | ✅ | Embedded before encryption at vault store |
| Vault/DNA/Certificate IDs | ✅ | In DB + embedded in file + response headers |
| Watermarks | ✅ | No re-encoding or stripping on download |
| File bytes | ✅ | **No transformation** — only decrypt ciphertext |

Protected Download **does not** re-embed, watermark, or modify the file. It returns the same buffer that was encrypted after `identityEmbeddingService.embed()` at vault store time.

---

## 4. How DNA Compare Recognizes Downloaded + Modified Files

After Protected Download, the owner can edit the file externally. DNA Compare continues to work because:

1. **DNA registry** — original 15-layer fingerprints remain in `dna_records`
2. **Perceptual/structural layers** — survive JPEG recompression, crop, resize (Phase 1/2 enhancements when enabled)
3. **Embedded identity** — `PINIT-DNA:v1:{dnaId}:{vaultId}:{ownerId}:{hmac}` survives many transforms
4. **Auto-compare** — searches registry by lightweight DNA
5. **Verify Leaked File** — extracts embedded identity from redistributed copies

Protected Download does **not** invalidate any of these — it delivers the identity-bearing file as stored.

---

## 5. Database Changes

**None.** Uses existing `vault_records`, `dna_records`, `certificates` tables. Audit events logged via existing `auditService`.

---

## 6. Performance Impact

| Operation | Added latency |
|-----------|---------------|
| Protected Download vs Retrieve | +50–200ms (DNA status + cert verify + identity extract) |
| Vault store | Unchanged |
| DNA Compare | Unchanged |

Single decrypt per download (client uses one API call).

---

## 7. Backward Compatibility

| Check | Status |
|-------|--------|
| `POST /vault/:id/retrieve` | ✅ Unchanged |
| Retrieve & Decrypt in detail modal | ✅ Kept (secondary action) |
| Generate DNA flow | ✅ Unchanged |
| Share links / TEP | ✅ Unchanged |
| `PROTECTED_DOWNLOAD_ENABLED=false` | Returns 503 on new endpoints only |

---

## 8. Testing Instructions

### Local backend

1. Generate DNA + vault a test image
2. Issue certificate (optional — download works with warning if missing)
3. Open Vault Explorer → click shield icon (**Protected Download**)
4. Confirm step UI: Verifying DNA → Certificate → Preparing → Download Ready
5. Open downloaded file — should match decrypted retrieve bytes
6. Upload modified copy to **DNA Compare** — should match original vault record

### API

```bash
# Prepare (JSON steps)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://localhost:4000/api/v1/vault/{vaultId}/protected-download/prepare

# Download file
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -o downloaded.jpg \
  https://localhost:4000/api/v1/vault/{vaultId}/protected-download
```

Check response headers: `X-PINIT-Protected-Download: true`, `X-DNA-Record-Id`, `X-Vault-Id`.

### Unit tests

```bash
npm test -- tests/vault/protected-download.test.ts
```

---

## Conclusion

Protected Download adds a **forensically safe owner export path** to Vault Explorer. It verifies DNA, certificate, and embedded identity before delivery while returning **unmodified file bytes** — ensuring downstream DNA Compare and leak verification continue to recognize the asset after real-world modifications.

---

*End of report*
