# PinIT Exchange 2027 — Detailed Product Report

**Document type:** Product / market / UI·UX / systems report  
**Audience:** Founders, product, design, engineering, partners, investors  
**Status:** Planning (mockups exist; production Exchange not shipped)  
**Primary product surface:** Desktop **web application** (UI/UX-first). Mobile = later responsive.  
**Date baseline:** July 2026 planning → 2027 category leadership target  

---

## Document map

| Artifact | Path | Purpose |
|---|---|---|
| **This detailed report (Word)** | `docs/PinIT_Exchange_2027_Detailed_Report.docx` | Full narrative + specs + rollout |
| Architecture summary (Word) | `docs/PinIT_Exchange_2027_Product_Architecture.docx` | Compact vision, modules, IA, phases |
| Markdown sources | `docs/PINIT_EXCHANGE_2027_*.md` | Editable source for regenerating DOCX |
| Desktop web mockups (extraordinary) | `mockups/pinit-exchange-extraordinary.html` | **Primary UI** — Adobe-grade + competitor table with links |
| Earlier desktop screens | `mockups/pinit-exchange-web-ui.html` | Earlier web frames |
| Competitor links (Word) | `docs/PinIT_Exchange_2026_Competitor_Links.docx` | All 15 platforms + URLs |
| Canvas | Cursor canvas `pinit-exchange-2027` | Hub vs Exchange + competitor snapshot |

**Open first for UI:** `mockups/pinit-exchange-web-ui.html` in a browser.

---

## 1. Executive summary

### 1.1 One-line thesis

PinIT Hub stays **private** (protect · store · track for the owner).  
PinIT Exchange becomes the **public provenance marketplace** where verified creators sell licenses and buyers purchase with trust — DNA on listings, biometric sellers, post-sale tracking.

### 1.2 Problem we solve

Stock and print marketplaces optimized for **volume downloads**. Creators get:

- Weak proof that the seller is the real author  
- Little visibility after sale (misuse, scrapes, unauthorized reuse)  
- Split workflows: portfolio app ≠ vault ≠ sales desk  
- Pressure toward exclusivity or low royalty tiers  

Buyers get a file and a generic license PDF — not a living provenance trail.

### 1.3 Solution

| Layer | Role |
|---|---|
| **PinIT Hub** | Owner-only protect / vault / certificates / continuous monitoring |
| **PinIT Identity** | Biometric enrollment → PinIT ID → optional Exchange ID (`PX-…`) |
| **PinIT Exchange** | Public sell / buy: showcase, pricing, checkout, sealed sales, tracking hooks |

Creators who sell must complete: **seller plan payment → biometric → billing card → identity proof → auto PinIT ID → Exchange ID → profile → adaptive dashboard**.  
They then **list from Hub** (commerce listing only — vault keys never exposed), set price, sell, seal the sale, and keep tracking.

### 1.4 Positioning vs stock sites

> Stock platforms sell volume downloads. PinIT aims to be first choice by selling **provenance**: biometric sellers, DNA on listings, post-sale tracking — while Hub stays private unless the creator lists an asset.

### 1.5 Current delivery state

| Item | State |
|---|---|
| Hub (protect, vault, DNA, monitoring, Publish Guardian) | In progress / production path exists |
| Exchange architecture + detailed report | **This pack** |
| Desktop web UI mockups | Delivered (`pinit-exchange-web-ui.html`) |
| Exchange React routes / APIs / payments | **Not built** (next engineering phase) |

---

## 2. Product definition

### 2.1 Dual-product boundary (non-negotiable)

```
                    ┌──────────────────────────────┐
                    │     PinIT Identity Layer      │
                    │ Biometric → PinIT ID → PX ID  │
                    └──────────────┬───────────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 ▼                                   ▼
      ┌────────────────────┐              ┌────────────────────┐
      │    PinIT Hub       │   list()     │  PinIT Exchange    │
      │ PRIVATE · owner    │ ───────────► │ PUBLIC marketplace │
      │ Protect / Vault /  │              │ Showcase · Price · │
      │ Track / Certs      │ ◄─────────── │ Buy · License ·    │
      │ Never browsable    │   track()    │ Sealed · Buyer KYC │
      └────────────────────┘              └────────────────────┘
```

**Rules**

