# PINIT-DNA — Protected Download and TEP

**Document version:** 1.0  
**Primary references:** `src/services/tep/tep.service.ts`, `src/services/vault/protected-download.service.ts`, `src/services/provenance/download-event.service.ts`, `docs/TEP_TRACKING_AUDIT.md`

---

## 1. What is TEP?

**TEP (Tracked Export Package)** is PINIT-DNA's system for exporting vault files with embedded forensic tracking markers. Version in code: **TEP v3.0**.

TEP creates a unique package record (`tepCode`) linked to DNA, vault, recipient, and export metadata. The exported file carries:

1. Steganographic/metadata watermark  
2. Structural binary tail (`TEP-MANIFEST:...:END-TEP-MANIFEST`) with HMAC signature  
3. Optional identity re-embedding from vault download pipeline  

**TEP is not DNA.** TEP tracks custody of exported copies. DNA remains the immutable identity anchor.

---

## 2. Two Export Channels

| Channel | Trigger | shareLinkId pattern | Provenance event |
|---------|---------|---------------------|------------------|
| Owner Protected Download | POST `/vault/:id/protected-download` | `protected-download:{vaultId}` | PROTECTED_EXPORT + DOWNLOADED |
| Share Link Download | Share viewer download | Real ShareLink.id | TEP_CREATED + DOWNLOADED |

---

## 3. Protected Download Flow

```
User selects Protected Download in Vault UI
        |
        v
POST /vault/:id/protected-download/prepare
        |  Ownership check, decrypt preview, steps list
        v
POST /vault/:id/protected-download
        |
        +--> protectedDownloadService.prepare()
        |       Ownership, decrypt, DNA check
        |       Certificate verify (if cert exists)
        |       Identity verify + re-embed token
        |
        +--> tepService.createTrackedExport() [if TEP enabled]
        |       Embed watermark + structural tail
        |       Write tracked_export_packages row
        |       Append PROTECTED_EXPORT / TEP_CREATED
        |
        +--> recordProtectedDownload()
        |       Append DOWNLOADED provenance event
        |       Emit event bus: download.recorded
        |
        v
HTTP response: file bytes + headers
        X-PINIT-Download-Event-Id
        X-TEP-Code
        X-PINIT-TEP-Tracking: full | partial | off
```

**Failure policy:** If tracking fails, download still proceeds (`tepTrackingFailed` flag in response headers).

---

## 4. TEP Generation

**File:** `src/services/tep/tep.service.ts`

| Step | Action |
|------|--------|
| 1 | Generate unique `tepCode` |
| 2 | Create watermark profile for recipient |
| 3 | Embed watermark (PDF metadata, image EXIF, DOCX XML, or pass-through) |
| 4 | Append HMAC-signed structural tail to file bytes |
| 5 | Compute `exportSha256`, `sourceSha256`, `watermarkHash` |
| 6 | Store `TrackedExportPackage` row |
| 7 | Append provenance event (non-blocking) |

### TrackedExportPackage fields

| Field | Description |
|-------|-------------|
| tepCode | Unique package identifier |
| dnaRecordId | Linked DNA |
| vaultId | Linked vault |
| shareLinkId | Channel identifier |
| recipientId | Recipient profile or logical owner ID |
| watermarkCode | Watermark profile code |
| sourceSha256 | Original vault file hash |
| exportSha256 | Exported file hash |
| embeddedLayers | JSON list of embedded layer types |
| ipAddress, country, region, city | Geo from client IP |
| userAgent, device | Client device info |
| ownerUserId | Vault owner |
| expiresAt | Expiry timestamp (default 90 days) |
| status | ACTIVE / EXPIRED / REVOKED / REDISCOVERED |

---

## 5. Information Recorded Per Download

