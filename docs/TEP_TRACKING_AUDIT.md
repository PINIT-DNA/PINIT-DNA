# TEP / Protected Download Tracking Audit

## Root cause (fixed)

```
✓ TEP Package generation attempted
✓ Download request reached backend (POST /vault/:id/protected-download)
✗ TEP package insert failed
Reason: watermark_profiles.recipientId FK to recipient_profiles
         Protected download passed recipientId = "owner:<userId>"
         which is not a RecipientProfile row
✗ createTrackedExport threw → caught → file served WITHOUT TEP
✗ No reliable download custody event (only optional provenance on TEP success)
```

## Repair

1. `createWatermarkProfile` — only set `recipientId` FK when a real `RecipientProfile` exists; keep logical recipient (`owner:…`) in JSON payload.
2. `protectedDownloadFromVault` — always append `DOWNLOADED` to `forensic_provenance_events` (IP/geo/device/TEP code), even if TEP embed fails.
3. Response headers: `X-TEP-Code`, `X-PINIT-Download-Event-Id`, `X-PINIT-TEP-Tracking: full|partial|off`.

## What PINIT can and cannot do

| Capability | Status |
|------------|--------|
| Record protected download event (who, when, IP/geo, TEP id) | **Yes** |
| Embed TEP markers for later recovery via Investigation | **Yes** (when embed succeeds) |
| Continuously track file on another device offline | **No** — requires PINIT viewer, re-upload/investigation, or another PINIT touchpoint |

## Investigation

`forensicProvenanceService.getTimeline` loads `DOWNLOADED` / `PROTECTED_EXPORT` / TEP rows into **Evidence Timeline** and `provenanceSummary.downloadCount`.