1. Hub vault is never a public catalog.  
2. “Post to Exchange” creates a **listing + deliverable package policy**, not a raw vault dump.  
3. DNA / asset graph links Hub `assetId` to Exchange `listingId` without exposing encryption keys.  
4. Buyers never gain Hub owner privileges.  
5. Sealed sale events feed monitoring jobs back into Hub tracking for the creator.

### 2.2 Who Exchange is for

**Creators (sell)**  
Photographers, videographers, graphic / UI-UX / motion / 3D designers, architects, musicians, film studios, podcasters, writers, journalists, educators, AI artists, fashion designers, game developers, influencers, ad agencies, freelancers.

**Buyers (purchase)**  
Marketing teams, ad agencies, SMEs, enterprises, media houses, publishers, e-commerce brands, startups, education, government, production houses, event companies, HR/L&D, real estate, NGOs, legal, AI companies, design studios, recruiters, individual consumers.

### 2.3 What we sell (commerce object)

Exchange does **not** primarily sell “anonymous JPEGs.” It sells:

- **License grants** (standard / extended / exclusive / sync / seat / territory)  
- Bound to **seller identity** (PinIT ID + Exchange ID)  
- Bound to **asset DNA** (hash / forensic fingerprints where available)  
- Accompanied by **buyer identity capture** for sealed ledger  
- Followed by **continuous tracking** of the sold asset family  

---

## 3. Market & competitive report

### 3.1 Category insight

Legacy stock is a **supply race**: more uploads → cheaper licenses → creator cut pressure.  
Premium niches (Stocksy, Picfair, PhotoShelter, event sales) show demand for **control, curation, or direct pricing**.

PinIT’s wedge is **trust + aftermarket**:

| Capability | Typical stock | PinIT Exchange |
|---|---|---|
| Seller identity strength | Account email | Biometric + KYC + PinIT ID |
| Originality signal | Editorial review (variable) | DNA badge from Hub protect |
| After sale | Rarely tracked | Continuous monitoring hooks |
| Private vault | Separate / none | Same identity as Hub |
| Multi-medium | Photo-heavy | Photo, video, design, audio, 3D, text, AI-declared |

### 3.2 Competitor snapshot (photographer cut examples, ~2026)

Use as **positioning research**, not PinIT payout commitments.

| Platform | Type | Creator cut (typical) | Best for |
|---|---|---|---|
| Adobe Stock | Stock | ~33% flat | Selling inside Adobe apps |
| Shutterstock | Stock | ~15–40% tiered | Highest volume |
| Alamy | Stock | ~40–50% | Editorial / news |
| iStock / Getty | Stock | ~15–45% | Big agency buyers |
| Dreamstime | Stock | ~25–60% | Beginners |
| 123RF | Stock | ~30–60% | Easier approvals |
| Bigstock | Stock | ~30% | Mixed subjects |
| Stocksy | Exclusive stock | ~50–75% | Premium curated |
| Picfair | Own store | You set price | Own pricing control |
| 500px | Stock + portfolio | ~30–60% | Audience building |
| Snapped4U | Event sales | ~85% | Event / portrait direct |
| Fine Art America | Print-on-demand | You set markup | Wall art |
| Etsy | Print / digital | You set price | Built-in shoppers |
| PhotoShelter | Portfolio + sales | You set price | Pro delivery |
| SmugMug | Portfolio + prints | You set markup | All-in-one store |

### 3.3 PinIT competitive thesis (2027)

1. **Not** cheapest thumbnail race.  
2. **Provenance marketplace**: biometric seller + DNA + sealed sale + tracking.  
3. **Creator-set pricing** (Picfair/Etsy-like) with optional curated “PinIT Verified” channel (Stocksy-like trust).  
4. **Multi-medium**, not photo-only.  
5. **Hub privacy** as a feature: sell what you choose; rest stays owner-only.

### 3.4 Risks if we ignore market lessons

| Risk | Mitigation |
|---|---|
| Creators expect stock-volume discovery | Invest in search, curated channels, agency buyer orgs — not only “trust story” |
| Buyers won’t pay premium without proof | DNA badge + certificate UX must be visible at listing and checkout |
| KYC friction kills funnel | Progressive KYC; clear time-to-first-listing SLA |
| Fee opacity kills trust | Transparent fee calculator on every listing publish |

---

