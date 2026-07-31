# PINIT-DNA — Chain of Custody

**Document version:** 1.0  
**Primary references:** `src/services/forensics/forensic-provenance.service.ts`, `src/services/provenance/chain-of-custody.service.ts`, `docs/FORENSIC_PROVENANCE.md`

---

## 1. Principle

**DNA is immutable identity. Custody is append-only events.**

Lifecycle tracking (who did what, when, from where) is stored in `forensic_provenance_events` and synthesised from legacy tables. DNA layers are never modified after generation.

---

## 2. File Lifecycle Flow

```
File Created (user upload)
        |
        v
DNA Generated --------------------> Event: DNA_GENERATED
        |                           Source: dna.orchestrator.ts, universal engines
        v
Encrypted (AES-256-GCM) ---------> Event: ENCRYPTED
        |                           Source: vault.service.ts
        v
Stored in Vault -----------------> Event: VAULT_STORED
        |                           Source: vault.service.ts, vault.controller.ts
        v
Certificate Issued (optional) ---> Event: CERTIFICATE_ISSUED
        |                           Source: certificate.service.ts
        v
Protected Download / TEP --------> Events: PROTECTED_EXPORT, TEP_CREATED, DOWNLOADED
        |                           Source: tep.service.ts, download-event.service.ts
        v
Shared (Smart Link) -------------> Events: SHARED, OPENED (legacy synthesis)
        |                           Source: share_links, share_access_logs
        v
Viewed (share viewer) -----------> Event: OPENED
        |                           Source: share_access_logs (legacy synthesis)
        v
Recovered (re-upload) -----------> Status: REDISCOVERED on TEP table
        |                           Provenance RECOVERED: Not Yet Implemented
        v
Investigation -------------------> Event: INVESTIGATED
        |                           Source: unified-investigation.orchestrator.ts
        v
Tamper Detected -----------------> Event: TAMPERED (when tamper vectors found)
        |
        v
Revoked (optional) --------------> Event: REVOKED
                                    Source: revoke.service.ts, certificate revoke
        |
        v
Report Generated ----------------> Sealed investigation manifest (point-in-time)
```

---

## 3. Event Types

Declared in `PROVENANCE_EVENT_TYPES` (`forensic-provenance.service.ts`):

| Event Type | Runtime Append | Source |
|------------|----------------|--------|
| DNA_GENERATED | Yes | DNA orchestrator / universal router |
| ENCRYPTED | Yes | vault.service.ts |
| VAULT_STORED | Yes | vault.service.ts, vault.controller.ts |
| CERTIFICATE_ISSUED | Yes | certificate.service.ts |
| DOWNLOADED | Yes | download-event.service.ts |
| PROTECTED_EXPORT | Yes | tep.service.ts (owner protected download) |
| TEP_CREATED | Yes | tep.service.ts (share download) |
| SHARED | Legacy synthesis | share_links table |
| OPENED | Legacy synthesis | share_access_logs |
| FORWARDED | Not Yet Implemented | Declared only |
| RECOVERED | Not Yet Implemented | TEP uses REDISCOVERED status instead |
| INVESTIGATED | Yes | unified-investigation.orchestrator.ts |
| TAMPERED | Yes | unified-investigation.orchestrator.ts |
| CRAWLER_DETECTION | Not Yet Implemented | Declared only |
| REVOKED | Partial | TEP revoke yes; certificate via legacy synthesis |

---

## 4. Event Record Fields

Table: `forensic_provenance_events`

| Field | Description |
|-------|-------------|
| id | UUID primary key |
| createdAt | Timestamp (append-only) |
| eventType | One of PROVENANCE_EVENT_TYPES |
| dnaRecordId | Link to DNA record |
| vaultId | Link to vault record |
| certificateId | Link to certificate |
| tepCode | TEP package code |
| shareLinkId | Share link ID |
| investigationId | Investigation session ID |
| actorUserId | User who triggered event |
| actorLabel | Human-readable actor (e.g. recipient label) |
| summary | Event description |
| payload | JSON additional data |
| country, region, city | Geo from IP or GPS |
| latitude, longitude | GPS coordinates (when shared) |
| locationSource | ip / gps / none |
| ipAddress | Client IP |
| userAgent | Browser user agent |
| device | Parsed device string |
| dedupeKey | Prevents duplicate writes |

---

## 5. Database Tables Involved

| Table | Role in custody |
|-------|-----------------|
| forensic_provenance_events | Primary append-only event store |
| dna_records | DNA identity anchor |
| vault_records | Encrypted file storage metadata |
| certificates | Issued ownership certificates |
| tracked_export_packages | TEP manifests |
| share_links | Smart link definitions |
| share_access_logs | Viewer access events |
| metadata_layer | EXIF/GPS at DNA generation |
| watermark_profiles | Per-recipient watermark records |
| verification_logs | DNA verification runs |

**Migration:** `prisma/migrations/20260704140000_forensic_provenance_events/migration.sql`  
**Bootstrap script:** `scripts/ensure-provenance-table.cjs` (for databases without Prisma migrate history)

---

## 6. Chain of Custody Service

**File:** `src/services/provenance/chain-of-custody.service.ts`

Read-only projection for reports. Steps ordered:

1. DNA Generated  
2. Encrypted  
3. Vault Stored  
4. Certificate Issued  
5. Protected Export / TEP Created  
6. Downloaded  
7. Shared  
8. Opened  
9. Recovered  
10. Investigated  
11. Tampered  
12. Revoked  

Unknown event types appended after ordered types, sorted by timestamp.

Consumed by: `tracking-dashboard.service.ts`, investigation reports (`evidenceTimeline`, `provenanceSummary`).

---

## 7. Location in Custody Chain

Location is **custody evidence**, not DNA:

| Location type | Source |
|---------------|--------|
| Creation | EXIF GPS from metadata_layer OR DNA_GENERATED provenance event with GPS |
| Shared | Latest DOWNLOADED / PROTECTED_EXPORT / SHARED event with geo |
| Present (last known) | Most recent provenance event with geo for DNA record |

Function: `getLocationStatusForAssets()` in `forensic-provenance.service.ts`  
Optional client GPS: `client/src/lib/location-consent.ts` at DNA generation and vault store.

---

## 8. Current Implementation Status

| Feature | Status |
|---------|--------|
| Append-only provenance table | Implemented |
| Legacy timeline synthesis | Implemented |
| Chain-of-custody report projection | Implemented |
| Vault tracking dashboard | Implemented |
| Event bus (in-process) | Implemented — `src/services/provenance/event-bus.ts` |
| Live SHARED append on link create | Not Yet Implemented |
| FORWARDED / RECOVERED / CRAWLER_DETECTION events | Not Yet Implemented |
| Dedicated download_events table | Not Yet Implemented (uses provenance payload) |
| Certificate revoke provenance append | Not Yet Implemented (legacy synthesis only) |

---

## 9. Future Improvements

| Improvement | Description | Status |
|-------------|-------------|--------|
| Native app OPENED events | Report when file opened in PINIT viewer | Planned |
| CRAWLER_DETECTION append | Write provenance when monitor finds file | Planned |
| Share revoke provenance | Live REVOKED on share link deactivate | Planned |
| Async event queue (BullMQ/Redis) | Non-blocking provenance writes at scale | Planned |
| Formal chain hash linking | Each event hashes previous event ID | Planned |
| GPS continuous tracking | Background location after download | Planned — requires native app |

---

*End of document*