| Field | Recorded? | Storage location |
|-------|-----------|------------------|
| IP address | Yes | provenance event + TEP row |
| Country | Yes | Geo-IP lookup via `geo-ip.service.ts` |
| City | Yes | Geo-IP lookup |
| Region | Yes | Geo-IP lookup |
| Browser / User agent | Yes | Request header |
| Device | Yes | Parsed from user agent |
| Timestamp | Yes | `createdAt` on event and TEP row |
| Owner | Yes | `ownerUserId`, actor fields |
| Vault ID | Yes | `vaultId` |
| DNA Record ID | Yes | `dnaRecordId` |
| Certificate ID | Yes | When applicable |
| Recipient label | Yes | Request body `recipientLabel` |
| Purpose | Yes | Request body `purpose` |
| Expiry days | Yes | Request body `expiryDays` |
| TEP ID (tepCode) | Yes | TEP row + response header |
| Download Event ID | Yes | UUID in payload + `X-PINIT-Download-Event-Id` header |
| GPS (client) | Partial | Only if user grants location at vault store / DNA generation |

**No dedicated `download_events` table** — events stored in `forensic_provenance_events` with `downloadEventId` in JSON payload.

---

## 6. What TEP Can Track Today

```
IMPLEMENTED TODAY:
  [x] Record that a protected download occurred
  [x] Record IP, country, city, region (via Geo-IP)
  [x] Record browser, device, timestamp
  [x] Record recipient label and purpose
  [x] Assign unique TEP code per export
  [x] Embed recoverable markers in exported file
  [x] Re-discover exported file when re-uploaded to PINIT
  [x] Display download timeline in Vault Tracking Dashboard
  [x] Revoke TEP package (registry status)
  [x] Include download events in investigation report timeline

NOT TRACKED TODAY:
  [ ] Where file goes after download (WhatsApp, email, USB)
  [ ] Who opens file on another device
  [ ] Continuous GPS of exported file
  [ ] Automatic notification when file appears online (requires Monitor)
  [ ] Enforcement of TEP expiry date
  [ ] Blocking extraction of revoked TEP files
```

---

## 7. TEP Re-Discovery

When a TEP-marked file is uploaded again:

| Step | File | Status |
|------|------|--------|
| Extract tail manifest | `tep.service.ts extractFromFile()` | Implemented |
| Match TrackedExportPackage | By exportSha256 | Implemented |
| Mark REDISCOVERED | `duplicate-check.service.ts` | Implemented |
| Audit log TEP_REDISCOVERED | audit.service.ts | Implemented |

---

## 8. Tracking Dashboard

**Endpoint:** `GET /api/v1/vault/:id/tracking`  
**Service:** `src/services/provenance/tracking-dashboard.service.ts`

Displays:

- TEP packages for vault  
- Download events  
- Chain of custody links  
- Location status (creation / shared / present)  
- Revoke action per TEP  

**UI:** `client/src/pages/VaultPage.tsx` — TrackingDashboardModal

---

## 9. Environment Flags

| Variable | Default | Effect |
|----------|---------|--------|
| TEP_PROTECTED_DOWNLOAD_ENABLED | true | TEP embedding on protected download |
| PROTECTED_DOWNLOAD_ENABLED | true | Protected download feature gate |

---

## 10. Limitations

| Limitation | Detail |
|------------|--------|
| Web-only export | File leaves PINIT control after HTTP download |
| WhatsApp sharing | No server-side forward event |
| localhost Geo-IP | Returns generic/empty geo in development |
| TEP expiry | Stored but not enforced at extraction |
| Revoked TEP | Status changes in DB; file bytes unchanged |
| TXT/CSV share watermark | Pass-through — no embed on some MIME types |
| Free-tier Render cold start | First download may delay 30–90 seconds |

---

## 11. Future Native App Enhancements (Planned)

| Enhancement | Description |
|-------------|-------------|
| PINIT Viewer | Open exports only in controlled viewer; report OPENED events |
| Device-bound TEP | Decryption key tied to device registration |
| Offline custody queue | Sync provenance events when device reconnects |
| GPS at download | Native geolocation permission with higher accuracy |
| Expiry enforcement | Block open after expiresAt |
| Push notification on re-discovery | Alert owner when TEP file investigated |

---

## 12. API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/vault/:id/protected-download/prepare` | Preview steps |
| POST | `/vault/:id/protected-download` | Execute download + TEP |
| GET | `/vault/:id/tracking` | Tracking dashboard data |
| POST | `/vault/:id/tep/:tepCode/revoke` | Revoke TEP package |
| GET | `/tep/manifests?dnaRecordId=` | List TEP manifests |

---

*End of document*