## 4. Creator onboarding report (detailed)

### 4.1 Funnel (must complete before selling)

| Step | Screen (web) | Gate | Outcome |
|---|---|---|---|
| 0 | Intent: Sell on Exchange | Account exists | Enter seller path |
| 1 | Biometric enrollment | Liveness / match policy | Biometric binding |
| 2 | Billing card + seller plan | Payment method valid | Plan active |
| 3 | Identity proof pack | Doc / portfolio / tax as region requires | KYC status |
| 4 | Auto PinIT ID | Biometric verified | `PINIT-…` issued |
| 5 | Exchange ID | PinIT ID + plan + KYC pass | `PX-…` issued |
| 6 | Public profile | Profile completeness | Storefront live-ready |
| 7 | Adaptive desk unlock | Profile type chosen | Dashboard modules |

### 4.2 Why biometric + card before listing

- Blocks anonymous dumps of stolen assets  
- Ties listings and payouts to a living identity  
- Enables sealed sale disputes with real parties  
- Aligns with Hub “one face → one PinIT ID” direction  
- Card on file reduces fake seller spam and enables plan billing  

### 4.3 Seller plan (product note)

Exact SKUs TBD in pricing design; report requirements:

- Monthly / annual seller plan  
- Transparent platform fee % on sales (shown before publish)  
- Payout eligibility only after Exchange ID + tax profile  
- Plan pause freezes new listings; does not erase sealed history  

### 4.4 Identity proof pack (by region — policy skeleton)

| Region class | Typical asks |
|---|---|
| Individual creator | Gov ID + selfie/biometric match + portfolio URL |
| Sole prop / freelancer | ID + tax ID (optional early) + payout bank |
| Agency / studio | Business registration + authorized seller biometric + tax profile |
| Enterprise seller | Org verification + multi-user roles (P4+) |

---

## 5. Identity model (detailed)

```
Biometric templates (device / secure enclave policy)
        │
        ▼
   PinIT ID  (PINIT-XXXXXXXX)     ← platform citizen identity
        │
        ├── Hub workspace (private assets, monitoring)
        │
        └── Exchange ID (PX-XXXXXXXX)
                 ├── Public creator profile
                 ├── Listings
                 ├── Payouts
                 └── Sold / sealed ledger
```

### 5.1 Rules

| Rule | Rationale |
|---|---|
| One biometric cluster → one PinIT ID | Anti multi-account abuse |
| Exchange ID cannot exist without PinIT ID | Trust chain |
| Buyers may use lighter KYC | Reduce purchase friction |
| Enterprise buyers get org profiles | Agency / brand procurement |
| Listing DNA refs Hub IDs without vault keys | Privacy boundary |

### 5.2 ID formats (proposed)

| ID | Example | Scope |
|---|---|---|
| PinIT ID | `PINIT-324BMMSL` | Citizen / Hub + Exchange root |
| Exchange ID | `PX-9F2C-88AQ` | Seller commerce identity |
| Listing ID | `L-…` | Public listing |
| Order ID | `ORD-…` | Purchase |
| Seal ID | `SEAL-…` | Append-only sale event |

---

## 6. Core modules — detailed specification

### M1 — List from Hub → Exchange (Showcase)

**User goal:** Turn a protected Hub asset into a priced public listing without opening the vault.

**Inputs**

- Hub `assetId` (must be protect-complete / DNA-ready)  
- Title, description, category, tags, medium  
- License tiers + prices + territory + exclusivity  
- Preview policy (watermarked / low-res / scrubbed EXIF)  
- DNA badge on/off (default on if DNA exists)  
- AI training opt-out flag  

**Outputs**

- `listingId` public (or unlisted link)  
- Link record: `listingId ↔ assetId ↔ dnaRecordId`  
- Creator desk “Listings” row  

**Non-goals**

- Exposing original master bytes on the public CDN without purchase  
- Letting buyers browse Hub vault  

### M2 — Public showcase

**Surfaces:** Landing, browse/search, creator profile grid, collections.

**Filters (P1+):** medium, style, license type, price band, DNA verified, creator segment, territory.

**Discovery (P3+):** curated Verified channel, trending, agency collections.

### M3 — Buy flow + buyer details

**Checkout captures (minimum):**

