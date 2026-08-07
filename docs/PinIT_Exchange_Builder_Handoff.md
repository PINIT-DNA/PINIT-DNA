# PinIT Exchange — Builder Handoff Guide

**Audience:** Exchange UI/engineering teammate  
**From:** PinIT Hub / product direction  
**Purpose:** Explain what the current Exchange UI already has, what must be added, and how Exchange must connect to PinIT Hub  
**Live UI reference:** https://pint-i-ts.vercel.app/  
**Related Hub product:** PinIT Hub (protect, vault, DNA, share, monitor, investigate)  
**Date:** July 2026  

This document is written to be easy to follow. Please read top to bottom.

---

## 1. Big picture (read this first)

PinIT has **two products**:

| Product | Role | Public? |
|---------|------|---------|
| **PinIT Hub** | Private owner tools: protect files, DNA, vault, share tracking, monitoring, investigation, certificates | No — owner only |
| **PinIT Exchange** | Public marketplace: list, buy, sell licenses | Yes — buyers and creators |

### One-line rule

**Exchange is only for buying and selling.**  
All deep protection work (DNA, vault encryption, monitoring, investigation, leak tracking) happens **behind Exchange**, powered by **PinIT Hub**. Exchange shows trust signals and sale results; Hub does the heavy forensic/ops work.

```
Creator protects asset in Hub
        │
        │  "List on Exchange"
        ▼
Public listing on Exchange (preview + license + DNA badge)
        │
        │  Buyer pays
        ▼
Sale sealed + license delivered
        │
        ▼
Hub continues monitoring / investigation for that asset (behind the scenes)
```

---

## 2. What is already built in the Exchange UI

The site https://pint-i-ts.vercel.app/ is a **strong visual prototype**. It is useful. It is **not** the finished product.

### 2.1 UI that already exists (good work — keep and refine)

| Area | What the UI already shows |
|------|---------------------------|
| Landing / marketing | Origin Network story, buyer & creator journeys |
| Browse / marketplace | Filters by vertical (images, video, documents, audio, concepts) |
| Trending assets | Asset cards, trust-looking scores |
| Requirement Exchange | Buyer briefs / open requirements screens |
| Collections | Themed collection pages |
| Creator Passports | Creator profile / trust / portfolio style screens |
| Trust Center | DNA / verification explanation pages |
| Revenue opportunities | Creator demand / matching style screens |
| Enterprise bulk licensing | Seat / PO / institutional forms (UI) |
| Licensing comparison table | Personal / commercial / exclusive / enterprise tiers (UI) |
| Knowledge / help | Guide-style sections |
| My Licenses / cart | Buyer account style screens |
| Login / signup modal | Auth UI connected to a small backend |

### 2.2 What is real vs fake today

| Feature | Reality today |
|---------|----------------|
| Marketplace listings, creators, requirements, collections | **Demo / hardcoded data in the browser** |
| Wishlist / cart feel | Mostly **localStorage** |
| Signup / login / session | **Thin real backend** at `pintits-backend.onrender.com` (auth only) |
| Hub DNA / vault / monitor / investigate | **Not connected** |
| Real payments, escrow, payouts | **Not built** |
| Real “list from Hub” | **Not built** |

### 2.3 Honest summary for the builder

You built a **convincing Exchange front-end + basic login**.  
You did **not** yet build the full marketplace engine, Hub bridge, selling ledger, or trust pipeline.

That is OK — this doc tells you exactly what to add next.

---

## 3. Product goal (how PinIT Exchange should work)

Exchange should feel like a **provenance marketplace**, not a normal stock dump site.

### Creators can
1. Protect assets in Hub first  
2. List selected assets on Exchange  
3. Set license tiers and prices  
4. Sell to verified buyers  
5. See sales, earnings, and activity on a creator dashboard  
6. Rely on Hub (behind Exchange) for monitoring and investigation after sale  

### Buyers can
1. Browse / search / open requirements  
2. See trust badges (Gold / Silver / Bronze) and DNA signals  
3. Buy a **license** (not just a random file)  
4. Receive delivery + license proof  
5. Manage purchased licenses  

### What Exchange must NOT do
- Open the creator’s private Hub vault to the public  
- Allow publishing of assets with **too much AI content** (see Section 9)  
- Replace Hub for investigation / monitoring UI for owners (those stay Hub-powered behind the scenes)

---

## 4. How Exchange connects to PinIT Hub

This is the most important architecture rule.

