# PinitHub

# Product–Vision Alignment & Gap Analysis

**2026**

**Subtitle:** Current Product vs Strategic Vision  
Based on the 5-Part Product & Company Direction

**Document type:** Internal strategic / product analysis  
**Audience:** Leadership review  
**Constraint:** Documentation only. No code, schema, API, or UI changes.  
**Not this document:** Final Company & Product Profile (deferred until this review).

**Evidence standard:** Claims about the current product cite routes, APIs, Prisma models, services, or apps. If not proven in production, status is **Needs verification**. Future vision is never described as live capability.

**Inference rule:** Concepts not in the five parts are marked **[inference]** or **[audit brief]** and are not treated as source wording.

---

## 1. Executive Summary

### CURRENT PRODUCT

PinitHub today is a **Hub-first Digital Asset Intelligence & Protection stack**, with a separate **Exchange** commerce app and a **Business** agency workspace.

- **One Pinit identity:** JWT user (`User` + `shortId`), Hub auth (`/login`, `/register`, `/face-auth`), Exchange SSO via `POST /api/v1/exchange/sso`.
- **Pinit HUB:** Protect (upload → DNA → encrypted vault), prove (certificates, verify), share (controlled links), detect (enrolled monitoring), investigate (unified forensic pipeline + reports).
- **Pinit Exchange:** Marketplace listings, cart, sealed orders/licenses, buyer/seller desks, opportunities, creator passports / public portfolio pages — **implemented in `exchange/`**; Hub landing still labels License/Monetize as **Coming soon**.
- **Business:** Organization → Client → Campaign → assets/versions/approvals/messages/handover/findings/investigations.
- **Portfolio:** Hub Prisma `Portfolio*` is the intended source of truth; Exchange historically stored `portfolio_profiles` (overlap in transition).
- **Canonical asset identifier (engineering):** `Asset.id` is documented as the identifier that crosses Hub ↔ Exchange. Users still primarily see **My Assets (Vault)**, DNA IDs, vault IDs, and certificates.

### ALREADY ALIGNED

Strongest matches to the intended vision:

- Asset-centric category (not “another drive”) — Hub + landing copy.
- Identity via **Asset DNA** (multi-layer fingerprints, not filename).
- Protection (vault encryption, permissions, share controls, TEP/watermark).
- Controlled **share as a relationship**, with activity logs and revoke.
- **Memory** as events: `ForensicProvenanceEvent`, `AssetTimelineEvent`, share access logs, campaign activity.
- **Discover ≠ proof:** monitoring alerts + compare/investigate + campaign findings (potential → decide).
- **Business relationships:** org, client, campaign, versions, people, handover.
- **Evidence packages:** investigation reports, `EvidenceRecord`, certificates, DNA compare.
- **Exchange as economic layer** (license/sale), not as Hub storage — in architecture comments and schema split.

### PARTIALLY ALIGNED

Exists, but is not yet one coherent “Pinithub asset” the way the vision describes:

- Persistent identity is **split** across `Asset.id`, `VaultRecord.id`, `DnaRecord.id`, `Certificate.certificateId`, `User.shortId`.
- Lifecycle is **several enums** (`AssetStatus`, `ReviewStatus`, `DnaStatus`, `ShareLink`, campaign status) — not the intended single operational status model.
- Lineage/versions: campaign `AssetVersion` is real; DNA `DocumentLineage` / Layer 8 “relationship” is **hash-family / duplicate IDs**, not an Asset Relationship Graph.
- Rights: Exchange licenses are SoT; Hub `RightsPanel` is a **read projection**.
- Monitoring: enrolled DNA + watch URLs / crawler — **not** platform-wide network intelligence.
- Intelligence: search, OCR, forensic pipeline, access intelligence — **not** a unified “understand the asset” product surface.
- Capture: extension Publish Guardian + upload; not a full capture product.
- “System remembers, not the user”: backend remembers a lot; **UI still asks the user to stitch Vault / DNA / Certificates / Monitoring / Investigate**.

### MISSING (as a product model, not always as raw tables)

- Single **Pinithub Asset** object (PIN-XXXX style) presented as identity + origin + ownership + rights + memory + graph.
- **Asset Relationship Graph** (people, orgs, campaigns, platforms, licences, evidence as one graph UX).
- **Network Intelligence** (entity graph). Master Admin “Network Intelligence” is org reach counts only; code comments call a full graph a separate engineering effort.
- Continuous **internet** intelligence (DAIP / IICLME HLD) beyond Phase-1 monitoring.
- Native **takedown workflow** (DMCA draft download exists; not a case/action system).
- Post-download tracking of raw copies (explicitly out of current claims).
- **PINIT Career** as a product.
- Contracts as first-class rights documents bound to the asset (licences exist on Exchange; contracts do not).

### OVERRIDDEN / NEEDS REPOSITIONING

- **PINIT-DNA / 6-layer / 15-layer** as the public product name vs **Pinit HUB / PINITHUB**.
- **Vault** as the user’s “asset” vs the intended **Asset**.
- **Protect New / Generate** vs lifecycle **Capture → Identify → DNA → Protect**.
- Landing **Coming soon** for Exchange vs Exchange **code + live URL**.
- Duplicate surfaces: `ProtectedPost` vs `Asset`; DNA Records vs My Assets; Exchange `portfolio_profiles` vs Hub `Portfolio`.
- Technical IDs and forensic internals exposed as primary navigation.
- Marketplace (buyer/collector) should not be **core company positioning**; it is a layer.

### FUTURE

The intended longer loop: CONNECT → DISCOVER across ecosystems → UNDERSTAND → LEARN → PROTECT AGAIN; Network Intelligence; AI original vs derived vs synthetic at scale; Asset DNA as lifecycle identity across every copy.

