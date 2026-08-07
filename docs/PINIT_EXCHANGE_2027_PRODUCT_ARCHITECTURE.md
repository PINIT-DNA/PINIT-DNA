# PinIT Exchange — 2027 Product & Design Architecture

**Status:** Planning / mockup phase (not production code)  
**Primary surface:** **Desktop web application** (UI/UX-first). Mobile is secondary/responsive later.  
**Detailed report (full narrative):** [`PINIT_EXCHANGE_2027_DETAILED_REPORT.md`](./PINIT_EXCHANGE_2027_DETAILED_REPORT.md)  
**Companion UI (extraordinary web):** [`mockups/pinit-exchange-extraordinary.html`](../mockups/pinit-exchange-extraordinary.html)  
**Earlier web screens:** [`mockups/pinit-exchange-web-ui.html`](../mockups/pinit-exchange-web-ui.html)  
**Related:** PinIT Hub (private protect · store · track) remains owner-only.

---

## 0. Product surface (corrected)

PinIT Exchange is designed as a **browser web app**, not a mobile-tab prototype.

| Surface | Priority | UX pattern |
|---|---|---|
| Creator desk, onboarding, sealed ledger | P0 Web desktop | Sidebar app shell, forms, tables |
| Public marketplace & listing detail | P0 Web desktop | Top nav, gallery grids, purchase panel |
| Hub vault / monitoring | Existing Hub web | Owner-only; deep-link “List on Exchange” |
| Mobile | Later | Responsive/adapt — do not drive IA |

Mockups must show **full browser frames** (URL + desktop layouts). Phone shells are not the design source of truth.

## 1. Vision (why PinIT Exchange wins by 2027)

Most stock platforms sell **files**. PinIT Exchange sells **provenance-backed creative rights**.

| Today (stock & print markets) | PinIT Exchange 2027 |
|---|---|
| Upload → approve → hope for volume | Protect in Hub → list with DNA → sell with continuous tracking |
| Photographer’s cut often 15–40% | Transparent creator economics + license tiers creator controls |
| Buyer gets a download | Buyer gets license + identity-bound delivery + misuse monitoring |
| Portfolio and vault are separate apps | One identity: Hub (private) + Exchange (public commerce) |
| Weak proof of originality | Biometric-bound PinIT ID + asset DNA on every listing |

**North-star promise**

> Creators of any medium (image, video, design, audio, 3D, text) protect originals privately in PinIT Hub, then optionally publish to PinIT Exchange. Buyers purchase licenses from verified creators. Sold assets stay trackable. Private vault contents never become public unless the owner lists them.

---

## 2. Dual-product boundary (non-negotiable)

```
┌─────────────────────────────────────────────────────────────┐
│                     PinIT Identity Layer                     │
│   Biometric enrollment → PinIT ID → optional Exchange ID     │
└───────────────────────────┬─────────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
┌──────────────────────┐            ┌──────────────────────┐
│     PinIT Hub        │            │   PinIT Exchange     │
│  PRIVATE · owner only│            │  PUBLIC marketplace  │
│                      │  list()    │                      │
│  Protect / Vault /   │ ─────────► │  Showcase · Price ·  │
│  Track / Certificate │            │  Buy · License ·     │
│                      │ ◄───────── │  Sold / Sealed data  │
│  Never browsable     │  track()   │  Buyer profiles      │
└──────────────────────┘            └──────────────────────┘
```

- **Hub:** business users and creators protect files; only the owner sees vault & monitoring.
- **Exchange:** creators sell; buyers buy; listings are public (or unlisted share links).
- **Bridge:** “Post to Exchange” copies a **commerce listing** from a Hub asset — it does **not** open the encrypted vault to the internet.

---

## 3. Creator segments & buyer segments

### Creators (sell)

Photographers, Videographers, Graphic / UI-UX / Motion / 3D designers, Architects, Musicians, Film studios, Podcasters, Writers & authors, Journalists, Educators, AI artists, Fashion designers, Game developers, Influencers, Ad & creative agencies, Freelancers.

### Buyers (purchase)

Marketing teams, Ad agencies, SMEs, Large enterprises, Media houses, Publishers, E-commerce brands, Startups, Educational institutions, Government departments, Production houses, Event companies, HR & L&D, Architects & real estate, NGOs, Legal firms, AI companies, Design studios, Recruiters, Individual consumers.

### Dashboard personalization (innovation)

After onboarding, Exchange dashboard **modules and defaults adapt by creator profile**:

| Profile type | Default showcase | Pricing presets | Analytics emphasis |
|---|---|---|---|
| Photographer | Galleries, EXIF, print + digital licenses | Editorial / commercial / exclusive | Geographic buyer map, reuse alerts |
| Videographer | Reels, frame grabs, music clearance flags | Web / broadcast / paid ads | View-to-license conversion |
| UI/UX / Graphic | Kits, components, license for products | Personal / team / enterprise seat | Download vs seat usage |
| Musician / Podcaster | Tracks, stems, sync licenses | Sync / podcast / ads | Play + license events |
| Agency | Client collections, white-label storefront | Volume / retainer packs | Client workspaces |
| AI Artist | Prompt+model disclosure, originality DNA | Commercial / training-exclusion | Training-scrape alerts |