### 4.1 Platform link model

```
┌────────────────────┐         list / unlink          ┌────────────────────┐
│     PinIT Hub      │ ─────────────────────────────► │  PinIT Exchange    │
│  Private owner app │                                 │  Public marketplace │
│                    │ ◄───────────────────────────── │                    │
│ DNA · Vault · Cert │     sale sealed / track jobs    │ List · Buy · Sell  │
│ Monitor · Investigate│                               │ Dashboard · Payout │
└────────────────────┘                                 └────────────────────┘
         ▲                                                       │
         │              Shared identity (PinIT ID)               │
         └───────────────────────┬───────────────────────────────┘
                                 │
                    Login / profile / billing identity
```

### 4.2 What “connect” means in practice

| Connection | How it should work |
|------------|--------------------|
| **Login** | Same PinIT identity. Prefer Hub SSO / shared JWT / “Continue with PinIT Hub”. Do not invent a forever-separate user system. |
| **Profile** | Base profile comes from PinIT ID. Exchange adds public storefront + seller settings. |
| **Billing** | Seller plan + buyer checkout. Can reuse payment providers already used by Hub (e.g. Razorpay patterns). |
| **Listing** | Creator picks Hub-protected asset → Exchange creates `listingId` linked to Hub `assetId` + `dnaRecordId`. Vault keys never leave Hub. |
| **Selling** | Payment happens on Exchange. Delivery package is generated. Sale is stored as sealed record. |
| **Tracking / monitoring / investigation** | Triggered from Exchange events, **executed by Hub services**. Creator sees summary on Exchange desk; deep tools stay Hub. |

### 4.3 IDs to use

| ID | Example | Meaning |
|----|---------|---------|
| PinIT ID | `PINIT-XXXXXXXX` | Main platform identity (Hub + Exchange) |
| Exchange ID | `PX-……` | Seller commerce identity (only after seller onboarding) |
| Listing ID | `L-……` | Public listing |
| Order / Seal ID | `ORD-…` / `SEAL-…` | Purchase + immutable sale event |

### 4.4 Privacy boundary (never break this)

1. Hub vault is never a public catalog.  
2. “List on Exchange” creates a **commerce listing + preview policy**, not a raw master dump.  
3. Buyers never get Hub owner privileges.  
4. DNA badge on Exchange is a **public-safe summary**, not full private forensic internals.

---

## 5. Login, profile, and billing

### 5.1 Login (required direction)

**Current UI:** email/password against a small separate backend.  

**Target direction:**
1. User already has / creates a **PinIT Hub** account (ShortId + biometric where Hub uses it).  
2. Exchange login: **Continue with PinIT** (shared session or token exchange).  
3. If user wants to **sell**, unlock seller path: biometric confirmation + seller plan + KYC → mint **Exchange ID**.  
4. Buyers can use lighter login for purchase friction, but still map to PinIT identity where possible.

**UI/UX focus:**
- One clear “Log in with PinIT Hub” primary button  
- Secondary email path only if needed during transition  
- No silent dual accounts that drift apart forever  

### 5.2 Profile settings

Split settings into clear tabs:

| Tab | Contents |
|-----|----------|
| Account | Name, email, PinIT ID, avatar |
| Public storefront | Display name, bio, vertical/segment, portfolio links |
| Seller verification | KYC status, biometric status, Exchange ID |
| Billing | Seller plan, cards, invoices, payout bank |
| Notifications | Sale alerts, requirement matches, dispute alerts |
| Security | Sessions, linked Hub account |
| Preferences | Default license presets by creator type |

### 5.3 Billing

Two money flows:

| Flow | Who pays | Purpose |
|------|----------|---------|
| Seller plan | Creator | Permission to sell on Exchange |
| Purchase checkout | Buyer | Pay for license |
| Payout | Platform → Creator | Creator earnings after sale / dispute window |
| Refunds / chargebacks | As needed | Must append to sealed sale history (never silent rewrite) |

**UI must show before publish:**
- Buyer price  
- Platform fee estimate  
- Creator net estimate  
- Payout timing  

---

## 6. Listing assets from Hub to Exchange

### 6.1 Happy path (must implement)

1. Creator is logged into Exchange with PinIT identity  
2. Clicks **List from Hub**  
3. Sees Hub-protected assets eligible to list (DNA/protect complete)  
4. Selects asset  
5. Sets:
   - Title, description, category/tags  
   - License tiers + prices  
   - Territory / exclusivity  
   - Preview style (watermark / low-res)  
   - AI training opt-out (if allowed to list)  
