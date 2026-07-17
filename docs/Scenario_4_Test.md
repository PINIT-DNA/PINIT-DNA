# Scenario 4 Test — Manual Leak Report

**Status:** Not executed  
**Scenario:** User reports leak manually; system shows honest discovery method.

---

## Prerequisites

- [ ] Leaked file obtained (simulated: second copy of protected download)
- [ ] Owner account with original DNA in vault
- [ ] Do **not** use crawler/Telegram auto-detection for this test

---

## Steps

| # | Action | Expected Result | Actual Result | Pass |
|---|--------|-----------------|---------------|------|
| 1 | Navigate to Unified Investigation | Page loads | | |
| 2 | Upload suspected leaked file | Investigation starts | | |
| 3 | Wait for completion | Verdict returned | | |
| 4 | Result shows Original Owner + Asset | Matches vault | | |
| 5 | Result shows **“Reported by User”** or equivalent | Manual source labeled | | |
| 6 | Result shows **“Manual Investigation”** | Not “Crawler found Telegram” | | |
| 7 | Certificate + DNA evidence present | Exportable | | |
| 8 | PDF evidence report downloads | Valid PDF | | |

---

## Evidence Required

1. [ ] Unified Investigation upload screen
2. [ ] Full result with discovery method label
3. [ ] PDF evidence export

---

## Pass / Fail

| **Result** | ☐ Pass ☐ Fail ☐ Blocked |

---

## Known Limitations

- Closed Telegram/Discord groups cannot be crawled.
- System cannot detect leaks user never reports or files never obtained.
- “Report Leak” dashboard button **not built yet** — use Unified Investigation directly until P2.

---

## Fail Notes

*(Fill if Fail)*
