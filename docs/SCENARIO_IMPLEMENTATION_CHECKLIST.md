# PINIT-DNA — Scenario Implementation Checklist

**Status:** Pre-implementation checklist (Phase 2 planning)  
**Date:** 14 July 2026  
**Rule:** No code deploy until each row is locally tested and you approve.

Legend: ✅ Supported · ⚠️ Partially supported · ❌ Missing · 🔴 Broken · 📋 Cannot prove yet

---

## Scenario 1 — Link Forward Chain (A → B → C)

| Requirement | Status | Needs |
|-------------|--------|-------|
| Owner uploads → DNA → Vault → Smart Link | ✅ | — |
| Viewer A opens parent link | ✅ | Local retest after location fix |
| Viewer A forwards URL → Viewer B | ✅ | WhatsApp real device test |
| Auto child link (hop) for B | ✅ | Verify `redirectToken` in network tab |
| B shares further → Viewer C | ✅ | “Share further” button |
| Auto child link for C | ✅ | — |
| Each viewer: own timeline | ✅ | Aggregated logs on parent token |
| Each viewer: own GPS | ⚠️ | Consent + phone for precise GPS |
| Each viewer: own downloads | ✅ | TEP on download |
| Each viewer: own activity log | ✅ | Per hop `ShareAccessLog` |
| Each viewer: own investigation entry | ❌ | One-click from viewer row |
| Each viewer: own revoke status | ✅ | Device-scoped block |
| Owner sees Link A → B → C tree | ⚠️ | `LinkTreePage` exists; not in main intel UI |
| Every node clickable | ⚠️ | Tree page only |
| Revoke Viewer 3 only | ✅ | Fixed device-scoped; retest |
| Viewers 1, 2, 4 continue | ✅ | Retest after Render deploy |
| No global revoke on viewer revoke | ✅ | — |
| Full link revoke | ✅ | `DELETE /share/:token` |
| Hop cascade on full revoke | ❌ | Optional fix |

**Overall Scenario 1:** ⚠️ **Partially supported** — core hop logic works; **proof gaps** in tree UX, list aggregation stats, investigation link per viewer.

| Work type | Item |
|-----------|------|
| Needs implementation | Investigate button per viewer → Unified Investigation pre-filled |
| Needs UI | Inline hop tree on Link Intelligence (or prominent Link Tree link) |
| Needs backend | Aggregated stats on `GET /share` list (optional) |
| Needs crawler | No |
| Cannot prove until | Local 3-device WhatsApp test with production URLs |

---

## Scenario 2 — Protect Download → Native Re-Upload

| Requirement | Status | Needs |
|-------------|--------|-------|
| Protect Download with TEP/watermark | ✅ | — |
| User uploads file natively elsewhere | 📋 | Manual step outside app |
| Monitoring detects re-upload | ⚠️ | Crawler env + YouTube key |
| Investigation upload | ✅ | Unified Investigation |
| DNA match | ✅ | — |
| Certificate shown | ✅ | — |
| Original owner shown | ✅ | — |
| Original asset shown | ✅ | — |
| Similarity score | ✅ | — |
| Watermark found | ⚠️ | Depends on embed survival |
| “Cannot Identify Subscriber” label | ❌ | UI copy in investigation result |
| Confidence score | ✅ | — |
| Monitoring → Investigate one-click | ❌ | — |

**Overall Scenario 2:** ⚠️ **Partially supported** — best demo path; missing honest subscriber limitation UI + prod crawler certainty.

| Work type | Item |
|-----------|------|
| Needs UI | Investigation verdict panel with limitation callout |
| Needs backend | None for proof |
| Needs crawler | Verify `MONITORING_CRAWLER_ENABLED` + enroll DNA |
| Cannot prove until | Protected file re-uploaded + crawl cycle or manual investigation |

---

## Scenario 3 — Tamper / Crop / Re-Encode

