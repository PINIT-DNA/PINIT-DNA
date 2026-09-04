# Portfolio rebuild — inspection and plan

Written before any code, per the "inspect first" instruction. Everything below
was read from the repository, not assumed.

---

## 1. The finding that changes everything

**HUB has no portfolio model.** `prisma/schema.prisma` contains zero portfolio
tables — `grep -i portfolio` returns nothing across 100+ models.

The entire portfolio lives in **Exchange**, in `exchange.portfolio_profiles`.

So the current direction is the **inverse** of the requirement:

```
REQUIRED                          ACTUAL TODAY
HUB owns the data                 Exchange owns the data
Exchange reads it                 HUB edits it remotely
                                    via portfolio-bridge.service.ts
                                    → PUT /api/hub/portfolio
```

`src/services/exchange/portfolio-bridge.service.ts` proves it: HUB's editor
does not write to a HUB table. It HTTP-PUTs to Exchange, which is the store.

Every other rule in the brief (one source of truth, no duplicate data, Exchange
read-only) depends on inverting this first. Nothing else is worth building on
the current arrangement.

---

## 2. What already exists and must be reused

| Need | Exists as | Reuse |
|---|---|---|
| Person / profile | `User` — `fullName`, `avatarUrl`, `bio`, `country`, `jobTitle`, `shortId` | About reads these; never copy them |
| Protected work | `Asset`, `AssetVersion`, `VaultRecord`, `DnaRecord` | Collections reference by id |
| Provenance | `DnaRecord`, certificate ids on `AssetVersion` | Verified reads these |
| Controlled previews | `previewVaultFile(vaultId, {thumb})` | Portfolio media; no second pipeline |
| Public page precedent | `ShareViewerPage.tsx` (public, no auth), `GET /certificates/verify/:id` (public) | `/p/:slug` follows this pattern |
| Exchange listings | `exchange.listings` | Shop reads read-only |
| Renderer | `PortfolioPages.jsx` + `VerifiedLedger.jsx` | Already the six headings; move, don't rewrite |

**Already correct and worth keeping:** one renderer for public page and preview
(the duplicate renderer was deleted), the six-heading IA, Shop hiding itself
when empty, collections with their own URLs, the visibility model.

---

## 3. What is wrong and must change

1. **Source of truth is in the wrong product.** As above.
2. **Verified reads a mirror, not the record.** `portfolio-ledger.js` queries
   `exchange.hub_assets`, which is Exchange's *copy*. The brief requires actual
   HUB protection records — `DnaRecord` / `AssetVersion`.
3. **Collections store `vault_ids` as loose JSON** in an Exchange text column.
   They should be rows referencing HUB assets, with ordering and a cover.
4. **No draft/published split.** There is `visibility` only. Save and Publish
   currently do the same thing plus a flag.
5. **No per-piece URL.** `/p/:slug/work/:collection/:piece` is unsupported.
6. **Exchange can still write.** `SellerPortfolio` changes visibility via PUT.
   Under the brief, Exchange must not write portfolio data at all.

---

## 4. Plan

### Phase 1 — Move the source of truth to HUB
New Prisma models (`Portfolio`, `PortfolioCollection`, `PortfolioItem`), owned
by `User`. Migration follows the repo's two-artifact rule: a
`prisma/migrations/<ts>/migration.sql` plus a `scripts/ensure-*.cjs`, because
production boots through the ensure chain rather than `migrate deploy`.

Backfill the two live `portfolio_profiles` rows into HUB. Keep the Exchange
table readable during the transition; stop writing to it at the end of Phase 6.

`portfolio.controller.ts` writes to Prisma instead of proxying to Exchange.

### Phase 2 — Collections over real HUB assets
`PortfolioItem` references `Asset`/`VaultRecord` by id — never a copy. Editor
gains create/name/describe/select/remove/reorder/cover/feature. Selection state
reads "3 of 51 selected from your vault" from the real vault count.

### Phase 3 — Public renderer on HUB
Move `PortfolioPages.jsx` and `VerifiedLedger.jsx` into the HUB client. Serve
`/p/:slug` publicly, following `ShareViewerPage`. Routes:
`/p/:slug`, `/work`, `/work/:collection`, `/work/:collection/:piece`,
`/about`, `/verified`, `/contact`.

Verified switches to real `DnaRecord` / certificate reads. Where a field does
not genuinely exist, the column is omitted — not invented.

### Phase 4 — Shop
Read the creator's active `exchange.listings` through the existing bridge,
read-only. Hidden entirely when the count is zero.

### Phase 5 — Themes and responsive
Four themes as presentation skins only — no IA or data-model change. Mobile
designed rather than shrunk.

### Phase 6 — Exchange becomes read-only
`SellerPortfolio` loses the visibility control and becomes view + copy link +
"Open Portfolio Editor" (deep link to HUB). Exchange's portfolio write
endpoints are removed. Exchange fetches the published portfolio from HUB.

### Phase 7 — Test and verify
Per the brief's checklist, including: Exchange cannot modify, private/unlisted
rules hold, republish in HUB reaches Exchange, no master files exposed.

---

## 5. Risks worth stating

- **The migration touches live data.** Two real portfolios, one belonging to the
  account owner. Backfill is additive and the Exchange rows stay until Phase 6.
- **Schema drift has bitten three times** on this codebase
  (`requirements.buyer_pinit_id`, `users.display_name`,
  `portfolio_profiles.theme/template/collaborations` — each added to SQLite and
  not Postgres). Every migration here goes through the shared ensure chain so it
  cannot happen a fourth time.
- **Serving `/p/` from HUB is a domain move.** Existing links point at the
  Exchange origin. Phase 3 should keep the Exchange route serving a redirect
  rather than breaking shared links.
- **Phases 1 and 3 are the large ones.** 2, 4, 5, 6 are comparatively small.

---

## 6. The one decision needed before Phase 1

The public portfolio currently lives at the **Exchange** origin
(`/p/:slug`, served by `PublicPortfolio.jsx`). The brief says HUB is the source
of truth, which argues for serving the page from HUB too.

Moving it means existing `/p/...` links change origin. Options:

1. **Serve from HUB, redirect the Exchange route** — one canonical home, old
   links keep working. Recommended.
2. **Keep serving from Exchange, reading HUB's API** — no link change, but
   Exchange keeps rendering the page it must not own.

This is a product/URL decision, not a technical one, so it is not mine to make.
