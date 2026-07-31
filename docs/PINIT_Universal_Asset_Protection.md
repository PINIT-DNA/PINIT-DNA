# PinIT Universal Asset Protection — Implementation Notes

## Architecture summary

```
Asset (aggregate)
  → VaultRecord / DnaRecord / Certificate / MonitorRecord
  → ProtectedPost (optional publish surface)
  → AssetDiscovery / AssetTimeline
```

Platforms remain adapters only. Protection logic stays in existing Vault / DNA / Certificate / Monitoring / Publish Guardian services.

## New database tables

- `assets`
- `asset_timeline_events`
- `asset_discoveries`
- Enums: `AssetType`, `AssetStatus`, `AssetTimelineType`
- Additive column: `protected_posts.assetId` (nullable FK)

Migration: `prisma/migrations/20260729100000_universal_asset_protection/`

## New APIs

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/v1/assets/protect` | JWT |
| GET | `/api/v1/assets` | JWT |
| GET | `/api/v1/assets/stats` | JWT |
| GET | `/api/v1/assets/:id` | JWT |
| PATCH | `/api/v1/assets/:id/status` | JWT |

Existing `/extension/publish-protect` now also creates/links an Asset (`assetId` in response).

## Extension changes (v1.2.0)

- Protect-on-export (`content/export-protect.js`) for Canva, Figma, Adobe Express/Photoshop/Illustrator Web
- Photographer pack adapters: Flickr, 500px, SmugMug, Pixieset, Zenfolio, Adobe Portfolio, Squarespace, Wix
- `capturedVia` propagated through queue → API
- Options groups: Social / Creators / Photography / Business

## UI changes

- `/assets` — Assets dashboard (stats, filters)
- `/assets/:id` — detail (timeline, discoveries, linked Protected Posts, fingerprints)
- Sidebar + Topbar entries; Protected Posts unchanged

## Migration steps

1. Stop backend if Prisma engine is locked
2. `npx prisma generate`
3. `npx prisma migrate deploy`
4. Restart backend
5. Reload Chrome/Edge extension
6. Open Hub `/assets`

## Testing checklist

- [ ] Existing Protected Posts list/detail still works
- [ ] Extension publish-protect still returns vault/dna/cert
- [ ] New protect creates Asset + links `protectedPost.assetId`
- [ ] Right-click Protect creates Asset
- [ ] Canva/Figma export prompt does not block download
- [ ] `/assets` and `/assets/:id` load for signed-in user
- [ ] Video/document fingerprint helpers unit tests pass
- [ ] Asset lifecycle rejects ARCHIVED → MONITORING

## Remaining future roadmap

- HubSpot / Marketo / Google Business Profile deep connectors
- Amazon Seller (API-first)
- Distributed monitoring workers (Redis/BullMQ)
- Auto Unified Investigation on CRITICAL asset discoveries
- Richer Canva/Figma export byte capture (beyond confirm + URL/blob)