| Field | Required | Why |
|---|---|---|
| Buyer name | Yes | Sealed ledger |
| Email | Yes | Delivery + receipts |
| Organization | Strongly recommended | B2B / disputes |
| Use case | Yes | License fit / audit |
| License acceptance | Yes | Legal |
| Billing identity | Yes | Payment + tax |

**Outcomes:** payment → escrow state → deliverable package → license certificate → sealed event → optional Hub tracking job.

### M4 — Continuous tracking (post-sale)

**Creator sees:** full monitoring desk (reuse Hub monitoring patterns).  
**Buyer sees:** license certificate + rights summary (not raw crawl ops).  
**Signals:** web copies, platform reuploads, training scrape heuristics, watermark hits where applicable.

### M5 — Sold / Sealed ledger

**“Sealed” means:** append-only commerce event store.

**Sealed record fields (logical):**

- Order ID, Seal ID, timestamps  
- Seller PinIT ID + Exchange ID  
- Buyer identity snapshot (as consented)  
- Listing + asset DNA hash  
- License terms version hash  
- Delivery receipt hash  
- Payout state transitions  
- Dispute / refund / chargeback events (append, never silent rewrite)

### M6 — Adaptive creator desk

Same shell; **module weights and templates** change by creator type.

| Profile type | Default showcase | Pricing presets | Analytics emphasis |
|---|---|---|---|
| Photographer | Galleries, EXIF, print + digital | Editorial / commercial / exclusive | Geo buyers, reuse alerts |
| Videographer | Reels, frame grabs, clearance flags | Web / broadcast / paid ads | View→license conversion |
| UI/UX / Graphic | Kits, components, product licenses | Personal / team / enterprise seat | Download vs seat usage |
| Musician / Podcaster | Tracks, stems, sync | Sync / podcast / ads | Play + license events |
| Agency | Client collections, white-label | Volume / retainer packs | Client workspaces |
| AI Artist | Prompt+model disclosure, originality DNA | Commercial / training-exclusion | Training-scrape alerts |

---

## 7. Payments, fees & economics

### 7.1 Money flows

| Flow | Who pays | Processor | Outcome |
|---|---|---|---|
| Creator onboarding | Creator | Stripe / Razorpay (or regional) | Seller plan + KYC gate |
| Buyer purchase | Buyer | Checkout | Funds → escrow → creator cut |
| Payout | Platform → Creator | Payout rail | Linked to Exchange ID + tax profile |
| Refund / chargeback | Buyer / bank | Dispute desk | Sealed ledger immutable event |

### 7.2 Transparency requirements (product)

Before **Publish listing**, show:

- Buyer price  
- Estimated platform fee  
- Estimated creator net  
- Payout schedule (e.g. T+N after delivery / dispute window)

### 7.3 Escrow states (logical)

`authorized → captured → deliverable_ready → dispute_window → released_to_creator | refunded | chargeback`

Every transition appends to sealed ledger.

---

## 8. UI / UX report (desktop web)

### 8.1 Surface priority

| Surface | Priority | Pattern |
|---|---|---|
| Creator desk, onboarding, sealed ledger | P0 desktop web | Sidebar app shell, forms, tables |
| Public marketplace & listing detail | P0 desktop web | Top nav, gallery grids, purchase panel |
| Hub vault / monitoring | Existing Hub web | Owner-only; deep-link “List on Exchange” |
| Mobile | Later | Responsive — **do not drive IA** |

### 8.2 Screen inventory (source of truth)

Open `mockups/pinit-exchange-web-ui.html`:

1. Public landing (brand-first full-bleed hero)  
2. Seller biometric onboarding (split layout)  
3. Billing card / seller plan  
4. Identity proof → PinIT ID + Exchange ID  
5. Creator dashboard (sidebar web app)  
6. List from Hub → showcase & price  
7. Buyer marketplace browse  
8. Listing detail + buyer details panel  
9. Sold / sealed ledger + tracking  

### 8.3 UX principles

- Brand-first public landing; one primary CTA group in first viewport  
- Creator desk = dense productivity UI (tables, filters, side nav)  
- Always label **Private Hub** vs **Public Exchange** on bridge screens  
- Desktop-first typography & palette (Fraunces + Outfit; moss/ink — avoid generic purple SaaS)  
- Trust signals (DNA, biometric verified, sealed) appear at decision moments (publish, buy)

