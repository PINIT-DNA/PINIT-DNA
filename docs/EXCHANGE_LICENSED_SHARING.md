# Exchange Licensed-Asset Sharing, Tracked in Hub

**Status: backend implemented and verified end-to-end on the local stack against the
live database. Exchange UI (Share button + modal) not yet built. Not committed/pushed.**

A buyer who licenses an asset on Pinit Exchange can now create a share link for it.
The link is created and served by **Hub**, so every view and download flows through
Hub's existing share viewer and `ShareAccessLog` tracking — no tracking is duplicated
in Exchange.

---

## Context — why this was needed

Before this change, a buyer who completed a purchase received a one-shot delivery token
(`prepareDelivery` → `redeemDelivery` → `protectedDownloadService.prepare`) and nothing
else. There was no way to share the licensed file, and no visibility into where it
travelled afterwards.

Hub already had a complete, mature sharing and tracking system that Exchange simply
could not reach:

- **`ShareLink`** — token, expiry, max views/downloads, one-time use, OTP, allowed
  countries/devices/IP prefixes, privacy masking, plus `ownerUserId`, `parentLinkId`
  and `depth` (re-share hop chains already modelled).
- **`ShareAccessLog`** — IP, city/country/region/ISP, browser/OS/device, device
  fingerprint, referrer, screen resolution, GPS + accuracy, risk score/level/factors,
  session duration, per-`action`.
- **Routes** (`src/api/routes/share.routes.ts`) — public viewer, owner analytics
  (`/:token/logs`, `/:token/tree`, `/:token/export`), `/analytics/{geo,global,live-map}`,
  live sessions, force-logout, block-viewer, leak attribution.

So this work was **not** "build tracking" — it was "connect Exchange licenses to Hub's
existing tracking, keyed canonically on `Asset.id`".

Two blockers made it non-trivial:

1. **`createShareLink` was owner-only.** It requires `vaultId` + `ownerUserId` from the
   caller's JWT behind `requireAuth` + `requireFeature(FEATURE_SMART_SHARE)`. A buyer
   holds a *license*, not custody, and is not the vault owner.
2. **Nothing linked a share to an Exchange license**, and `ShareLink` was keyed on
   `vaultId`/`dnaRecordId` — the same vault-centric pattern behind the `Asset.id` bugs
   fixed earlier. `AssetTimelineEvent` (real FK to `Asset`) had **zero** Exchange rows
   and its enum had no listing/sale/share values.

### Product decisions (confirmed with the product owner)

| Decision | Choice |
|---|---|
| Who can share | **Any licensed buyer**, regardless of tier. License terms are *recorded* on the link, not enforced as a hard block. |
| Who sees activity | **Both** — buyer sees their own share's analytics; creator sees that their asset was shared and where it went. |
| Plan gating | Licensed shares are **exempt** from `FEATURE_SMART_SHARE`/`FEATURE_TRACKING` — the Exchange purchase already paid for it. |

License-tier *enforcement* of redistribution rights was deliberately **not** built.

---

## Flow

```
Exchange "My Purchases" → Share
  → Exchange: POST /api/commerce/purchases/:sealId/share    (verifies caller owns the seal)
  → Hub bridge: POST /exchange/share/create                  (X-PinIT-Bridge-Secret)
       { assetId, sealId, orderId, buyerPinitId, licenseTier, options }
  → Hub: resolveVaultIdFromExchangeId(assetId) → vaultId
         resolvePinitIdToUser(buyerPinitId)    → Hub User.id
         shareLinkService.create({ vaultId, ownerUserId: buyer, sourceContext:'exchange_license', … })
  → returns Hub-hosted shareUrl:  {HUB}/s/:token
```

Everything after link creation is **existing Hub machinery** — same viewer, same
`recordAccess`, same `ShareAccessLog` enrichment, same re-share/hop tree.

`Asset.id` is the only identifier that crosses the boundary; Hub resolves it to custody
internally via `resolveVaultIdFromExchangeId()`.

---

## Authorization

Two independent layers, because neither alone is sufficient:

1. **Exchange proves the caller owns the seal** — `orders_sealed.buyer_pinit_id` is
   compared against the caller's Pinit ID before the bridge is called. Comparison is on
   the bare Pinit code so `PINIT-EX-x` and `PINIT-x` forms of one identity match. Also
   rejects a non-`active` license.
2. **The bridge secret authenticates the service**, not the end user.

`shareLinkService.create()` skips its owner assertion **only** when
`sourceContext === 'exchange_license'` (and then requires `exchangeSealId`). Ordinary
Hub shares keep `assertRecordOwner` unconditionally — the buyer is deliberately not the
vault owner, which is the whole point of this path.

---

## Schema changes (additive only)

`ShareLink`:
```prisma
assetId         String?   // canonical Asset.id
sourceContext   String    @default("hub")   // "hub" | "exchange_license"
exchangeOrderId String?
exchangeSealId  String?
licenseTier     String?
@@index([assetId])
@@index([exchangeSealId])
```

