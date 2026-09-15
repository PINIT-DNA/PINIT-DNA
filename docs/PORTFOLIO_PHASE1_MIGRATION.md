# Phase 1 — migration plan

Inspection of everything listed in §4, then the plan. Written before code.

---

## A. What is there now

| Piece | State | Verdict |
|---|---|---|
| `exchange.portfolio_profiles` | 22 columns, **2 live rows** (`PINIT-EX-DSPUSQ76`, `PINIT-EX-6QGDDPMF`), both `unlisted` | Legacy owner. Migrate out, keep until proven. |
| `portfolio-bridge.service.ts` | HUB → Exchange **HTTP PUT** | Wrong direction. Delete the write in Phase 1. |
| HUB `/portfolio/me` | Mounted, `401` unauthenticated, `requireAuth` → `req.user.sub` | Correct. Reuse; take identity from `sub`, never the client. |
| Portfolio Editor | `PortfolioEditor.tsx`, 6 sections, saves through the bridge | Keep the shell, repoint persistence, add real toolbar. |
| Public + preview renderer | `PortfolioPages.jsx` — one component, both surfaces | Correct already. Move to HUB, do not fork. |
| `portfolio-ledger.js` | Reads `exchange.hub_assets` | Wrong source. Rewrite against HUB. |
| `exchange.hub_assets` | Mirror of HUB assets | Not authoritative. Verified must stop using it. |
| HUB `Asset` | `ownerUserId`, `vaultId`, `dnaId`, `certificateId`, `contentHash` | Everything collections need. |
| HUB `AssetVersion` | `dnaRecordId`, `vaultId`, `certificateId`, `contentHash` | Per-version provenance. |
| HUB `DnaRecord` | `sha256Hash`, `status`, `engineVersion`, `createdAt` | Real provenance. |
| Exchange `listings` | Marketplace owner | Stays Exchange's. Shop reads only. |
| `/p/:slug` | Exchange only (`PublicPortfolio.jsx`) | Move canonical to HUB; Exchange redirects. |
| HUB public route tier | `/s/:token`, `/share/:token`, `/client-report/:token` — outside `<RequireAuth>` | `/p/:slug` joins this tier. Precedent exists. |
| Migration convention | `prisma/migrations/<ts>/migration.sql` **plus** `scripts/ensure-*.cjs` | Production boots the ensure chain, not `migrate deploy`. |

### The §7 finding that matters

**Human %, AI % and badge tier are not HUB columns.** `grep humanPercent prisma/schema.prisma` → nothing.

They are *derived* in `exchange-bridge.service.ts::badgeFromAnalysis()` from
`VaultRecord.contentAnalysis` (JSON), with tier computed `>=80 Gold, >=60 Silver, else Bronze`.

So Verified reads:

```
Asset ──vaultId──> VaultRecord.contentAnalysis   → human % / AI %  (may be null)
      ──dnaId────> DnaRecord.sha256Hash, status, createdAt
      ──certificateId                             → certificate reference
```

Tier is computed by reusing `badgeFromAnalysis`, not re-implemented. When
`contentAnalysis` is null the row shows **unavailable** — per §27, nothing is
invented.

---

## B. Schema to add (HUB)

```
Portfolio          id, userId(unique), slug(unique), theme, visibility,
                   draft Json, published Json?, publishedAt?, publishedVersion,
                   createdAt, updatedAt

PortfolioCollection id, portfolioId, slug, title, description,
                    coverAssetId?, position, isPublished

PortfolioItem       id, collectionId, assetId, position, isFeatured
                    @@unique([collectionId, assetId])
```

`PortfolioItem.assetId` → `Asset.id`. No copies; vault, DNA, certificate and
ownership relationships stay exactly where they are.

**Draft vs published (§6):** `draft` is the working document; `published` is a
frozen snapshot written only by Publish. `/p/:slug` renders `published`;
Preview renders `draft` for the owner. Two columns, not one flag.

---

## C. Migration

1. Additive Prisma models + `scripts/ensure-portfolio.cjs`, wired into the ensure chain.
2. **Backfill** the 2 Exchange rows into HUB, matching `PINIT-EX-<CODE>` → `User.shortId`. Additive; Exchange rows untouched.
3. Verify the migrated portfolio renders identically to the current public page.
4. Repoint `/portfolio/me` GET+PUT at Prisma. Delete the bridge write.
5. Exchange keeps serving `/p/:slug` until Phase 3 moves it, then redirects.

**Rollback:** nothing is deleted. Reverting the controller restores the old path,
because the Exchange rows are still the same rows.

---

## D. Order of work

1. Prisma models + ensure script + migration SQL
2. `portfolio.service.ts` in HUB — draft/publish, ownership from `sub`
3. `/portfolio/me` GET/PUT + `/portfolio/publish` against Prisma
4. Backfill script, run and verified
5. Editor toolbar: real state, Draft/Published, URL, Preview/Copy/Save/Publish
6. Bridge write removed

Phase 1 ends when a portfolio round-trips through HUB's own database and the
public page still renders from the migrated data.

---

## E. Risks

- **Two live rows, one is the account owner's.** Backfill is additive; the
  originals stay until Phase 6 proves the new path.
- **Schema drift has bitten three times** (`requirements.buyer_pinit_id`,
  `users.display_name`, `portfolio_profiles.theme/template/collaborations`).
  Everything here goes through the ensure chain.
- **Slug collisions** — Exchange slugs are normalised (`ashwitha-reddy` and
  `ashwithareddy` resolve to one row). Backfill must carry the stored slug and
  keep the normaliser, or old links break.
- **`/p/` origin move** changes where shared links point. Exchange redirects.