### FINAL DIRECTION

The Company & Product Profile should say:

**PINITHUB is a Digital Asset Intelligence & Protection platform.**  
**PinIT Hub is the live control layer** (protect, prove, share, detect, investigate) around enrolled assets.  
**Business** is how agencies connect clients, campaigns, versions, and handover.  
**Exchange** is optional economic utility (license/sale) on Hub-protected identity — **positioned honestly as early/in-market or still under-claimed, after a positioning decision**.  
**The category difference is “what is happening to the asset?” not “where is the file?”**  
Do not claim a complete relationship graph, whole-web monitoring, or that every copy on the internet retains Pinithub memory.

---

## 2. Intended Strategic Vision

Source of truth: five parts shared in this conversation. Terminology preserved.

### Philosophy (Part 1)

- Important digital assets should have **identity, memory, relationships, evidence, protection, control**.
- Treat the asset as an **evolving digital object**, not a static file.
- **“A digital asset should have a memory.”**
- **“The asset should carry its context with it”** — via a persistent intelligence layer, not by embedding a full dossier in every copy.
- Category: **Digital Asset Intelligence & Protection**.
- Motto already in Hub: **Secure · Connect · Control**. Promise: **Never lose what matters.**

**[inference from Part 1, also in audit brief]:** “The system should remember, not the user.” The five parts did not use this sentence verbatim. Closest: memory on the asset + context carried by the platform.

**[audit brief only — not in the five parts]:** Eliminate / Reduce / Raise / Create. Not used below as a vision framework.

### The digital asset journey (Part 2)

CREATE → STORE → SHARE → PUBLISH → COPY → MODIFY → RE-UPLOAD → REDISTRIBUTE  

**Control gap:** owner understanding often stops after SHARE.

Ten problem clusters: Fragmentation, Ownership uncertainty, Version confusion, Unauthorised usage, Asset leakage, Platform fragmentation, Missing provenance, Missing evidence, Manual investigation, AI-generated content.

**Core problem:** infrastructure for lifecycle understanding is fragmented (storage / security / monitoring / provenance / DAM / copyright tools).

Investigation intent: **Discover → Compare → Verify → Document → Act**.

### Category (Part 3)

Not another cloud drive, DAM, copyright monitor, or provenance-only system.

Shifts: File→Asset, Storage→Memory, Link→Relationship, Monitoring→Intelligence, Copyright→Control.

**Pinithub model:** Identity → Memory → Relationships → Intelligence → Protection → Evidence → Control.

Ambition: **intelligence and control layer around important digital assets.**

### Pinithub Asset Model (Part 4)

Not `Filename + Size + Location`.

Instead: Identity + Origin + Ownership + Content + Relationships + Activity + Rights + Evidence + History + Status.

Twelve elements: Identity, Creator, Ownership, Metadata, Versions, Relationships (foundation for **Asset Relationship Graph**), Activity, Permissions, Provenance, Evidence, History (**Asset Memory**), Status (Draft / Active / Shared / Protected / Published / Under Investigation / Revoked / Archived / Inactive).

Conceptual public ID: **PIN-XXXX**.

### Lifecycle / Intelligence Loop (Part 5)

CAPTURE → UPLOAD → IDENTIFY → ANALYSE → GENERATE ASSET DNA → VERIFY → PROTECT → SHARE → TRACK → MONITOR → DISCOVER → VERIFY RELATIONSHIP → GENERATE EVIDENCE → CONTROL → ARCHIVE / CONTINUE.

Complete loop adds CONNECT, UNDERSTAND, LEARN, PROTECT AGAIN.

Critical: **Discovery is not proof.** Potential Match → Likely → Verified.

Control includes: continue monitoring, permissions, revoke, preserve evidence, contact, **takedown workflow**, update rights, archive, escalate.

Lifecycle is **continuous, not linear**.

---

## 3. Current PinitHub Product — 2026

Inspected: `client/src/router.tsx`, `client/src/components/nav/Sidebar.tsx`, `src/app.ts`, `prisma/schema.prisma`, Hub route modules under `src/api/routes/`, `exchange/` (SPA routes + `exchange.postgres.sql`), `pinithub-landing/lib/defaults.ts`, `python-ai/`, `extension/`, `master-admin/`, selected services (`vault.service.ts`, `asset.service.ts`, `forensic-provenance.service.ts`, `campaign` / business routes).

Runtime of every screen against production was **not** re-executed for this document. Status **A** = wired in code with real models/APIs; production crawler coverage and Exchange “live commerce” vs landing “coming soon” are **Needs verification** as *go-to-market facts*.

### 3.1 Surfaces

| Surface | Role | Evidence | Audit class |
|---------|------|----------|-------------|
| PinIT Hub (`client/`) | Primary product | Routes in `router.tsx`; brand `client/src/config/brand.config.ts` | **A** |
| Hub API (`src/`) | `/api/v1` DNA, vault, share, monitor, forensics, business, exchange bridge, portfolio, certificates, AI | `src/app.ts` | **A** |
| Business workspace | Org / clients / campaigns | `/business/*`, `business.routes.ts` | **A** |
| Exchange (`exchange/`) | Marketplace | `exchange/src/lib/exchange-routes.js`, schema `exchange.*` | **A** in code; **C** vs landing “Coming soon” |
| Landing (`pinithub-landing/`) | Marketing | `defaults.ts` Hub live; Exchange/Career coming soon | **A** (site); **D** for Career |
| Chrome extension | Publish Guardian | `extension/`, `publish-guardian.routes.ts` | **A** (loadable); production host comments may be stale (**C**) |
| Master Admin | Ops | `master-admin/`, `super-admin.routes.ts` | **A** (internal) |
| python-ai | Embed/search/OCR/optional CV | `python-ai/`, `ai.routes.ts` | **A** core; optional deps **B/C** |
| PINIT Career | Verified careers product | Landing FAQ only | **E** as product |
| `PinitHub LandingPage/` | Old Next landing | Effectively unused | **E** / orphan |

