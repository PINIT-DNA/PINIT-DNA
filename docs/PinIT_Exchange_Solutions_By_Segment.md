# PinIT Exchange — Solutions by Creator & Buyer Segment

**Product:** PinIT Exchange (planned public provenance marketplace)  
**Related product:** PinIT Hub (private protect · vault · track — already in build)  
**Status:** Planning / mockup phase — Exchange production APIs not shipped yet  
**Source:** Creator/Buyer segment table + `docs/PINIT_EXCHANGE_2027_DETAILED_REPORT.md` / Product Architecture  
**Date:** July 2026

---

## How to read this document

**Hub** = private owner tools (DNA, vault, certificates, monitoring).  
**Exchange** = public sell / buy marketplace with provenance.

PinIT Exchange does **not** sell anonymous file dumps. It sells:

- License grants (standard / extended / exclusive / sync / seat / territory)  
- Bound to **seller identity** (PinIT ID + Exchange ID)  
- Bound to **asset DNA** where available  
- With **buyer identity capture** and **sealed sale** ledger  
- With **post-sale tracking** hooks back into Hub monitoring  

Creators list from Hub (`Post to Exchange`) — vault encryption keys are never exposed publicly.

---

## Part A — Solutions for Creator Segments

### Shared creator solutions (all segments)

| Solution | What it means for creators |
|----------|----------------------------|
| Verified seller identity | Biometric → PinIT ID → Exchange ID (`PX-…`) so buyers trust the author |
| List from Hub without opening the vault | Commerce listing only; originals stay private until licensed delivery |
| DNA on listings | Proof of originality / ownership signal on the public page |
| Creator-controlled pricing & license tiers | Editorial, commercial, exclusive, sync, seat, territory options |
| Sealed sales ledger | Know who bought what, when, under which license |
| Post-sale tracking | Misuse / reuse / scrape awareness via Hub tracking hooks |
| Adaptive creator dashboard | Modules and presets change by profile type |
| Transparent economics | Creator sets terms instead of opaque stock royalty defaults |

---

### 1. Photographers

**Problems they face:** Stolen shoots, weak authorship proof, no visibility after a client download, stock royalties that feel unfair.

**Exchange solutions we provide:**
- Gallery / portfolio showcase with DNA-backed listings  
- Editorial / commercial / exclusive / print+digital license presets  
- Geographic buyer map and reuse alerts emphasis  
- Sell licensed stills while Hub keeps RAW/masters private  
- Certificate + listing linkage for client disputes  

### 2. Videographers

**Problems:** Frame grabs circulate without credit; music clearance and usage rights are messy; hard to sell clips with proper terms.

**Exchange solutions:**
- Reel / clip listings with frame-grab previews  
- Web / broadcast / paid-ads license presets  
- Music clearance flags on listings  
- View-to-license conversion analytics  
- Post-sale monitoring of sold video assets  

### 3. Graphic Designers

**Problems:** Designs get reused beyond the agreed brief; kit/asset packs are hard to license fairly.

**Exchange solutions:**
- Design pack / brand-asset listings  
- Personal / team / enterprise seat licensing  
- DNA identity on design files listed from Hub  
- Usage visibility after sale (seat vs download emphasis)  

### 4. UI/UX Designers

**Problems:** Component kits leak into other products without payment; seat licensing is manual.

**Exchange solutions:**
- UI kit / component library listings  
- Seat-based and product-license tiers  
- Team vs enterprise buyer packages  
- Provenance on design system assets  

### 5. Motion Designers

**Problems:** Motion packs and templates get redistributed; hard to prove original authorship.

**Exchange solutions:**
- Motion / template listings with DNA  
- Commercial vs broadcast license options  
- Tracking after license delivery  
- Showcase optimized for motion portfolios  

### 6. 3D Artists

**Problems:** Models and renders are scraped or resold; buyers want commercial rights clarity.