| Requirement | Status | Needs |
|-------------|--------|-------|
| Crop test | ⚠️ | Unified Investigation only |
| Resize / brightness / contrast | ⚠️ | API `/forensic/diff` |
| Screenshot / screen recording | ⚠️ | Investigation pipeline |
| JPEG / PNG conversion | ⚠️ | Manual + investigate |
| Filter / small WM damage | ⚠️ | — |
| SHA match | ✅ | — |
| Perceptual hash | ✅ | — |
| Embedding / CLIP | ✅ | Python AI |
| Watermark decode | ⚠️ | File-dependent |
| Owner + certificate | ✅ | — |
| Similarity | ✅ | — |
| No false owner | ⚠️ | Confidence thresholds |
| “Needs Manual Review” when low | ⚠️ | Acceptance engine exists; UI label unclear |
| Dedicated tamper test UI | ❌ | ComparePage not routed |

**Overall Scenario 3:** ⚠️ **Partially supported** — strong backend; **cannot prove cleanly** without test script + UI labels.

| Work type | Item |
|-----------|------|
| Needs UI | Verdict banner: Match Found vs Needs Manual Review |
| Needs UI | Route `ComparePage` or tamper section in Unified Investigation |
| Needs backend | None for basic proof |
| Needs crawler | Optional (hours path) |
| Cannot prove until | Golden test files + screenshot evidence |

---

## Scenario 4 — Manual Leak Report

| Requirement | Status | Needs |
|-------------|--------|-------|
| Report Leak entry point | ❌ | Dashboard button |
| Upload suspected file | ✅ | Unified Investigation |
| Investigation pipeline | ✅ | — |
| DNA + owner + evidence | ✅ | — |
| “Reported by User” label | ❌ | Report metadata |
| “Manual Investigation” label | ⚠️ | Partial in orchestrator |
| “Verified” status | ✅ | Investigation verdict |
| Do NOT show “Crawler found Telegram” | ⚠️ | Must audit report template |
| Telegram private group crawl | ❌ | Honest limitation |
| Discord crawl | ❌ | — |

**Overall Scenario 4:** ⚠️ **Partially supported** — investigation works; **missing entry point + honest discovery labels**.

| Work type | Item |
|-----------|------|
| Needs UI | “Report Leak” → `/unified-investigation` |
| Needs UI | Discovery method on result screen |
| Needs backend | Optional `discoveryMethod: USER_REPORT` on evidence |
| Needs crawler | No (honest) |
| Cannot prove until | Manual upload demo + screenshot of labels |

---

## Scenario 5 — Enterprise TEP

| Requirement | Status | Needs |
|-------------|--------|-------|
| Unique Smart Link per recipient | ⚠️ | One link per person OR hop per forward |
| Unique watermark (TEP) | ✅ | Per download export |
| Unique timeline | ✅ | Per hop / per token |
| Unique viewer record | ✅ | Access Intelligence |
| Unique activity | ✅ | ShareAccessLog |
| Unique investigation | ⚠️ | Manual navigation |
| Leak → identify recipient | ✅ | TEP + attribute-leak API |
| Timeline + GPS + device | ✅ | Consent for GPS |
| Certificate + evidence | ✅ | PDF export |
| HR report | ❌ | Not automated |

**Overall Scenario 5:** ✅ **Mostly supported** — strongest scenario; GPS consent + HR workflow are documented limits.

| Work type | Item |
|-----------|------|
| Needs UI | Evidence package one-click from Access Intelligence |
| Needs UI | Google Maps link on GPS pin |
| Needs backend | None for core proof |
| Cannot prove until | 2+ recipients with TEP downloads + leak attribution test |

---

## Cross-Cutting Checklist

### Investigation improvements

| Field | Status |
|-------|--------|
| Original Owner | ✅ |
| Original Asset | ✅ |
| Certificate | ✅ |
| DNA Layers | ✅ |
| Watermark | ⚠️ |
| Similarity | ✅ |
| Timeline | ⚠️ |
| Activity / Viewer | ⚠️ |
| GPS / Device | ✅ |
| Platform | ⚠️ |
| Discovery Method | ❌ |
| Confidence | ✅ |
| Download Evidence | ✅ |
| Generate Report | ✅ |
| Generate DMCA Draft | ❌ |