### 3.2 Identity, protection, vault, DNA

| Capability | Implementation | Class |
|------------|----------------|-------|
| Account identity | `User`, `shortId` (PINIT-…), JWT `pinit_access_token`, face/WebAuthn models | **A** |
| Protect new | `/generate` → DNA generate + vault (`POST /dna/generate`, vault store) | **A** |
| Universal Asset protect | `POST /assets/protect` → `AssetService` → Publish Guardian DNA/vault/cert | **A** |
| Canonical Asset on vault | `vault.service.ts` `ensureAssetFromProtect`; tests `tests/vault/asset-identity-chain.test.ts` | **A** (code/tests) |
| Vault | `VaultRecord`, AES-256-GCM, Supabase `vault-files`, `/vault` “My Assets” | **A** |
| DNA | `DnaRecord` + L1–L15 layer tables, `POST /dna/generate`, `/dna-records` | **A** |
| Certificates | `Certificate`, `/certificates`, public verify `/verify-certificate`, `GET /certificates/verify/:id` | **A** |
| TEP / watermarked export | `TrackedExportPackage`, `tep.routes.ts` | **A** |
| Spatial auth | DNA spatial-auth routes; `SpatialAuthPackage` noted **0 production rows** in schema comment | **C** |

### 3.3 Share, track, monitor, investigate

| Capability | Implementation | Class |
|------------|----------------|-------|
| Smart share | `ShareLink`, `/s/:token`, vault share pages, OTP/geo/mask/revoke | **A** |
| Access intelligence | `/access-intelligence`, `ShareAccessLog`, link tree, forward chain | **A** |
| Monitoring | `MonitorRecord`, `watchUrls`, `/monitoring`, `GET/POST /monitor/*` | **A** for enroll/alerts; **B** vs the vision’s “supported digital surfaces” at internet scale |
| Discoveries | `AssetDiscovery`, crawl results, campaign findings | **A** |
| Investigate | `/pinit-hub/investigation`, `POST /forensics/unified-investigate` | **A** |
| Forensic diff | `/forensic-diff`, `/forensic/*` | **A** |
| Reports | `/reports`, client-side PDF (`report-generator.ts`), campaign client reports | **A** |
| Evidence | `EvidenceRecord`, `evidence.routes.ts`, investigation collect | **A** |
| Takedown | `client/src/lib/dmca-draft.ts` download draft — not a workflow engine | **B** (draft) / **E** (platform takedown) |
| Search / AI | `/search`, `POST /ai/search`, python-ai FAISS | **A** |

### 3.4 Business / agency

Wired in `business.routes.ts` and Prisma: `Organization`, `Client`, `Campaign`, `CampaignMember`, `AssetVersion`, `VersionApproval`, `ReviewComment`, `CampaignMessage`, `CampaignHandover`, `Incident` (campaign investigations), client report tokens `/handover/:token`, `/client-report/:token`.

**A** as implemented APIs/UI. Completeness of every panel in production: **Needs verification**.

Rights: `GET .../campaigns/:campaignId/rights` + `RightsPanel.tsx` — **read-only Exchange projection**. **B** vs intended ownership+rights on the asset itself.

Integrations: `OrganizationIntegration` model exists; treat as **B/C** (not demo-default; not verified here as live Slack/Drive).

### 3.5 Exchange / licensing / opportunities

Schema: `exchange.hub_assets`, `listings`, `orders_sealed` (license_status), cart, wishlist, requirements, earnings, reviews, coupons, disputes, payouts.

Hub bridge: `src/api/routes/exchange.routes.ts` (list, protect-upload, seal sale, licensed share, delivery, activity).

Creator 360: `GET /api/v1/creator/assets/:assetId/activity` (`asset-360.service.ts`).

Landing: License/Monetize **Coming soon** (`pinithub-landing/lib/defaults.ts`).

**Conflict:** architecture **A**; GTM story **Needs decision** (see §15).

### 3.6 Portfolio

- Hub: `Portfolio` … “Exchange may read the published snapshot but never writes these rows” (`schema.prisma`).
- Hub APIs: `/api/v1/portfolio/*`, editor `PortfolioEditor.tsx`.
- Exchange: `exchange.portfolio_profiles` still present; `portfolio-bridge.service.ts` marked **@deprecated — do not PUT Exchange profiles**.

**B** — Hub-owned direction in code; leftover Exchange table/routes **Needs verification** of dual-write.

### 3.7 Relationships in data (not a graph product)

| Relation | Model | Graph UX? |
|----------|--------|-----------|
| Owner | `Asset.ownerUserId`, `DnaRecord.ownerUserId` | No |
| Org / workspace / dept | on `DnaRecord` | No |
| Campaign / client | `Asset.campaignId`, `Campaign.clientId` | Campaign UI, not graph |
| Platforms | `AssetPlatformLink` | Partial (Publish Guardian) |
| Versions | `AssetVersion` | Campaign versions |
| Share recipients | `ShareRecipient`, link hierarchy | Link tree |
| DNA Layer 8 | `RelationshipLayer.relatedIds` (duplicate SHA-256) | **Not** the intended graph |
| Licences | Exchange orders keyed by `asset_id` | Seller activity / Rights panel |
| Evidence / incidents | `Incident.assetId`, `EvidenceRecord` | Investigation UI |

Master Admin `/network`: org **networkSize** = members + clients + campaigns. Comment: full entity relationship graph is a **separate engineering effort**.