6. System checks **AI content policy** (Section 9)  
7. If allowed → publish listing with badge (Gold / Silver / Bronze)  
8. Public listing appears on Exchange  

### 6.2 UI screens needed

- List-from-Hub picker  
- Listing editor  
- Publish review (fees + badge + policy warnings)  
- My Listings (live / draft / paused / sold exclusive)  

### 6.3 What Hub sends / what Exchange stores

| From Hub | In Exchange listing |
|----------|---------------------|
| `assetId` | Linked reference |
| `dnaRecordId` / DNA summary | Badge + public trust summary |
| Preview-safe media | Public card / detail page |
| Owner PinIT ID | Seller identity |

Exchange does **not** store vault master encryption keys.

---

## 7. Selling, storing sales, and creator dashboard

### 7.1 Selling flow (buyer)

1. Open listing  
2. Compare license tiers  
3. See badge + DNA/trust summary  
4. Checkout: name, email, org, use case, license accept, pay  
5. Receive deliverable + license certificate  
6. Order appears in My Licenses  

### 7.2 Storing sales (sealed ledger)

Every sale must store an append-only record:

- Order ID / Seal ID / timestamps  
- Seller PinIT ID + Exchange ID  
- Buyer identity snapshot  
- Listing ID + DNA hash summary  
- License terms version  
- Payment / payout state  
- Dispute / refund events (added later, never deleted quietly)  

### 7.3 Creator dashboard (activities)

Dashboard should show **real activity**, not fake demo cards only:

| Module | Show |
|--------|------|
| Overview | Views, saves, orders, revenue |
| Listings | Status of each listed asset |
| Orders / sales | Recent purchases |
| Sealed ledger | Immutable sale history |
| Requirements | Matched buyer briefs + proposals |
| Earnings / payouts | Balance, schedule, fee transparency |
| Tracking summary | High-level post-sale alerts (deep investigate in Hub) |
| Activity feed | Listed, sold, paused, disputed, payout released |

**UI/UX focus:** clean desktop sidebar desk, tables, filters, empty states, clear CTAs (“List from Hub”, “Respond to requirement”).

---

## 8. Creator types the platform must support

Build Exchange so these creators can sell (adaptive desk later if needed):

1. Photographers  
2. Videographers  
3. Graphic Designers  
4. UI/UX Designers  
5. Motion Designers  
6. 3D Artists  
7. Architects  
8. Musicians  
9. Film Studios  
10. Podcasters  
11. Writers & Authors  
12. Journalists  
13. Educators  
14. AI Artists (only if they pass AI policy / disclosure rules)  
15. Fashion Designers  
16. Game Developers  
17. Influencers  
18. Advertising Agencies  
19. Creative Agencies  
20. Freelancers  

Buyers will include marketing teams, agencies, SMEs, enterprises, media, publishers, e-commerce, startups, education, government, production houses, events, HR/L&D, real estate, NGOs, legal, AI companies, design studios, recruiters, and individual consumers.

---

## 9. AI content policy and badges (mandatory)

Think like HackerRank / trust badges: clear levels buyers understand.

### 9.1 Publish / market rule

| AI content level in image or video | Allowed on Exchange? |
|------------------------------------|----------------------|
| **More than 80% AI-generated content** | **NO** — cannot publish or market |
| 80% AI or below | Allowed only if policy + disclosure rules pass |

If AI share **exceeds 80%**, block publish with a clear error:

> “This asset exceeds the 80% AI-content limit and cannot be listed on PinIT Exchange.”

### 9.2 Human / manual authenticity badges

For assets that **are allowed** to list, mark by manual / human authenticity quality:

| Badge | Manual / human authenticity | Meaning |
|-------|-----------------------------|---------|
| **Gold** | About **90–100%** manual / human-made | Highest originality trust |
| **Silver** | About **60–80%** | Mixed / assisted but acceptable |
| **Bronze** | Lower acceptable band (below silver, still under AI reject threshold) | Entry trust tier |

Notes for implementation:
- Badge must be visible on cards, listing detail, and checkout.  
- AI-assisted vs AI-generated disclosure should stay honest.  
- Video and image both use the same policy family.  
- Hub DNA / authenticity signals should feed this badge — do not let creators self-pick Gold freely.

---

## 10. What happens on Exchange vs what happens in Hub

