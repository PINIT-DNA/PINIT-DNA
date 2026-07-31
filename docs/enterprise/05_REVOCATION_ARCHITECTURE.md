# PINIT-DNA — Revocation Architecture

**Document version:** 1.0  
**Primary references:** `src/services/provenance/revoke.service.ts`, `src/services/share/share-link.service.ts`, `src/services/certificates/certificate.service.ts`, `src/services/tep/tep.service.ts`

---

## 1. Revocation Principles

| Principle | Detail |
|-----------|--------|
| DNA is never revoked | DNA records are immutable identity anchors |
| Revocation is metadata-level | Changes access rights and registry status, not file bytes |
| Append-only audit | Revocation events are logged; prior events are never deleted |
| Downloaded files persist | Bytes already on a user's device cannot be remotely deleted |

---

## 2. Revocation Matrix

### 2.1 Share Links

| Item | Can Revoke? | Mechanism | File |
|------|-------------|-----------|------|
| Active share link | Yes | `isActive = false` | `share-link.service.ts` |
| Future access via link | Yes | 404 on revoked token | Share controller |
| Per-viewer access | Yes | `BlockedShareViewer` row | `blockViewer()` |
| One-time links | Auto-revoke | First view triggers revoke | `share-link.service.ts` |
| High-risk links | Auto-revoke | Risk score ≥ 85 + suspicious actions | `share-link.service.ts` |
| Already-viewed sessions | Partial | Force-logout via link revoke | Implemented |
| Downloaded file from share | No | Bytes already exported | Web limitation |
| Provenance REVOKED event on share revoke | No | Not Yet Implemented | Legacy synthesis only |

### 2.2 Protected Download

| Item | Can Revoke? | Mechanism |
|------|-------------|-----------|
| Future protected downloads | N/A | Each download is a new event |
| TEP package tied to download | Yes | TEP revoke (see below) |
| Already-downloaded file | No | Web limitation |
| Download event record | No | Append-only; cannot un-record |

### 2.3 TEP (Tracked Export Package)

| Item | Can Revoke? | Mechanism | File |
|------|-------------|-----------|------|
| TEP manifest status | Yes | `status = REVOKED` | `revoke.service.ts` |
| Provenance REVOKED event | Yes | `forensicProvenanceService.append()` | `revoke.service.ts` |
| API endpoint | Yes | `POST /vault/:id/tep/:tepCode/revoke` | `vault.controller.ts` |
| Watermark/tail in exported file | No | Embedded bytes remain |
| TEP re-discovery on upload | Yes (partial) | Shows REVOKED in dashboard; extraction still matches | Not Yet Implemented: block on REVOKED |
| TEP expiry enforcement | No | `expiresAt` stored but not enforced | Not Yet Implemented |

### 2.4 Certificates

| Item | Can Revoke? | Mechanism |
|------|-------------|-----------|
| Certificate validity | Yes | `status = REVOKED`, `revokedAt` set |
| Future verification | Yes | Verification fails |
| Investigation reference | Partial | Timeline shows REVOKED via legacy synthesis |
| Live provenance REVOKED append | No | Not Yet Implemented on revoke action |
| DNA record | No | Immutable |

### 2.5 Future: PINIT Viewer (Planned)

| Item | Expected capability | Status |
|------|---------------------|--------|
| Revoke viewer session | Planned | Not Yet Implemented |
| Block file open after revoke | Planned — requires PINIT-controlled viewer | Not Yet Implemented |
| Real-time access revocation | Planned | Not Yet Implemented |

### 2.6 Future: Native App (Planned)

| Item | Expected capability | Status |
|------|---------------------|--------|
| Device-bound licence revocation | Planned | Not Yet Implemented |
| Encrypted container invalidation | Planned | Not Yet Implemented |
| Offline revocation cache sync | Planned | Not Yet Implemented |

---

## 3. What Cannot Be Revoked — Technical Reasons

| Asset | Why |
|-------|-----|
| Downloaded file bytes | HTTP download transfers a copy; server has no filesystem access to recipient device |
| Embedded watermark / TEP tail | Cryptographic markers are part of file content; revocation changes registry only |
| DNA fingerprint | Immutable by design — identity cannot be "un-issued" |
| Append-only provenance events | Audit integrity requires no deletion |
| Investigation reports already generated | Reports are point-in-time sealed manifests |

---

## 4. Legal Limitations

| Limitation | Explanation |
|------------|-------------|
| Jurisdiction | Revocation of access links is enforceable server-side; physical file possession is not |
| Third-party platforms | WhatsApp, email, cloud drives are outside PINIT control |
| Evidence admissibility | Revocation timestamp proves intent; does not destroy copies already distributed |
| DMCA / takedown | Separate workflow; not automated in current codebase |

---

## 5. Enterprise Recommendations

1. **Use Protected Download** for sensitive exports — creates TEP + custody event with IP/geo/device.
2. **Set share link expiry** and one-time links for high-risk recipients.
3. **Revoke TEP promptly** when recipient relationship ends — status visible in Tracking Dashboard.
4. **Revoke certificates** when ownership transfers or evidence is invalidated.
5. **Plan native viewer** for scenarios requiring post-download access control.
6. **Do not assume WhatsApp tracking** — forward events are not captured by web application.

---

## 6. Why Downloaded Files Cannot Be Remotely Deleted (Web Application)

```
Owner clicks Protected Download
        |
        v
Server encrypts/decrypts vault file
        |
        v
Server embeds TEP watermark + tail
        |
        v
HTTP response sends file bytes to browser
        |
        v
Browser saves to local disk / shares via OS
        |
        v
[ SERVER LOSES CONTROL ]
        |
        v
File exists independently on recipient device
```

**Technical facts:**

- Web browsers do not grant servers write access to user filesystems after download.
- HTTPS delivers a **copy**; the original vault ciphertext remains on Supabase Storage.
- Revocation can only invalidate **future server-mediated access** (links, TEP registry, certificates).
- Re-upload to Investigation is the recovery mechanism for tracing leaked copies.

---

## 7. Why Native Applications Provide Stronger Control

| Web (current) | Native app (planned) |
|---------------|----------------------|
| File saved to OS filesystem | File opened in PINIT encrypted container |
| No open-event telemetry after download | Viewer can report OPENED events |
| Watermark is passive marker | Active licence check on each open |
| Revocation is registry-only | Revocation can block container decryption |
| No background monitoring | Optional device policy integration |

Native apps can implement:

- Device-bound decryption keys
- Online licence validation before open
- Session heartbeat reporting
- Encrypted export with expiry built into container format

These are **Planned/Future** — not present in the current web codebase.

---

## 8. Revocation API Summary

| Action | Method | Endpoint |
|--------|--------|----------|
| Revoke share link | DELETE | `/api/v1/share/:token` |
| Block viewer | POST | `/api/v1/share/:token/block-viewer` |
| Revoke TEP | POST | `/api/v1/vault/:id/tep/:tepCode/revoke` |
| Revoke certificate | POST | `/api/v1/certificates/revoke/:id` |
| Revoke auth session | DELETE | `/api/v1/profile/session/:id` |

---

*End of document*