**Exchange solutions:**
- 3D asset / render listings from Hub-protected masters  
- Commercial / exclusive license tiers  
- DNA on 3D deliverables where supported  
- Sealed buyer ledger for high-value models  

### 7. Architects

**Problems:** Visualizations and plans circulate beyond project clients; IP disputes with contractors.

**Exchange solutions:**
- Controlled listing of viz / presentation assets (not full private project vault)  
- Project / client / commercial license options  
- Buyer identity capture for sealed sales  
- Link back to Hub certificates for authenticity  

### 8. Musicians

**Problems:** Tracks used in ads/podcasts without sync deals; stems leak; weak post-sale control.

**Exchange solutions:**
- Track / stem listings  
- Sync / podcast / ads license presets  
- Play + license event analytics emphasis  
- DNA/fingerprint linkage where available  
- Post-sale misuse monitoring hooks  

### 9. Film Studios

**Problems:** Still sets, trailers, and B-roll leak; need enterprise-grade buyer KYC and licensing.

**Exchange solutions:**
- Studio storefront / collection listings  
- Territory / exclusive / sync-style licenses  
- Sealed high-value sales with buyer identity  
- Continuous tracking of sold asset families  
- Agency-style client collection patterns  

### 10. Podcasters

**Problems:** Episode audio and artwork reused without credit; sponsorship clip misuse.

**Exchange solutions:**
- Episode / artwork / clip licensing  
- Podcast / ads sync presets  
- Verified creator profile for show brands  
- Tracking of licensed audio assets  

### 11. Writers & Authors

**Problems:** Text scraped or republished; hard to sell excerpt / full rights cleanly.

**Exchange solutions:**
- Document / manuscript excerpt listings (Hub-protected originals)  
- Personal / commercial / exclusive text licenses  
- DNA / content identity on listed docs where supported  
- Buyer ledger for rights purchases  

### 12. Journalists

**Problems:** Photos/copy republished without attribution; need fast proof of authorship.

**Exchange solutions:**
- Time-sensitive listing of protected reportage assets  
- Editorial license presets  
- Public DNA/certificate signal for authenticity disputes  
- Post-sale / misuse visibility via Hub  

### 13. Educators

**Problems:** Course slides and materials copied across institutions without license.

**Exchange solutions:**
- Course pack / teaching-material listings  
- Institution / seat / classroom license tiers  
- Buyer identity for schools/teams  
- Controlled delivery without opening private Hub vault  

### 14. AI Artists

**Problems:** Training scrapes, originality doubts, disclosure of prompt/model lineage.

**Exchange solutions:**
- Prompt + model disclosure fields on listings  
- Originality DNA on listed assets  
- Commercial / training-exclusion license options  
- Training-scrape / misuse alert emphasis in analytics  
- Verified seller identity for trust  

### 15. Fashion Designers

**Problems:** Lookbooks and campaign assets reused by retailers without terms.

**Exchange solutions:**
- Lookbook / campaign asset marketplace listings  
- Commercial / retail / exclusive licenses  
- Brand storefront profile on Exchange  
- Tracking of sold campaign media  

### 16. Game Developers

**Problems:** Art, audio, and trailers leak; asset-store style sales need clearer provenance.

**Exchange solutions:**
- Game art / audio / trailer listings from Hub  
- Studio / commercial / exclusive tiers  
- DNA-backed originality signal  
- Sealed B2B sales for studios and publishers  

### 17. Influencers

**Problems:** Brand content and UGC reused beyond campaign; hard to monetize archives.

**Exchange solutions:**
- Monetize protected content libraries via listings  
- Campaign / commercial reuse licenses  
- Verified influencer Exchange profile  
- Post-sale tracking of licensed posts/media  

### 18. Advertising Agencies

**Problems:** Client assets need white-label sales desks; volume packs and retainers are manual.

**Exchange solutions:**
- Client collections and white-label storefront patterns  
- Volume / retainer pack pricing  
- Client workspace–oriented analytics  
- List Hub-protected client work without exposing vault  

### 19. Creative Agencies