### 8.4 Key UX journeys

**Creator → first listing**

Intent → biometric → card → KYC → IDs → profile → desk → list-from-Hub → price → publish → live listing.

**Buyer → licensed use**

Browse → listing → buyer details → pay → certificate + deliverable → (optional) later dispute / renewal.

**Creator → after sale**

Order appears → seal written → payout state → tracking alerts if misuse → dispute tools if needed.

### 8.5 Accessibility & quality bar (P1+)

- Keyboard paths for desk tables and checkout  
- Color contrast on moss/ink theme  
- Clear error states on biometric / payment failures (no silent fail)  
- Confirm before publishing (private → public is irreversible without unpublish)

---

## 9. Information architecture (web routes)

### Public

| Route | Purpose |
|---|---|
| `/exchange` | Landing |
| `/exchange/browse` | Search & filters |
| `/exchange/c/:exchangeId` | Creator profile |
| `/exchange/l/:listingId` | Listing detail |
| `/exchange/checkout/:listingId` | Buy + buyer details |

### Creator (auth + seller plan)

| Route | Purpose |
|---|---|
| `/exchange/onboarding/*` | Biometric → card → KYC → IDs |
| `/exchange/desk` | Adaptive dashboard |
| `/exchange/desk/list-from-hub` | Hub → Exchange |
| `/exchange/desk/listings` | Manage listings |
| `/exchange/desk/orders` | Orders |
| `/exchange/desk/sealed` | Sold / sealed ledger |
| `/exchange/desk/tracking` | Post-sale monitoring |
| `/exchange/desk/payouts` | Payouts & tax |

### Hub (unchanged privacy)

`/vault`, `/monitoring`, `/assets`, `/certificates` — owner only; CTA: **List on Exchange**.

---

## 10. System architecture (target)

```
[Web app] → API Gateway
               │
   ┌───────────┼───────────┐
   ▼           ▼           ▼
Identity &   Exchange     Hub Protect
Biometrics   Commerce     DNA / Vault / Monitor
PinIT ID     Listings     Asset DNA
Exchange ID  Checkout     Tracking jobs
KYC/Billing  Sealed ledger│
               │           │
               └─────► Shared Asset Graph
                       (assetId, dnaHash, ownerUserId)
```

### 10.1 Reuse from Hub / PinIT today

- Biometric auth & matching services  
- Assets / DNA / certificates / monitoring  
- Publish Guardian patterns for “protect before public”  
- Payment providers already considered for Hub subscriptions  
- Multi-tenant `ownerUserId` isolation patterns  

### 10.2 New Exchange services

| Service | Responsibility |
|---|---|
| Listing service | CRUD listings, previews, publish/unpublish |
| License engine | Tier definitions, acceptance, certificate generation |
| Checkout & escrow | Payments, state machine, refunds |
| Sealed ledger | Append-only sale events |
| Creator payout | Rails, tax exports, fee math |
| Buyer org profiles | Enterprise buyers (P4) |
| Marketplace search | Index, filters, ranking |

### 10.3 Logical data entities (report-level)

`User` · `BiometricBinding` · `PinItIdentity` · `ExchangeSeller` · `SellerPlan` · `KycCase` · `CreatorProfile` · `HubAsset` · `DnaRecord` · `Listing` · `LicenseOffer` · `Order` · `BuyerSnapshot` · `DeliveryPackage` · `SealEvent` · `Payout` · `TrackingJob` · `Dispute`

---

## 11. Trust, privacy & compliance

| Area | Requirement |
|---|---|
| Biometrics | Minimize retention; templates hashed / device-bound where possible |
| KYC | Regional residency; encrypted at rest; access-audited |
| Vault privacy | No public listing may expose vault keys or unrestricted masters |
| Licenses | Machine-readable + human PDF; versioned terms |
| AI | Training opt-out flag on listings; disclose AI-assisted works |
| Disputes | Takedown & dispute workflows tied to sealed records |
| Tax | Creator tax forms by country before payout release |
| GDPR / DPDP-style | Buyer/seller data subject rights; retention schedules |

---

## 12. Phased rollout (2026 → 2027)