### 3.8 What is not present

Native mobile apps; SCIM/IdP suite as shipping product; Career; unrestricted internet surveillance; PIN-XXXX public asset ID; takedown case system; contract objects; unified Asset Relationship Graph UI; DAIP continuous leak engine as implemented module (`docs/DAIP-IICLME-HLD-v2.0.md` = **D**).

---

## 4. Current Digital Asset Journey

### 4.1 What the product actually supports

```
CREATE / CAPTURE (upload | extension Publish Guardian)
    → IDENTIFY (user, org, time, source — at protect)
    → ANALYSE (metadata, optional OCR/content analysis)
    → GENERATE DNA (DnaRecord + layers)
    → STORE / PROTECT (VaultRecord AES)
    → PROVE (Certificate, optional)
    → SHARE (ShareLink) | COLLABORATE (campaign versions/approvals)
    → TRACK (access logs, TEP, asset timeline)
    → LICENSE (Exchange order/seal — if listed)
    → HANDOVER / DELIVER (campaign handover, Exchange delivery token)
    → MONITOR (enroll + watch URLs)
    → DISCOVER (alerts / AssetDiscovery)
    → COMPARE / VERIFY RELATIONSHIP (forensic / unified investigate)
    → EVIDENCE / REPORT
    → CONTROL (revoke share, pause monitor, cert revoke, block viewer, finding decide)
```

Hub **primary nav** compresses this to: **Protect New → My Assets → Monitoring → Investigate → Certificates**.

Landing loop: **Protect → Prove → Share → Detect → Investigate**.

### 4.2 Vs the intended journey

| Intended | Current | Status |
|----------|---------|--------|
| CREATE | Upload + extension capture | ◐ (not all capture types) |
| identity | DNA + Asset.id + vault id + cert — not one PIN-XXXX | ◐ |
| context | Metadata, campaign attach, platform links | ◐ |
| ownership | Owner user + certificate; commissioned/transferred rights thin | ◐ |
| protection | Vault, share rules, TEP | ✓ |
| lifecycle | Multiple status systems | ◐ |
| relationships | Relational tables, no graph product | ◐ / ○ graph |
| evidence | Reports, EvidenceRecord, certs — often on-demand investigate | ◐ vs “continuous” |
| usage | Share + campaign + Exchange activity | ◐ |
| licensing | Exchange | ◐ (and GTM mismatch) |
| monitoring | Enrolled + watch list | ◐ |
| intelligence | Search + forensic + access intel | ◐ |
| network intelligence | Admin org counts only | ○ / □ |

---

## 5. Alignment Matrix

Status key: **✓ ALIGNED** · **◐ PARTIALLY ALIGNED** · **△ REPRESENTED DIFFERENTLY** · **○ MISSING** · **□ FUTURE / CONCEPTUAL** · **? NEEDS VERIFICATION**