Same platform shell; **different module weights and templates**.

---

## 4. Creator onboarding (must-pay biometric + billing)

### 4.1 Funnel

1. **Create PinIT account** (intent: Sell on Exchange).  
2. **Biometric enrollment** (face / fingerprint / voice — reuse Hub biometric stack).  
3. **Billing card capture** (Stripe/Razorpay) — creator seller plan activated.  
4. **Identity proof pack** (government ID / business registration / portfolio URL / tax ID as required by region).  
5. **Automatic PinIT ID** minted from verified biometric binding.  
6. **PinIT Exchange ID** minted (`PX-……`) linked 1:1 to PinIT ID.  
7. **Creator profile** (public storefront + private seller desk).  
8. **Dashboard** unlocked with profile-specific modules.

### 4.2 Why biometric + card before selling

- Stops anonymous dump of stolen assets.  
- Ties every listing and payout to a living identity.  
- Enables sealed sale records and dispute resolution.  
- Aligns with Hub’s existing “one face → one PinIT ID” direction.

### 4.3 Payments

| Flow | Who pays | Processor | Outcome |
|---|---|---|---|
| Creator onboarding | Creator | Card on file | Seller plan + KYC gate |
| Buyer purchase | Buyer | Checkout | Funds → escrow → creator cut |
| Payout | Platform → Creator | Payout rail | Linked to Exchange ID + tax profile |
| Refund / chargeback | Buyer / bank | Dispute desk | Sealed ledger immutable event |

---

## 5. Identity model

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

**Rules**

- One biometric cluster → one PinIT ID (anti multi-account abuse).  
- Exchange ID cannot exist without PinIT ID.  
- Buyers may purchase with lighter KYC; enterprise buyers get org profiles.  
- Listing DNA references Hub `assetId` / `dnaRecordId` without exposing vault keys.

---

## 6. Core Exchange modules

### M1 — Post from Hub → Exchange (Showcase)

Creator selects protected Hub asset(s) → sets title, category, license tiers, price, territory, exclusivity → optional DNA badge → publish.

### M2 — Public showcase

Profile grid / collections / search by medium, style, license, price, “DNA verified”.

### M3 — Buy flow

Buyer clicks Buy → account / guest checkout → **buyer details captured** (name, org, use case, license acceptance) → pay → delivery package.

### M4 — Continuous tracking (post-sale)

Sold asset remains monitored for unauthorized copies / training scrape / leaked masters (reuses Hub monitoring). Buyer-visible: license certificate. Creator-visible: full tracking desk.

### M5 — Sold / Sealed data

Immutable sale record: buyer, license terms, timestamps, DNA hash, delivery receipt, payout state. “Sealed” = append-only ledger for audits and legal holds.

### M6 — Creator desk (adaptive)

Earnings, orders, listings, disputes, tax exports, audience — layout varies by creator segment.

---

## 7. Competitive landscape (photographer cut examples, 2026)

Use as **positioning research**, not as PinIT payout commitments.  
**Extraordinary UI mockups (with this table live):** [`mockups/pinit-exchange-extraordinary.html`](../mockups/pinit-exchange-extraordinary.html)