| Phase | Goal | Exit criteria |
|---|---|---|
| **P0 Mockups** | Docs + desktop web screens | Stakeholders align on IA & journeys |
| **P1 Foundation** | Exchange ID, seller onboarding, list-from-Hub, basic checkout | First paid test sale end-to-end |
| **P2 Trust** | DNA badge, sealed ledger, post-sale tracking hooks | Sealed record on every sale; DNA visible on listing |
| **P3 Personalization** | Creator-type dashboards & templates | ≥3 profile templates live (photo, design, video) |
| **P4 Scale** | Enterprise buyer orgs, agencies, multi-currency payouts | Agency workspace + multi-currency payout pilot |
| **P5 Category leadership** | Verified channel, dispute SLA, creator fund, agency API | Verified channel GMV + published dispute SLA |

---

## 13. Success metrics

| Metric | Why it matters |
|---|---|
| Time-to-first-listing after biometric KYC | Onboarding friction |
| % listings with DNA badge | Trust product adoption |
| Creator take-home vs fee transparency score | Creator trust |
| Unauthorized-copy detections on sold assets | Differentiator vs stock |
| Repeat buyer rate | Marketplace health |
| NPS by creator segment | Template / desk quality |
| Checkout completion rate | Buyer UX |
| Dispute rate & time-to-resolution | Trust operations |

---

## 14. Requirements backlog (for engineering handoff)

### 14.1 Must-have (P1)

- [ ] Seller onboarding web flow (biometric, card, KYC, IDs)  
- [ ] Exchange ID mint linked to PinIT ID  
- [ ] List-from-Hub with price + license tiers  
- [ ] Public listing + browse  
- [ ] Checkout with buyer detail capture  
- [ ] Basic payout + fee display  
- [ ] Desktop web UI matching mockup IA  

### 14.2 Should-have (P2)

- [ ] DNA badge on listings  
- [ ] Sealed ledger UI + API  
- [ ] Post-sale tracking job creation on seal  
- [ ] License certificate PDF  

### 14.3 Later (P3–P5)

- [ ] Adaptive desk templates  
- [ ] Verified curated channel  
- [ ] Enterprise buyer orgs  
- [ ] Multi-currency payouts  
- [ ] Agency API  

---

## 15. Open decisions (explicit)

| Decision | Options | Owner |
|---|---|---|
| Seller plan price & fee % | Flat fee / tiered / category-based | Product + Finance |
| Escrow dispute window length | 3 / 7 / 14 days | Product + Legal |
| Buyer KYC depth by purchase size | Email-only vs ID at threshold | Compliance |
| Preview watermark policy | Always / optional / exclusive-only | Design + Product |
| Hosting domain | `exchange.pinithub.com` vs path `/exchange` | Eng + Brand |
| Mobile timeline | After P2 vs parallel | Product |

---

## 16. Recommended next steps

1. **Stakeholder review** of this report + `pinit-exchange-web-ui.html`.  
2. **Figma-level desktop layouts** from the HTML mockups (design polish).  
3. **React `/exchange` routes** scaffolding against the IA in §9.  
4. **API design** for Listing, Checkout, Seal, Exchange ID mint.  
5. Keep Hub Sprint work (Publish Guardian E2E) unblocked — Exchange depends on solid Hub DNA/protect.

---

## 17. Appendix A — Glossary

| Term | Meaning |
|---|---|
| Hub | Private PinIT product: protect, vault, track |
| Exchange | Public sell/buy marketplace |
| PinIT ID | Platform citizen identity from biometric binding |
| Exchange ID (`PX-…`) | Seller commerce identity |
| DNA | Asset fingerprint / forensic identity from protect |
| Listing | Public commerce object derived from a Hub asset |
| Sealed sale | Append-only immutable commerce event |
| Adaptive desk | Dashboard modules weighted by creator type |

## Appendix B — Related Hub capabilities (dependency)

Exchange listing quality depends on Hub:

- Protect / DNA pipeline complete for selected assets  
- Certificates & monitoring reusable for post-sale tracking  
- Auth + biometric stack reusable for seller onboarding  
- Multi-tenant isolation (`ownerUserId`) preserved across listing ownership  

## Appendix C — How to present this pack

1. Read executive summary (§1).  
2. Open desktop mockups in browser.  
3. Walk M1–M6 with a photographer persona.  
4. Close with competitor thesis (§3) and phase plan (§12).  
5. Capture open decisions (§15) in a product meeting notes doc.
