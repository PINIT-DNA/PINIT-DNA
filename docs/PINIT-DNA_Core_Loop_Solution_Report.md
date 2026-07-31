# PINIT-DNA Core Loop — Solution Report

**Prepared for:** Tct / PINIT-DNA Leadership  
**Prepared by:** Ashwitha  
**Date:** 13 July 2026  
**Application:** PINIT-DNA v2.0 (production: https://pinit-dna.vercel.app)  
**Branch:** ashwitha · Latest commit: 447857d

---

## 1. Executive Summary

This report responds to the document **"PINIT-DNA Core Loop — Realtime Use-Case Scenarios"**, which defines five stress-test scenarios for the end-to-end loop:

**Upload → Fingerprint → Vault → Tracked Share → Distribution → Detection → Alert → Takedown**

The scenarios are intentionally honest: "near real-time" is not one number — it depends on the **detection channel** (link-controlled delivery, native file upload, social re-encoding, closed groups, or enterprise TEP).

**Key finding:** PINIT-DNA already implements the **core technical loop** for creator and enterprise use cases. The largest gaps are not in fingerprinting or investigation accuracy, but in **(a)** production enablement of monitoring/crawler, **(b)** one-click DMCA/takedown workflow, **(c)** per-subscriber session watermarking (Phase 2 / agency integration), and **(d)** closed-platform crowd reporting.

**Recommendation:** Focus the next sprint on making **Scenario 2 (native upload — the common case)** and **Scenario 5 (enterprise TEP)** demo-ready on production, while documenting honest limitations for Scenarios 1, 3, and 4.

---

## 2. What the Scenario Document Covers

### 2.1 Core architectural distinction

The document defines **two separate tracking mechanisms**:

| Mechanism | When it applies | What it provides |
|-----------|-----------------|------------------|
| **Link-level tracking** | Content delivered via PINIT-DNA Smart Link, redirect, or agency-built player | GPS/device intelligence on access, per-session delivery control |
| **Watermark/fingerprint tracking** | Content uploaded natively to third-party platforms (OnlyFans-style, white-label without integration) | Ownership proof + leak detection via bytes embedded in the file — survives re-upload |

This distinction is critical for sales and product honesty. Promising "who leaked it" on native-upload platforms is incorrect without delivery-layer integration.

### 2.2 The five scenarios

| # | Scenario | Persona | Detection speed | Attribution |
|---|----------|---------|-----------------|-------------|
| 1 | Exact re-upload, link-controlled | Agency platform / DM delivery | Hours (crawl cycle) | Per-subscriber (session watermark) |
| 2 | Exact re-upload, native upload | Established platform, file uploaded as-is | Hours (crawl cycle) | Ownership only — no source |
| 3 | Screen-recorded, re-encoded, social | Filtered/cropped repost to Instagram/X | Seconds (API) to hours (crawl) | Ownership only |
| 4 | Private-group leak | Telegram/Discord closed channels | Fast if reported; near-zero otherwise | Ownership only |
| 5 | Enterprise document leak | TEP + Smart Link to journalist | Near-instant (access log) | Per-recipient |

### 2.3 What the document proves (and admits)

- **Proves:** Layered detection (hash → perceptual → watermark → embedding) is the right architecture; delivery-layer control unlocks attribution.
- **Admits:** Crawl-based detection is hours-bound; closed groups are a structural blind spot; social platforms need API partnerships for seconds-level detection; DMCA is a separate workflow from detection.

---

## 3. Current Application State vs Scenarios

### 3.1 Core loop — component mapping

| Loop step | Current status | Where in codebase |
|-----------|----------------|-------------------|
| Upload | **Working** | Generate DNA, Vault upload, client UploadZone |
| Fingerprint (15-layer DNA) | **Working** | `src/services/layers/`, `engines/`, Python AI |
| Vault (AES-256-GCM) | **Working** | `src/services/vault/`, Supabase Storage |
| Tracked share | **Working** | Smart Links, TEP/Protect Download, Share Viewer |
| Distribution | **Partial** | Smart Link + protected file; no agency player SDK yet |
| Detection | **Partial** | Monitoring + YouTube/GitHub/Reddit/web crawler; often disabled on prod |
| Alert | **Working** | Monitoring Match Alerts, Security Center, platform events |
| Takedown | **Not built** | Docs state DMCA is separate workflow — no one-click button |

### 3.2 Scenario-by-scenario assessment

#### Scenario 1 — Link-controlled distribution (agency / creator-direct)

| Step in doc | Current capability | Gap |
|-------------|---------------------|-----|
| 15-layer fingerprint + vault | Fully implemented | — |
| Tracked delivery link | Smart Link + Protect Download | Session-specific A/B watermark variants not in prod |
| GPS/device on access | Smart Link viewer logs location (with user consent) | No embedded player SDK for agency partners |
| Crawler exact-hash match | Hash + perceptual in monitoring pipeline | Crawler engine disabled by default on Render |
| Per-subscriber attribution | TEP per-recipient exists for enterprise | Not wired for creator streaming sessions |
| One-click DMCA | Not implemented | **Major gap** |

**Verdict:** ~70% — strong on fingerprint, vault, links; weak on session watermark + DMCA + prod crawler.

#### Scenario 2 — Native file upload (common case)

| Step in doc | Current capability | Gap |
|-------------|---------------------|-----|
| Fingerprint before platform upload | Generate DNA + Download Protected | User must use protected download before uploading elsewhere |
| Watermark in file bytes | TEP embeds watermark + 15-layer markers | — |
| No delivery visibility | Correct — no GPS on native platform views | By design until Phase 2 API |
| Crawler finds re-upload | YouTube filename search working (98% matches observed) | Piracy tube domain list coverage limited |
| Ownership proof on alert | Unified Investigation + certificates | Reports improved in recent sprint |
| No "which subscriber" | Correct limitation | Phase 2 — platform calls PINIT at delivery |

**Verdict:** ~75% — this is the **best demo path today** for creators. Recent fixes: Protect Download in generate flow, canonical URLs in monitoring.

#### Scenario 3 — Re-encoded / social repost

| Step in doc | Current capability | Gap |
|-------------|---------------------|-----|
| Watermark survives re-encode | Watermark engine + investigation decode path | Needs careful demo — false positive risk |
| Embedding / CLIP match | Python FAISS + CLIP index, tile pyramid | Local FAISS — not cloud-scale yet |
| Instagram/X API detection | Not implemented | Requires platform partnership |
| Crawl-side (hours) | Image monitoring + web crawl | No dedicated Instagram connector |

**Verdict:** ~55% — investigation moat exists; external social API path missing.

#### Scenario 4 — Closed groups (Telegram/Discord)

| Step in doc | Current capability | Gap |
|-------------|---------------------|-----|
| Public crawl | Telegram connector stub in engine | No Discord; closed channels not indexed |
| Crowd-sourced report | Unified Investigation (upload suspected file) | No browser extension; no "report leak" button in product |
| Verification cascade | Full investigation pipeline | — |

**Verdict:** ~40% — honest gap; manual investigation path works if user obtains the file.

#### Scenario 5 — Enterprise TEP (Sentinel)

| Step in doc | Current capability | Gap |
|-------------|---------------------|-----|
| TEP generation | Protect Download + TEP codes | Integrated into Generate DNA flow (recent) |
| Smart Link access log | Access Intelligence page | GPS requires user consent on open |
| Per-recipient watermark | TEP tracking per export | — |
| Near-instant detection via access log | Share link events logged | No Neo4j lineage graph in prod (doc reference is future) |
| HR/legal response | Forensic reports + PDF export | Internal workflow — not automated HR integration |

**Verdict:** ~85% — **strongest scenario today** for enterprise pitch.

---

## 4. Useful Enhancements from the Scenario Document

### 4.1 Adopt now (aligns with existing architecture)

1. **Honest product copy** — Two tracking modes (link vs file) on Generate DNA success screen and Monitoring page.
2. **Enable production crawler** — Set `MONITORING_CRAWLER_ENABLED=true` and `YOUTUBE_API_KEY` on Render.
3. **DMCA evidence package generator** — Pre-fill notice from certificate + match URL + investigation report (Scenario 1/2/3).
4. **"Report suspected leak" entry point** — Routes to Unified Investigation (Scenario 4 partial fix).
5. **Redis + job queue** — Crawler dedup, retry, scale (from scalability architecture discussion).

### 4.2 Phase 2 (requires partner integration)

1. **Session-specific watermark API** — Platform calls PINIT at stream time (Scenario 1 attribution on native platforms).
2. **Agency player SDK** — Embed tracked delivery in white-label builds.
3. **Instagram/X upload-time API** — Seconds-level detection (Scenario 3).
4. **Neo4j / lineage graph** — Enterprise provenance bus (Scenario 5 doc reference).

### 4.3 Do not over-promise

- Per-subscriber attribution on OnlyFans-style native upload without platform integration.
- Real-time crawl on closed Telegram/Discord without a human report signal.
- Uniform "seconds" detection across all platforms.

---

## 5. Recommended Work — Next Few Days

Priority order based on Tct guidance: *"focus on building core functionality correctly rather than millions of users."*

### Days 1–2: Production readiness

| Task | Scenario impact | Effort |
|------|-----------------|--------|
| Enable monitoring crawler on Render (env vars) | 1, 2 | Low |
| Verify YouTube match → alert → clickable URL on prod | 2 | Low |
| Document two tracking modes in UI (link vs file watermark) | All | Low |

### Days 3–4: Core loop completion

| Task | Scenario impact | Effort |
|------|-----------------|--------|
| DMCA draft generator from alert (certificate + URL + owner) | 1, 2, 3 | Medium |
| Security Center: link monitoring alert → "Investigate" → report | 2, 3 | Medium |
| "Report Leak" quick action on dashboard → Unified Investigation | 4 | Low |

### Days 5–7: Demo polish

| Task | Scenario impact | Effort |
|------|-----------------|--------|
| End-to-end demo script: Scenario 2 (watermarked video → YouTube find → investigate) | 2 | Low |
| End-to-end demo script: Scenario 5 (TEP PDF → share → access log → investigate) | 5 | Low |
| Admin monitoring dashboard: show crawler status + last scan | 1, 2 | Low |

### Explicitly deferred (future pipeline)

- Kafka / microservices split
- Neo4j lineage graph
- Browser extension for crowd reports
- Agency player SDK
- Instagram/X API partnerships

---

## 6. Pitch-Honest "Near Real-Time" Statement

For stakeholders and investors, use this framing from the scenario document:

> **Fastest and most attributable** where PINIT-DNA controls distribution (Smart Links, TEP, agency-built platforms).  
> **Slower but ownership-proven** where we discover leaks on the open web via crawler (hours, crawl-cycle bound).  
> **Structurally limited** on closed platforms without a reporting signal.

This is more credible than promising uniform real-time coverage everywhere.

---

## 7. Conclusion

The scenario document is an excellent **product and GTM specification**. PINIT-DNA's current build already supports the hardest technical pieces: 15-layer DNA, vault encryption, protected downloads with TEP, Smart Link intelligence, unified investigation with acceptance engine, and internet monitoring with YouTube/GitHub/Reddit connectors.

**Immediate focus:** Close the loop from **Alert → Evidence → DMCA draft**, enable crawler on production, and demo **Scenario 2** (creator native upload) and **Scenario 5** (enterprise TEP) as the primary proof points.

**Strategic focus:** Agency partnership motion for delivery-layer integration — the difference between "we found where it leaked" and "we know exactly who leaked it."

---

*End of report*