### Monitoring improvements

| Field | Status |
|-------|--------|
| Platform | ✅ |
| URL | ✅ |
| Time | ✅ |
| Confidence | ✅ |
| Status | ✅ |
| Evidence | ⚠️ |
| Open Investigation | ❌ |
| Owner / Certificate | ⚠️ |
| One-click Investigate | ❌ |

### Tracking improvements

| Field | Status |
|-------|--------|
| Parent / Child link | ✅ DB; ⚠️ list UI |
| Generation | ✅ |
| Viewer | ✅ |
| GPS + coordinates | ✅ |
| Google Maps link | ❌ |
| Device / Browser | ✅ |
| Downloads / Shares | ✅ |
| Screenshots | ⚠️ COPY/SCREENSHOT_ATTEMPT events |
| Timeline | ✅ |
| Revoked + reason | ✅ |

### Alerts

| Alert type | Status |
|------------|--------|
| New Viewer | ⚠️ LINK_VIEWED event |
| New Device | ⚠️ |
| Country Changed | ❌ |
| Impossible Travel | ❌ |
| VPN Detection | ⚠️ BLOCKED_VPN |
| Multiple Downloads | ⚠️ |
| Revoked Viewer Access | ⚠️ BLOCKED_REVOKED |
| Leak Found | ⚠️ Monitoring alert |
| DNA Match | ⚠️ |
| Manual Report | ❌ |

### Evidence package PDF

| Field | Status |
|-------|--------|
| Owner, Certificate, DNA, Timeline | ✅ |
| Viewer, GPS, Similarity, Watermark | ⚠️ |
| Platform, URL, Discovery, Confidence | ⚠️ |
| PDF ready | ✅ |

---

## Implementation Priority (After Your Approval)

| Priority | Task | Scenarios | Est. scope |
|----------|------|-----------|------------|
| P0 | Local proof scripts + test MD execution | All | Docs + manual |
| P1 | Scenario 1: tree UX + aggregated list stats + revoke regression | 1 | 3–5 files, no schema |
| P1 | Location fast-open verify (already coded — you test) | 1, 5 | 0 new |
| P2 | Investigation honesty labels (subscriber / manual / discovery) | 2, 4 | 2–3 UI files |
| P2 | “Needs Manual Review” verdict banner | 3 | 1–2 UI files |
| P2 | Report Leak nav entry | 4 | 1 file |
| P3 | Google Maps deep link on map pins | 1, 5 | 1–2 files |
| P3 | Monitoring → Investigate one-click | 2 | 2 files |
| P4 | DMCA draft generator | 1–3 | New service — defer until proof done |

**No push, no merge, no deploy until you sign off each P0/P1 item locally.**

---

## Files Likely to Change (Preview — Not Touched Yet)

| File | Scenario | Change type |
|------|----------|-------------|
| `client/src/pages/LinkIntelligencePage.tsx` | 1, 5 | Link to tree; Maps link |
| `client/src/pages/AccessIntelligencePage.tsx` | 1 | Aggregated stats (optional) |
| `client/src/pages/UnifiedInvestigationPage.tsx` | 2, 3, 4 | Verdict + honesty labels |
| `client/src/pages/MonitoringPage.tsx` | 2 | Investigate button |
| `client/src/layouts/DashboardLayout.tsx` | 4 | Report Leak nav |
| `client/src/components/maps/FileTrackingMap.tsx` | 1, 5 | Google Maps link |
| `src/services/share/share-link.service.ts` | 1 | List aggregation (optional) |
| `src/services/evidence/evidence-report.service.ts` | All | PDF fields |
| `docs/Scenario_*_Test.md` | All | Test execution records |

---

*Checklist complete. Implementation blocked until your approval.*