| Intended Vision / Requirement | Current implementation | Status | Evidence | Gap / difference | Recommendation |
|---|---|---|---|---|---|
| Digital Asset Intelligence & Protection (category) | Landing + Hub positioning | ✓ | `pinithub-landing/lib/defaults.ts`; `BRAND` | Hub UI still feels like forensic/vault tools | Keep category; simplify Hub IA later |
| Asset as centre (not folder/drive/link) | `Asset` aggregate + vault files | ◐ | `model Asset`; `/vault` labelled My Assets | Users still think in files/vault rows | Profile: asset-centric; product: converge UI on Asset |
| Persistent identity | `Asset.id` canonical for Hub↔Exchange; DNA immutable identity in comments | ◐ | `schema.prisma` Certificate/ShareLink `assetId`; `asset-identity-chain.test.ts` | Many IDs; no PIN-XXXX | Do not claim one human ID until productized |
| Asset DNA | 15-layer `DnaRecord` | ✓ technical / △ naming | `dna.routes.ts`, layer services | Vision: lifecycle identity. Product: fingerprint engine | Profile: “Asset DNA”; avoid layer-count as headline |
| Creator connected | `ownerUserId`, campaign members, Exchange seller | ◐ | User, CampaignMember, exchange.users | Creator ≠ always legal owner | Say creator/owner/org as distinct |
| Ownership | Certificate + owner user | ◐ | `Certificate`, recover-ownership | Commission/transfer/licence split incomplete in Hub | Hub prove ownership; Exchange for commercial rights |
| Rights | Exchange licence; Hub read | ◐ | `orders_sealed`, `RightsPanel`, `campaign-rights.service.ts` | Hub cannot mint full rights | Profile: Hub evidence + Exchange licences |
| Context / metadata | DNA metadata layer, vault contentAnalysis, Asset.metadata | ◐ | Prisma fields | Not a first-class “context” object | Enough for profile as “recorded at protect” |
| Asset Memory | Provenance events + asset timeline + share logs | ◐ | `ForensicProvenanceEvent`, `AssetTimelineEvent` | Split stores; `/timeline` not in primary nav | Memory exists; unify in profile language, not as one screen today |
| Lineage / versions | `AssetVersion`; `DocumentLineage`; EvolutionLayer | ◐ | business version APIs; lineage table | Personal Hub protect has weak version UX | Campaign versions = best example |
| Evidence (continuous) | Certs + logs always; investigation packs on demand | ◐ | certificates, access logs, unified investigate, EvidenceRecord | The vision requires evidence throughout, not emergency-only | Honest: some continuous, packs when investigating |
| Intelligence | AI search, OCR, intelligence report, access intel, campaign intel panel | ◐ | `ai.routes.ts`, `intelligence.routes.ts`, `IntelligencePanel` | Not one “Intelligence” product | Don’t claim autonomous understanding |
| Relationships / Asset Relationship Graph | FKs + Layer 8 duplicate IDs | ○ as graph / ◐ as data | `RelationshipLayer`; campaign FKs; Admin network page | No graph UX | Call related records; graph = future |
| Network Intelligence | Admin org reach | ○ / □ | `NetworkIntelligencePage.tsx` | Explicitly not entity graph | Future only in profile |
| Permissions | ShareLink + org RBAC + campaign member access | ✓ for share/org | ShareLink fields; MemberAccessStatus | Not a single asset ACL UX | Describe as controlled sharing + org roles |
| Provenance | OriginLayer + events + certificates | ◐ | OriginLayer, forensic-provenance.service.ts | Origin bundle technical | “Recorded origin + history” |
| Status model (Draft…Archived) | `AssetStatus` ≠ the intended list; plus ReviewStatus | △ | enums in schema | Two lifecycles by design (protect vs review) | Don’t force one enum in profile; describe states operationally |
| Capture | Extension + upload | ◐ | `capturedVia` default `extension_publish_guardian`; `/generate` | Device/screen capture not full product | Supported capture/upload |
| Analyse | File analysis, OCR, python-ai | ◐ | vault contentAnalysis, OcrRecord | Type-dependent; optional AI deps | “Depending on type” — matches the source |
| Verify (lifecycle states) | DnaStatus, cert, investigation confidence | △ | DnaStatus, CertStatus | Not Captured→…→Protected wizard | Don’t invent a verify stepper in profile |
| Share as relationship | Share + campaign + handover | ✓ | ShareLink, Campaign, Handover | — | Lead with this |
| Track | Access logs, TEP, creator 360 | ◐ | ShareAccessLog, asset-360 | After raw download: limited | Scope: supported channels |
| Monitor | Enroll monitors, watchUrls | ◐ | monitoring.routes.ts; DAIP HLD | Not all platforms | Authorized/configured surfaces |
| Discover | Alerts, discoveries | ◐ | CrawlResult, AssetDiscovery | Watch-list scoped | Matches the source hedge if we keep it |
| Verify relationship | Compare / unified investigate; finding decide | ✓ principle / ◐ UX | forensic-diff; campaign findings | Confidence scores ≠ named Potential/Likely/Verified everywhere | Keep Discover ≠ proof |
| Control / action | Revoke, block, pause, cert revoke, finding decide, DMCA draft | ◐ | share, cert, monitoring pages | Takedown not a product | “Act” = Hub controls + draft, not auto-DMCA |
| Archive / continue | AssetStatus ARCHIVED; campaign ARCHIVED | ◐ | enums | Weak “reactivate / licensed / published” Hub UX | Continuous loop = vision |
| Not another DAM/drive/copyright tool | Explicit landing | ✓ | defaults.ts | Exchange can look like marketplace-first | Profile: Hub first |
| Marketplace / Exchange | Full app | △ GTM | exchange/; landing Coming soon | Under/over claim risk | Needs a decision on the status sentence |
| AI original vs derived vs synthetic | contentLabel ORIGINAL / AI_GENERATED / …; deepfake layer optional | ◐ / □ ML | VaultRecord.contentLabel; DeepfakeLayer | Heuristic/optional | Future-facing problem: yes; solved: no |
| PIN-XXXX asset | User shortId PINIT-… only | ○ | User.shortId | Asset = UUID | Don’t print PIN-XXXX as live |
| System remembers (not user) | Data yes; IA no | ◐ | Many modules in sidebar | User still navigates tools | Positioning now; IA later |
| Career | — | ○ | Landing roadmap | — | Out of Hub profile body |
| SSO / SCIM | Not Hub product | ○ / □ | — | — | Not current |

---

## 6. Partially Aligned Areas

1. **Identity stack** — Canonical `Asset.id` is the right engineering direction; product still teaches vault/DNA/cert IDs. The vision’s “persistent identity” is only partly the user experience.
2. **Memory** — Events exist in several tables; there is no single Asset Memory view in primary nav (`/timeline` exists, not Core nav).
3. **Versions** — Excellent in campaigns; ordinary protect flow still “new file = new DNA” unless attached as version.
4. **Rights** — Commercial rights live on Exchange; Hub proves custody/ownership certificate.
5. **Monitoring vs Intelligence** — Signals exist; the vision’s “intelligence connects signals into meaning” is only partly true (investigation pipeline + some panels).
6. **Evidence** — Continuous *ingredients* (logs, certs, DNA); *packages* are mostly investigation/report time.
7. **Portfolio** — Hub SoT in Prisma; Exchange table leftover.
8. **Capture** — Extension is real; “supported device/screen capture” is broader than shipped.
9. **Control** — Strong on share/vault; weak on legal takedown and rights updates inside Hub.
10. **Landing vs Exchange** — Same company, two truths about whether commerce is live.

---

## 7. Overridden / Repositioned Concepts

“Overwrite” = how the **new vision describes the product**, not a request to delete code.

