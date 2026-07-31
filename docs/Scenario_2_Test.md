# Scenario 2 Test — Protect Download → Native Re-Upload

**Status:** Not executed  
**Scenario:** Protected file uploaded natively; system proves ownership, not subscriber.

---

## Prerequisites

- [ ] DNA generated for test image/PDF
- [ ] Protect Download completed (TEP embedded)
- [ ] Certificate issued
- [ ] Monitoring enrolled for DNA record
- [ ] `MONITORING_CRAWLER_ENABLED=true` on backend (if testing crawl path)
- [ ] Optional: YouTube test upload for crawl detection

---

## Steps

| # | Action | Expected Result | Actual Result | Pass |
|---|--------|-----------------|---------------|------|
| 1 | Generate DNA → Protect Download | File downloaded with TEP | | |
| 2 | Note certificate ID + DNA record ID | Stored for reference | | |
| 3 | Upload protected file to external platform (or local “re-upload” sim) | File hosted outside PINIT | | |
| 4 | Enroll in Monitoring → run check | Alert or match (if crawl configured) | | |
| 5 | Unified Investigation → upload leaked copy | Investigation runs | | |
| 6 | Verify result shows Original Owner | Owner name/ID matches | | |
| 7 | Verify Certificate linked | Cert ID visible | | |
| 8 | Verify DNA Match + Similarity | Score above threshold | | |
| 9 | Verify Watermark Found (if applicable) | TEP/watermark detected | | |
| 10 | Verify **“Cannot Identify Subscriber”** shown | Honest limitation visible | | |

---

## Evidence Required

1. [ ] Protect Download success screen
2. [ ] Certificate page
3. [ ] Monitoring enrollment + alert (if crawl)
4. [ ] Unified Investigation result with owner + limitation label

---

## Pass / Fail

| **Result** | ☐ Pass ☐ Fail ☐ Blocked |
| **Commit** | |
| **Date** | |

---

## Known Limitations

- Native platform upload provides **ownership only**, not which subscriber leaked.
- Crawl detection is hours-bound, not seconds.
- Piracy site coverage is limited.

---

## Fail Notes

*(Fill if Fail)*