| Platform | Type | Creator cut (typical) | Best for | Link |
|---|---|---|---|---|
| Adobe Stock | Stock | ~33% flat | Selling inside Photoshop / Lightroom | [stock.adobe.com](https://stock.adobe.com) |
| Shutterstock | Stock | ~15–40% tiered | Highest volume | [shutterstock.com](https://www.shutterstock.com) |
| Alamy | Stock | ~40–50% | Editorial / news; less exclusivity pressure | [alamy.com](https://www.alamy.com) |
| iStock / Getty | Stock | ~15–45% | Big agency buyers | [istockphoto.com](https://www.istockphoto.com) · [gettyimages.com](https://www.gettyimages.com) |
| Dreamstime | Stock | ~25–60% | Beginners | [dreamstime.com](https://www.dreamstime.com) |
| 123RF | Stock | ~30–60% | Easier approvals | [123rf.com](https://www.123rf.com) |
| Bigstock | Stock | ~30% | Mixed subjects | [bigstockphoto.com](https://www.bigstockphoto.com) |
| Stocksy | Exclusive stock | ~50–75% | Premium curated | [stocksy.com](https://www.stocksy.com) |
| Picfair | Own store | You set price | Own pricing control | [picfair.com](https://www.picfair.com) |
| 500px | Stock + portfolio | ~30–60% | Audience building | [500px.com](https://500px.com) |
| Snapped4U | Event sales | ~85% | Event / portrait direct | [snapped4u.com](https://snapped4u.com) |
| Fine Art America | Print-on-demand | You set markup | Wall art | [fineartamerica.com](https://fineartamerica.com) |
| Etsy | Print / digital | You set price | Built-in shoppers | [etsy.com](https://www.etsy.com) |
| PhotoShelter | Portfolio + sales | You set price | Pro delivery | [photoshelter.com](https://www.photoshelter.com) |
| SmugMug | Portfolio + prints | You set markup | All-in-one store | [smugmug.com](https://www.smugmug.com) |
| **PinIT Exchange (target)** | Provenance marketplace | You set price · transparent fee | Biometric + DNA + sealed + track · Hub private | exchange.pinithub.com (planned) |

**PinIT Exchange positioning**

- Not “race to cheapest stock thumbnail.”  
- **Provenance marketplace**: biometric seller identity + DNA + post-sale tracking + Hub privacy.  
- Creator sets prices (Picfair/Etsy-like) with optional curated “PinIT Verified” channel (Stocksy-like trust).  
- Multi-medium (not photo-only): video, design kits, audio, 3D, AI-declared works.  
- Account UX bar: Adobe-grade (overview, security/passkeys, plans, privacy, app switcher Hub↔Exchange).

---

## 8. Information architecture (web)

### Public

- `/exchange` — landing  
- `/exchange/browse` — search & filters  
- `/exchange/c/:exchangeId` — creator profile  
- `/exchange/l/:listingId` — listing detail  
- `/exchange/checkout/:listingId` — buy + buyer details  

### Creator (auth + seller plan)

- `/exchange/onboarding/*` — biometric → card → KYC → IDs  
- `/exchange/desk` — adaptive dashboard  
- `/exchange/desk/list-from-hub` — Hub → Exchange  
- `/exchange/desk/listings`  
- `/exchange/desk/orders`  
- `/exchange/desk/sealed` — sold/sealed ledger  
- `/exchange/desk/tracking` — post-sale monitoring  

### Hub (unchanged privacy)

- `/vault`, `/monitoring`, `/assets`, `/certificates` — owner only  

---

## 9. Suggested system architecture (target)

```
[Web / Mobile] → API Gateway
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   Identity &     Exchange     Hub Protect
   Biometrics     Commerce     DNA/Vault/Monitor
   PinIT ID       Listings     Asset DNA
   Exchange ID    Checkout     Tracking jobs
   KYC/Billing    Sealed ledger│
                    │           │
                    └─────► Shared Asset Graph
                            (assetId, dnaHash, ownerUserId)
```

**Reuse existing PinIT capabilities**

- Biometric auth services & matching  
- Publish Guardian / Assets / DNA / Certificates / Monitoring  
- Payments providers already considered for Hub subscriptions  

**New Exchange-specific services**

- Listing service, License engine, Checkout & escrow, Sealed ledger, Creator payout, Buyer org profiles, Search/index for marketplace.

---

## 10. Trust & compliance

- Biometric data: minimize retention; templates hashed / device-bound where possible.  
- KYC storage: regional residency, encrypted at rest.  
- License clarity: machine-readable + human PDF.  
- AI training opt-out flag on listings.  
- Takedown & dispute workflows tied to sealed records.  
- Creator tax forms by country.

---

## 11. 2027 rollout phases

| Phase | Goal |
|---|---|
| P0 Mockups | This document + HTML journey screens |
| P1 Foundation | Exchange ID, seller onboarding, list-from-Hub, basic checkout |
| P2 Trust | DNA badge, sealed ledger, post-sale tracking hooks |
| P3 Personalization | Creator-type dashboards & templates |
| P4 Scale | Enterprise buyer orgs, agencies, multi-currency payouts |
| P5 Category leadership | Verified channel, dispute SLA, creator fund, API for agencies |

---

## 12. Success metrics (Exchange)

- Time-to-first-listing after biometric KYC  
- % listings with DNA badge  
- Creator take-home vs platform fee transparency score  
- Unauthorized-copy detections on sold assets  
- Repeat buyer rate  
- NPS by creator segment (photo vs design vs video)

---

## 13. Screen inventory (desktop web UI)

Open [`mockups/pinit-exchange-web-ui.html`](../mockups/pinit-exchange-web-ui.html) in a browser.

1. Public landing (full-bleed hero, web top nav)  
2. Seller biometric onboarding (split web layout)  
3. Billing card / seller plan  
4. Identity proof → PinIT ID + Exchange ID  
5. Creator dashboard (sidebar web app)  
6. List from Hub → showcase & price  
7. Buyer marketplace browse  
8. Listing detail + buyer details panel  
9. Sold / sealed ledger + tracking  

**UI/UX principles for Exchange web**

- Brand-first public landing; one primary CTA group.  
- Creator desk = dense productivity UI (tables, filters, side nav).  
- Clear private vs public labeling when bridging Hub → Exchange.  
- Desktop-first spacing, typography (Fraunces + Outfit), moss/ink palette — avoid generic purple SaaS look.