| Current concept | New vision concept | Problem | Keep / Rename / Merge / Remove / Reposition |
|---|---|---|---|
| PINIT-DNA / Universal File DNA Engine | PINITHUB / Asset DNA | Old category = fingerprint lab | **Reposition:** DNA is a mechanism under identity |
| 6-layer / 15-layer as product | Asset identity | Technical depth as positioning | **Keep** internally; **do not** lead company profile with layer counts |
| Vault as the asset | Pinithub Asset | Custody ≠ identity | **Keep** Vault as storage; **rename in copy** to protected original / custody |
| My Assets = `/vault` | Asset inventory | Correct label, wrong object (vault rows) | **Merge** toward `Asset` over time |
| Protect New / Generate | Capture → DNA → Protect | Generator metaphor | **Rename** in profile to Protect / enroll |
| DNA Records page | Asset identity/history | Duplicate of vault for many users | **Reposition** as advanced/forensic |
| ProtectedPost + Asset | One asset | Two protection aggregates | **Merge** conceptually; code stays until engineered |
| Layer 8 Relationship | Asset Relationship Graph | Name collision | **Rename** internally in docs: content-family hash, not graph |
| Network Intelligence (admin counts) | Network Intelligence (intended) | Overclaims | **Reposition** as org reach; graph = future |
| Exchange as landing “coming soon” | Economic utility | Confuses buyers | **Decision** then one story |
| Buyer / Collector as brand | Optional commerce | Marketplace-first risk | **Reposition** off company-core |
| Forensic report visual language | Company profile design system | Different document type | **Reuse palette only** (already instructed) |
| Root README 6-layer API | Hub SaaS | Stale public description | **Reposition** docs (later) |
| Investigate a File | Asset intelligence loop | File-in, not asset-lifecycle | **Keep** capability; **copy** as investigate relationship |
| Certificate vs portfolio credentials | Ownership proof vs professional docs | Two “certificate” words | **Keep both**; disambiguate in profile |
| Smart Share | Share as relationship | Feature name vs philosophy | **Keep** product name; profile speaks relationships |
| Tracking feature flag | Asset activity | Plan gating vs vision | **Keep** entitlements; don’t say all users get all memory |
| DAIP / IICLME | Monitor + future intel | HLD vs Hub Phase 1 | **Future** only |
| PIN-XXXX | Asset.id / shortId | Unshipped public ID | **Conceptual** in vision appendix only |

---

## 8. Missing Capabilities

Verified against repo first. “Missing” = not a user-facing Pinithub capability matching the intended concept.

### P0 — Fundamental to PinitHub identity

| Item | Verdict |
|------|---------|
| Persistent **product** identity (one asset the user lives in) | **Partial** — `Asset.id` exists; UX still multi-ID. Gap: presentation + lifecycle, not absence of rows. |
| Asset Memory as one story | **Partial** — events exist; unified memory UX missing. |
| Discover ≠ proof | **Present** in investigation/findings. Gap: not named consistently in UI. |

### P1 — Important product capability

| Item | Verdict |
|------|---------|
| Complete lineage (original → derived → published) | Campaign versions **yes**; global derivative graph **no**. |
| Ownership + rights on the asset | Ownership cert **yes**; full rights object **no** (Exchange licences). |
| Org / agency / client / campaign relationships | **Present** (Business). |
| Creator relationships | **Partial** (members, Exchange creator). |
| License relationships | **Present** on Exchange; Hub display **partial**. |
| Investigation relationships | **Present** (`Incident.assetId`). |
| Evidence relationships | **Present** as records, not graph. |
| Website/platform relationships | **Partial** (`AssetPlatformLink`, monitors). |
| Takedown workflow | **Missing** as workflow (**P1** if Control chapter promises it). |
| Capture beyond upload/extension | **Missing** / limited. |

### P2 — Future intelligence / scale

| Item | Verdict |
|------|---------|
| Asset Relationship Graph UX | **Missing** |
| Cross-entity graph (brand, publisher, contract) | **Missing** (no Brand/Publisher/Contract models as graph nodes) |
| Continuous internet intelligence (DAIP) | **Docs only** |
| AI original/derived/synthetic at quality bar | **Partial labels**; ML **future** |
| LEARN → PROTECT AGAIN closed loop | **Conceptual** |

### P3 — Long-term strategic vision

| Item | Verdict |
|------|---------|
| Network Intelligence (true) | **Missing** (admin counts ≠ this) |
| Career | **Missing** |
| Post-download memory of every copy | **Missing** (correctly not claimed in TEAM/DAIP hedges) |
| PIN-XXXX public identity | **Missing** |

---

## 9. Product Architecture vs Vision

### A. What PinitHub actually is today

A **multi-app system**:

1. **Hub** — enroll/protect files, encrypted custody, DNA fingerprints, certificates, controlled sharing with telemetry, optional monitoring of enrolled assets, forensic investigation when a probe file or finding exists, org campaign collaboration.
2. **Exchange** — list Hub-protected assets, sell/license, briefs/opportunities, public creator pages.
3. **Identity** — one user account intended to span Hub and Exchange (SSO bridge).
4. **Portfolio** — Hub-owned professional profile, picked from vault (direction in code).

It is **not** yet a single graph of all asset relationships, and **not** a global leak surveillance network.

### B. What it is intended to become

The **intelligence and control layer** around important digital assets: identity, memory, relationships, evidence, protection, control — across as much of CREATE…REDISTRIBUTE as is technically and legitimately possible — with Exchange as economic utility.

### C. Where they already align

Category, DNA identity, vault protection, share+track, investigate+evidence, business context (client/campaign/version), Exchange linked by `asset_id`, Discover≠proof in forensics.

### D. Where they differ

| Vision | Today |
|--------|--------|
| One asset object with full context | Several records the user must combine |
| Relationship graph | Relational + forensic tools |
| Memory the system shows you | Memory stored; tools to query it |
| Monitor ecosystems | Monitor enrollments / watch URLs |
| Intelligence layer | Search + investigation + panels |
| Continuous evidence | Logs + on-demand packages |
| Control including takedown | Revoke/share/monitor + DMCA text draft |
| PIN-XXXX | UUIDs + user shortId |

### E. What should change in **positioning** (not code)

- Lead with **asset control / intelligence**, not Exchange, not DNA layer counts.
- Hub loop **Protect → Prove → Share → Detect → Investigate** as *today*.
- The intended long lifecycle as *architecture / destination*.
- Exchange: one agreed status line.
- Explicit hedges already written in the five parts: enrolled assets, legitimate surfaces, discovery ≠ proof.
- Vault/DNA as **how**, Asset as **what**.