`AssetTimelineType` — new values: `LISTED`, `SOLD`, `SHARED`, `SHARE_VIEWED`,
`SHARE_DOWNLOADED`.

Migration: `prisma/migrations/20260819130000_exchange_licensed_share/`.

> **The migration is hand-written, not generated.** `prisma migrate diff` also proposes
> `DROP TABLE "spatial_auth_packages"` — that table exists in the database but is absent
> from `schema.prisma` (pre-existing drift). Dropping it would destroy live DNA data, so
> the migration contains only the additive changes. **Reconcile that drift before running
> any generated migration.** Verified after applying: `spatial_auth_packages` still exists.

---

## Provenance — the `AssetTimelineEvent` gap

Exchange events previously wrote only **vault-keyed** `PlatformEvent` rows, so the
commercial half of an asset's history was unreachable from `Asset.id`. Now
`AssetTimelineEvent` rows (real FK to `Asset`) are written at listing, sale and share:

```
created → protected → LISTED → SOLD → SHARED → SHARE_VIEWED / SHARE_DOWNLOADED
```

Also fixed here: `confirmSale` used to mint its **own** `sealId`, producing two
unjoinable ids for one sale (Hub `SEAL-0DC71194` vs Exchange `SEAL-490522`). It now
persists Exchange's `sealId` and only falls back to minting when none is supplied.

---

## Files changed

**Hub**
- `prisma/schema.prisma` — `ShareLink` fields, `AssetTimelineType` values
- `prisma/migrations/20260819130000_exchange_licensed_share/migration.sql`
- `src/services/exchange/exchange-bridge.service.ts` — `createLicensedShare()`,
  `getLicensedSharesForOwner()`, `buildHubShareUrl()`, `resolvePinitIdToUser()`,
  `recordAssetTimelineEvent()`; `LISTED`/`SOLD` events; Exchange `sealId` persisted
- `src/api/controllers/exchange-bridge.controller.ts` — `createLicensedShareBridge`,
  `listLicensedSharesForOwner`; `sealId` passthrough
- `src/api/routes/exchange.routes.ts` — `POST /exchange/share/create`,
  `GET /exchange/licensed-shares`
- `src/services/share/share-link.service.ts` — new input fields; conditional owner assertion
- `src/api/controllers/share-link.controller.ts` — `requireTrackingUnlessLicensedShare`
- `src/api/routes/share.routes.ts` — conditional gate on `/:token/logs`

**Exchange**
- `exchange/server/hub-client.js` — `createLicensedShareOnHub()`
- `exchange/server/routes/commerce.js` — `POST /purchases/:sealId/share`

---

## Verification performed

`npx tsc --noEmit` clean; `node --check` clean on changed Exchange files. Live run on the
local stack (Hub :4000, Exchange :5000) against the real database:

| Check | Result |
|---|---|
| Buyer creates share for `SEAL-490522` | ✅ `201` → `http://localhost:3000/s/KTapsQHL32` |
| **Different user tries same purchase** | ✅ **`403` "This purchase does not belong to you"** |
| `ShareLink` row | ✅ `assetId=134c63bb…`, `sourceContext=exchange_license`, `exchangeSealId=SEAL-490522`, `exchangeOrderId=ORD-78830`, `licenseTier=commercial`, owner = buyer, vault resolved |
| `AssetTimelineEvent` | ✅ `SHARED` keyed on `Asset.id` — "Shared by licensee — commercial license · seal SEAL-490522" |
| Public share info (no auth) | ✅ `200` |
| Record access | ✅ `200`, `viewCount` → 1 |
| `ShareAccessLog` | ✅ `VIEWED` · recipient · IP · device · geo · `risk=LOW` |
| `spatial_auth_packages` after migration | ✅ still present (destructive drop excluded) |

---

## Not done / open

- **Exchange UI** — Share button + options modal on the Purchases page, and a
  "View activity" link into Hub. Backend is ready and callable.
- **Creator-facing surface** — `GET /exchange/licensed-shares` exists and is auth-scoped
  to assets the caller owns, but is not yet rendered in the Hub UI.
- **`SHARE_VIEWED` / `SHARE_DOWNLOADED` timeline events** — enum values and the writer
  helper exist; they are not yet emitted from `recordAccess`/`serveSharedFile`, so view
  and download activity currently lands in `ShareAccessLog` only, not on the asset timeline.
- **Automated tests** — verification so far is manual/live; no unit or integration tests
  were added for the new paths.
- **Role-switch bug** (`exchange/server/routes/auth.js` login `UPDATE` omits `role`) —
  worked around with a manual DB flip. `PINIT-EX-N29WYF9D` is currently set to `buyer`
  and must be flipped back to `creator` when testing ends.
- **`HUB_API_URL` unset on the Exchange Render service** — production previews still fall
  back to `localhost:4000`.