**Problems:** Same as ad agencies — portfolio commerce + client IP control.

**Exchange solutions:**
- Agency storefront with collection licensing  
- Multi-license packs for retainers  
- Team seller identity + org-ready Hub bridge  
- Sealed ledger per client campaign  

### 20. Freelancers

**Problems:** One-off clients reuse work forever; portfolio sites do not sell licenses with tracking.

**Exchange solutions:**
- Simple onboarding to Exchange ID + listing from Hub  
- Clear personal / commercial license presets  
- Proof of authorship for disputes  
- Paid licenses instead of “send ZIP on WhatsApp”  

---

## Part B — Solutions for Buyer Segments

### Shared buyer solutions (all segments)

| Solution | What it means for buyers |
|----------|--------------------------|
| Buy from verified creators | Biometric-backed PinIT / Exchange seller IDs |
| Provenance on the listing | DNA / authenticity signal before purchase |
| Clear license at checkout | Know rights (standard / extended / exclusive / sync / seats / territory) |
| Identity-bound delivery | Sealed purchase — not anonymous download chaos |
| Trust over volume dumps | Marketplace optimized for rights + accountability, not only cheap stock volume |
| Unlisted / private listing links | When creators share selectively |

---

### 1. Marketing Teams

**Needs:** On-brand assets with commercial rights and auditability.

**Exchange solutions:**
- Commercial license checkout  
- Verified creator storefronts  
- Seat/team usage options for design kits  
- Proof of rights for brand legal reviews  

### 2. Advertising Agencies

**Needs:** Campaign-ready assets with clear usage and territory.

**Exchange solutions:**
- Extended / exclusive / territory licenses  
- High-trust creator identity  
- Sealed purchase records for client billing  
- Packs and volume options from agency sellers  

### 3. SMEs

**Needs:** Affordable licensed creatives without legal grey zones.

**Exchange solutions:**
- Standard commercial licenses at creator-set prices  
- Trust signals (DNA + verified seller) without enterprise complexity  
- Simple buy → licensed deliverable flow  

### 4. Large Enterprises

**Needs:** Procurement-grade rights, seats, exclusivity, audit trail.

**Exchange solutions:**
- Enterprise seat / exclusive license tiers  
- Sealed buyer KYC-style identity capture  
- Audit-friendly purchase ledger  
- Bridge to ongoing misuse monitoring (creator-side Hub tracking)  

### 5. Media Houses

**Needs:** Editorial assets with authenticity and republishing clarity.

**Exchange solutions:**
- Editorial license presets  
- Authenticity / DNA signals for disputed images  
- Verified journalist/photographer sellers  
- Clear reuse boundaries in license terms  

### 6. Publishers

**Needs:** Cover art, illustrations, and text excerpts with rights certainty.

**Exchange solutions:**
- Rights-bound listings for print/digital use  
- Exclusive options for covers  
- Sealed purchase proof for contracts  
- Creator-verified identity  

### 7. E-commerce Brands

**Needs:** Product photos and lifestyle media with commercial reuse rights.

**Exchange solutions:**
- Commercial product-media licenses  
- Creator galleries tailored to commerce shoots  
- Fast license clarity for catalog use  
- Reduced risk of “stolen stock” claims  

### 8. Startups

**Needs:** Quality creatives quickly with clean IP for fundraising/brand.

**Exchange solutions:**
- Startup-friendly commercial licenses  
- Verified independent creators and freelancers  
- Transparent pricing vs opaque stock cuts  
- Provenance for investor/legal diligence  

### 9. Educational Institutions

**Needs:** Teaching materials and media with classroom/institution licenses.

**Exchange solutions:**
- Institution / seat / classroom license tiers  
- Educator and media seller storefronts  
- Controlled delivery of course packs  
- Clear non-commercial vs commercial boundaries  

### 10. Government Departments

**Needs:** Trusted procurement of media with accountability.

**Exchange solutions:**
- Verified seller identity  
- Sealed purchase records  
- License terms suitable for public communication use  
- Authenticity signals on critical imagery  

