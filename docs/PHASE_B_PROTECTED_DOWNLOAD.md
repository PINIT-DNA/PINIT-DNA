# Phase B — Protected Download + TEP (local branch)

**Branch:** `feature/protected-download-v2`  
**Push:** Do not push until local verification is approved.

## Architecture

```
Vault → Protected Download → TEP package → Emit download event → Return file
```

Tracking never blocks download. DNA / Acceptance / Ranking unchanged.

## Provenance module (`src/services/provenance/`)

| File | Role |
|------|------|
| `event-bus.ts` | In-process emit/on |
| `download-event.service.ts` | Append `DOWNLOADED` |
| `revoke.service.ts` | TEP → REVOKED + custody event |
| `timeline.service.ts` | Read timeline for reports |
| `chain-of-custody.service.ts` | Ordered custody projection |
| `tracking-dashboard.service.ts` | Per-vault dashboard payload |
| `geo-ip.service.ts` | IP → country/city (no invent) |

Storage remains append-only `forensic_provenance_events` (unified event store).

## APIs

| Method | Path |
|--------|------|
| POST | `/vault/:id/protected-download` body: `{ recipientLabel?, purpose?, expiryDays? }` |
| GET | `/vault/:id/tracking` |
| POST | `/vault/:id/tep/:tepCode/revoke` |

## UI (Vault Explorer)

- Protected Download form (recipient, purpose, expiry)
- Tracking Dashboard (TEP list, downloads, custody, Revoke)

## Local test checklist

1. `npx prisma migrate deploy` (table must exist)
2. `npm run dev` (or full stack)
3. Vault → Protected Download → note TEP code
4. Tracking icon → see download history
5. Revoke TEP → status REVOKED
6. Unified Investigation on a recovered copy → Evidence Timeline shows downloads

## Not in Phase B

- PINIT Viewer (view-only, no download)
- Native `.pinit` apps (Phase F)
- AI enhancements (Phase G)