---

## 10. Terminology Review

Documentation only. No application renames.

| Current term | Intended concept | Recommendation | Reason |
|---|---|---|---|
| Asset | Pinithub Asset | Keep; make it the hero noun | Matches vision |
| Vault | Custody / protected original | Keep product name; profile: “secure custody” | Avoid “we are storage” |
| DNA / Asset DNA | Identity technical layer | Keep “Asset DNA”; drop “PINIT-DNA product” in company profile | Mechanism under identity |
| Protection | Protect | Keep | Aligned |
| Evidence | Evidence | Keep | Aligned |
| Identity | Account vs asset identity | Always specify which | Collision |
| Ownership | Owner + certificate | Keep; don’t equate to licence | Rights ≠ custody |
| Monitoring | Monitor / Detect | Keep; don’t say Network Intelligence | Scope |
| Tracking | Activity on supported shares/TEP | Prefer “activity” in profile | Tracking sounds spyware |
| Investigation | Verify relationship + evidence | Keep | Aligned |
| Intelligence | Search/forensics/campaign intel | Capital-I Intelligence = partial/future | Avoid overclaim |
| Portfolio | Public creative profile | Hub-owned; not Career | Align with architecture |
| Exchange | Marketplace / licensing | Layer, not category | Part 3 |
| Creator / Buyer / Collector | Roles on Exchange | Exchange only | Not company core |
| Business | Agency/org workspace | Keep | Maps to campaigns |
| Campaign | Campaign relationship | Keep | Strong alignment |
| License | Usage rights (Exchange) | Keep on Exchange | SoT |
| Certificate | Ownership certificate | Disambiguate vs portfolio credentials | Two products |
| My Assets | Asset list | Keep label; bind to Asset.id over time | IA |
| PINIT ID | User `shortId` | Not asset PIN-XXXX | Don’t confuse |
| Network Intelligence | Org reach (admin) | Don’t use the intended meaning in Hub marketing | Collision |
| Collectors | Exchange social proof | Not in company profile | Positioning |

---

## 11. PinitHub Asset Model Comparison

Part 4 vs implementation.

| Element | Intended | Today | Status |
|---------|-----|-------|--------|
| 01 Identity | Persistent, multi-signal | DNA layers + Asset.id + vault + cert | ◐ |
| 02 Creator | Connected | Owner user; campaign people; Exchange creator | ◐ |
| 03 Ownership | Docs + relationships | Certificate + owner; weak transfer/commission | ◐ |
| 04 Metadata | File, dates, AI, context | MetadataLayer, contentAnalysis, Asset.metadata | ◐ |
| 05 Versions | Original→derivative→published | AssetVersion in campaigns | ◐ |
| 06 Relationships | Graph | FKs + Layer 8 duplicates | ○ graph |
| 07 Activity | Capture…investigation | Timeline types + share logs + Exchange events | ◐ |
| 08 Permissions | View…revoke | ShareLink + org + member access | ◐ |
| 09 Provenance | Origin + evidence | OriginLayer + events | ◐ |
| 10 Evidence | Certs, licences, watermarks, takedowns… | Subset; licences on Exchange; takedown draft | ◐ |
| 11 History | Asset Memory | Split event stores | ◐ |
| 12 Status | Draft…Inactive | AssetStatus + ReviewStatus + share flags | △ |
| PIN-XXXX | Public asset id | Not implemented | ○ |

Traditional FILE `IMG_4837.jpg` vs Pinithub ASSET: **directionally true after protect**; **not** how Hub currently *presents* the object.

---

## 12. What PinitHub Already Does Differently

Defensible today (no exaggeration):

1. **Asks “what happened?” for enrolled assets** — share logs, timeline events, monitoring alerts, investigation — vs drive “file is in this folder.”
2. **Identity beyond filename** — multi-layer DNA + optional certificate + recover-ownership path.
3. **Share without abandoning control** — OTP, caps, mask, revoke, intelligence, licensed-share from Exchange.
4. **Discover ≠ proof** — compare/investigate before treating a lookalike as the asset.
5. **Agency context** — client/campaign/version/approval/handover is not generic DAM folders.
6. **Commerce is optional and identity-linked** — listing uses Hub `asset_id`; Hub is not a shop.

That is the real differentiation. The graph, PIN-XXXX, and network intelligence are **not** that differentiator yet.

---

## 13. Future Strategic Capabilities

State as **vision / not implemented** unless noted:

| Capability | Status |
|------------|--------|
| Asset Relationship Graph | □ |
| Network Intelligence (entity graph) | □ (admin counts ≠ this) |
| DAIP / IICLME continuous authorized-web intelligence | □ (`docs/DAIP-IICLME-HLD-v2.0.md`) |
| LEARN → PROTECT AGAIN closed loop | □ |
| Full capture suite | □ / ◐ extension |
| Native post-download tracking | □ |
| Automated takedown / DMCA case system | □ |
| PINIT Career | □ |
| PIN-XXXX | □ |
| Contracts as asset-linked objects | □ |
| Deepfake / video-audio DNA at ML quality | □ / ◐ optional services |
| SSO / SCIM enterprise IdP | □ |

The Part 5 complete loop (CONNECT, UNDERSTAND, LEARN, PROTECT AGAIN) is the **destination narrative**, not the 2026 shipping checklist.

---

## 14. Recommended Content for Final Company & Product Profile

Do **not** write the profile here. Use this as the approved fact filter.