| Capability | Where user mainly interacts | Where work runs |
|------------|-----------------------------|-----------------|
| Browse / buy / sell | Exchange | Exchange commerce services |
| List from Hub | Exchange desk | Hub asset read + Exchange listing write |
| Protect / DNA generate | Hub | Hub |
| Vault encryption | Hub | Hub |
| Share tracking (Smart Links) | Hub | Hub |
| Continuous monitoring of sold assets | Summary on Exchange; deep tools in Hub | Hub crawler / monitor |
| Investigation of leaks / tamper | Hub investigation | Hub forensics |
| Certificates | Shown on Exchange; issued/stored with Hub identity graph | Hub + Exchange seal |

**Remember:** Exchange = marketplace. Hub = protection engine behind it.

---

## 11. Reference: stock / selling platforms (for UX inspiration)

Use these as **UX/market references**, not copy-paste products.

| Platform | Learn from |
|----------|------------|
| Adobe Stock / Shutterstock / iStock | Browse, license tiers, buyer familiarity |
| Alamy / Stocksy | Editorial trust / curated quality feel |
| Picfair / Etsy / PhotoShelter / SmugMug | Creator-set pricing, storefront control |
| Snapped4U | High creator cut / direct sales feel |

**PinIT difference:** biometric/PinIT identity + Hub DNA + sealed sales + post-sale Hub tracking + AI badge policy + Hub privacy.

---

## 12. What you need to add next (priority checklist)

### Priority A — Make it real with Hub
1. Replace standalone forever-auth with **PinIT Hub linked login**  
2. Seller onboarding: biometric/KYC + seller plan + Exchange ID  
3. **List from Hub** picker + listing publish flow  
4. Real listing APIs (no hardcoded ASSETS for production path)  
5. Real checkout + payment + store sealed sale  
6. Creator dashboard with real activity/sales  

### Priority B — Trust and policy
7. AI >80% block on publish  
8. Gold / Silver / Bronze badge from authenticity signals  
9. DNA / certificate summary on listing + checkout  
10. License certificate after purchase  

### Priority C — After sale
11. On sale seal → create Hub monitoring/tracking job  
12. Show tracking summary on creator desk  
13. Deep investigate remains Hub link-out  

### Priority D — Polish UI/UX
14. Clean desktop IA: Public marketplace + Creator desk + Settings  
15. Empty states, loading, errors, success toasts  
16. Adaptive defaults by creator type (photo/video/design/etc.)  
17. Enterprise buyer flows only after A/B are solid  

---

## 13. Suggested screen map (clean IA)

### Public
- Home  
- Browse / Search  
- Listing detail  
- Creator passport  
- Collections  
- Requirement Exchange  
- Trust Center / Knowledge  
- Checkout  

### Creator (logged in)
- Desk overview  
- List from Hub  
- My listings  
- Orders / sealed sales  
- Earnings  
- Requirements inbox  
- Tracking summary  
- Profile / settings / billing  

### Hub (separate app, linked)
- Protect, Vault, Monitoring, Investigation, Certificates  

Use clear navigation labels and an app switcher: **Hub ↔ Exchange**.

---

## 14. Working agreement between Hub and Exchange builders

| Topic | Agreement |
|-------|-----------|
| Source of protected assets | Hub first |
| Marketplace UX ownership | Exchange builder |
| DNA / monitor / investigate ownership | Hub |
| Shared login | Must converge on PinIT identity |
| Demo data | OK for prototype; must be replaceable by APIs |
| Definition of done for a listing | Real Hub asset link + badge policy + publish + buyable |

---

## 15. Final message to the Exchange builder

Your current UI is a strong starting point for look-and-feel.

To match the PinIT Exchange vision, the next work is not more fake cards — it is:

1. **Connect login/profile/billing to PinIT Hub identity**  
2. **List real Hub assets**  
3. **Sell and store real sealed sales**  
4. **Show a real creator activity dashboard**  
5. **Enforce AI publish limits and Gold/Silver/Bronze badges**  
6. **Keep tracking / monitoring / investigation powered by Hub behind Exchange**  

If you follow this document, Exchange and Hub become one platform story:  
**Hub protects. Exchange sells. Trust stays continuous.**

---

## Document control

| Field | Value |
|-------|-------|
| Live UI reviewed | https://pint-i-ts.vercel.app/ |
| Plan sources | PinIT Exchange 2027 product docs + Hub current build |
| Output | Word handoff for Exchange teammate |