### 11. Production Houses

**Needs:** Stock-adjacent footage, stills, music with production licenses.

**Exchange solutions:**
- Broadcast / web / ads license options  
- Sync-capable music/video listings  
- Studio and freelancer seller network  
- Tracking-aware sold asset families  

### 12. Event Companies

**Needs:** Event photography/video rights for promo reuse.

**Exchange solutions:**
- Event media commercial licenses  
- Photographer/videographer verified profiles  
- Clear post-event reuse terms  
- Purchase ledger for client delivery  

### 13. HR & L&D Teams

**Needs:** Training media and visuals with seat licenses.

**Exchange solutions:**
- Seat / team licenses for L&D packs  
- Educator and designer seller inventory  
- Controlled internal redistribution terms  
- Audit trail of licensed training assets  

### 14. Architects & Real Estate Firms

**Needs:** Visualizations and property media with commercial marketing rights.

**Exchange solutions:**
- Commercial listing licenses for viz / property media  
- Verified architect/photographer sellers  
- Rights clarity for listings and brochures  
- Authenticity for premium property marketing  

### 15. NGOs

**Needs:** Ethical, licensed storytelling media with attribution.

**Exchange solutions:**
- Fair creator-priced licenses  
- Editorial/commercial clarity  
- Verified creator identity for sensitive imagery  
- Proof of rights for donor/compliance reports  

### 16. Legal Firms

**Needs:** Authenticity and chain-of-rights for exhibits and publications.

**Exchange solutions:**
- DNA / certificate–linked listings  
- Sealed purchase + seller identity evidence  
- Clear license scope for publication use  
- Bridge to Hub investigation mindset for disputes (Hub side)  

### 17. AI Companies

**Needs:** Training-exclusion options and disclosed AI/authentic media.

**Exchange solutions:**
- Training-exclusion license flags  
- AI-artist disclosure fields (prompt/model)  
- Originality DNA for authentic assets  
- Clear commercial vs training use boundaries  

### 18. Design Studios

**Needs:** Kits, fonts-adjacent packs, and stock creatives with seat licenses.

**Exchange solutions:**
- Team/enterprise seat licenses  
- UI/graphic/motion seller inventory  
- Provenance before incorporating into client work  
- Sealed rights for studio libraries  

### 19. Recruiters

**Needs:** Brand imagery and employer-brand media with clean rights.

**Exchange solutions:**
- Commercial licenses for careers/brand media  
- Verified creative sellers  
- Simple checkout for talent-brand campaigns  
- Reduced IP risk in employer branding  

### 20. Individual Consumers

**Needs:** Personal-use licenses with trust that the seller is real.

**Exchange solutions:**
- Personal-use license tier  
- Verified creator profiles  
- DNA/authenticity confidence before buying  
- Fair direct-to-creator purchases (not only mega-stock)  

---

## Part C — One matrix view (quick)

| If you are… | Exchange primarily helps you… |
|-------------|-------------------------------|
| **Creator** | Sell licenses with identity + DNA + post-sale tracking, without opening your Hub vault |
| **Buyer** | Purchase rights from verified creators with clear licenses and sealed proof |
| **Both (e.g. agencies)** | Run a storefront for clients and buy third-party rights into campaigns |

---

## Part D — Delivery note (honest)

| Layer | Current state |
|-------|----------------|
| PinIT Hub (protect/vault/track) | In progress / production path exists |
| Exchange web mockups | Delivered (`mockups/pinit-exchange-*.html`) |
| Exchange React routes / APIs / payments | **Not built yet** — next engineering phase |

This document describes **solutions PinIT Exchange is designed to provide** for each segment in the 2027 product plan.

---

## References

- `docs/PINIT_EXCHANGE_2027_DETAILED_REPORT.md`  
- `docs/PINIT_EXCHANGE_2027_PRODUCT_ARCHITECTURE.md`  
- Creator/Buyer segment table (product planning input)  