| # | Section | TODAY (confident) | PARTIAL | FUTURE VISION |
|---|---------|-------------------|---------|---------------|
| 1 | Company identity | PINITHUB; PinIT Hub live; Digital Asset Intelligence & Protection; Secure · Connect · Control; TheCareerTech if legal block included | Product family naming consistency | Career |
| 2 | Problem | Control gap after share; fragmentation; “where is the file?” vs “what happened?” | — | — |
| 3 | Why existing systems insufficient | Storage/DAM/copyright/provenance each partial | — | — |
| 4 | Fundamental difference | Asset-centric control layer for enrolled assets | Memory as one UX | Graph + network intel |
| 5 | Asset model | Identity (DNA) + custody + owner + activity + evidence ingredients | Full 12-element object | PIN-XXXX, graph |
| 6 | Product architecture | Hub / Business / Exchange / one identity | Portfolio dual-store cleanup | Career |
| 7 | Core capabilities | Protect, prove, share, detect, investigate | Intelligence as named pillar | — |
| 8 | Lifecycle | Hub loop + The intended longer loop as model | Capture/monitor breadth | Full loop |
| 9 | Identity | DNA + cert + user PINIT ID | One asset ID UX | PIN-XXXX |
| 10 | Ownership and rights | Certificates; Exchange licences | Hub rights UX | Contract graph |
| 11 | Memory and lineage | Events, campaign versions, logs | Unified memory | Complete derivative lineage |
| 12 | Evidence | Reports, certs, logs, investigation packs | Continuous packaging | Auto evidence engine (DAIP) |
| 13 | Intelligence | Search, OCR, forensic, access intel | “Understanding” | Network + LEARN |
| 14 | Relationships | Org, client, campaign, share, licence (Exchange) | Platforms, publishers | Relationship Graph |
| 15 | Exchange | Built as marketplace on Hub assets | GTM live vs coming soon | Mature royalties |
| 16 | Business / agency | Clients, campaigns, versions, handover | Integrations | — |
| 17 | Monitoring | Enrolled + watch surfaces | Connector coverage | IICLME |
| 18 | Investigation | Unified pipeline, compare, findings, reports | Named match tiers | — |
| 19 | Network intelligence | — | Admin org reach (internal) | True graph |
| 20 | Strategic differentiation | What happened to the asset? (scoped) | — | Intelligence layer everywhere legitimate |

---

## 15. Open Questions / Items for Review

1. **Exchange status sentence** for all public docs: live / early access / coming soon? Landing and `exchange/` currently disagree.
2. **Is `Asset.id` the public Pinithub Asset**, or remain internal while Vault stays user-facing?
3. **PIN-XXXX:** productize or treat as metaphor only?
4. **Portfolio:** confirm Hub Prisma is sole write path in production (Exchange `portfolio_profiles` leftover?).
5. **Company legal name / year / “developed by other team” DNA engine:** how to credit PINIT-DNA vs PINITHUB without two companies.
6. **Takedown:** mention as owner-controlled draft only, or omit until workflow exists?
7. **Network Intelligence:** forbid the phrase in company profile until graph exists?
8. **Career:** one line roadmap vs omit?
9. **How much DNA technical depth** (15 layers, stego, ZK) belongs in a client-facing profile? Recommendation: near-zero.
10. **Production verification** of monitoring crawler, Exchange checkout, and biometric login on live hosts — **Needs verification** for any “working in production” claim.
11. **Inferred phrase** “The system should remember, not the user” — approve as official principle? **[inference]**

---

## 16. Final Direction

After this review, the Company & Product Profile should communicate:

> **PINITHUB** gives important digital assets a control layer: identity (Asset DNA), protection (Hub vault and permissions), memory (activity and provenance for enrolled assets), and action (share control, monitoring of configured surfaces, investigation and evidence).  
> **PinIT Hub** is what exists today. **Business** extends that into client and campaign work. **Exchange** is how those same assets can be licensed — optional, identity-linked, not the definition of the company.  
> We are **not** another drive. We do **not** yet remember every copy on every platform. We **do** connect identity, protection, sharing, detection and investigation around the asset itself — and that is the category we are building: **Digital Asset Intelligence & Protection.**

Only after this analysis is reviewed and approved (especially §15) should the final Company & Product Profile be written — **same navy/teal design system, different information architecture**, vision copy from the five parts, claims filtered by this matrix.

---

### Appendix A — Primary evidence index

| Area | Pointer |
|------|---------|
| Hub routes | `client/src/router.tsx` |
| Hub nav | `client/src/components/nav/Sidebar.tsx` |
| Brand | `client/src/config/brand.config.ts` |
| API mount | `src/app.ts` |
| Schema | `prisma/schema.prisma` |
| Business API | `src/api/routes/business.routes.ts` |
| DNA / vault / share / monitor / forensics | matching `src/api/routes/*.ts` |
| Asset protect | `src/services/assets/asset.service.ts`, `POST /assets/protect` |
| Vault → Asset | `src/services/vault/vault.service.ts` |
| Exchange app | `exchange/src/lib/exchange-routes.js` |
| Exchange DB | `exchange/server/schema/exchange.postgres.sql` |
| Hub↔Exchange | `src/api/routes/exchange.routes.ts` |
| Landing claims | `pinithub-landing/lib/defaults.ts` |
| DAIP future | `docs/DAIP-IICLME-HLD-v2.0.md` |
| Network admin | `master-admin/src/admin/pages/NetworkIntelligencePage.tsx` |
| Portfolio SoT | `prisma` `Portfolio`; `src/services/portfolio/portfolio.service.ts` |

### Appendix B — Audit classes used in §3

- **A** Implemented and wired to real models/APIs  
- **B** Implemented but incomplete vs vision  
- **C** In code/docs, not proven working here  
- **D** Planned / HLD  
- **E** Not present  
