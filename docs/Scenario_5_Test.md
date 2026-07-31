# Scenario 5 Test — Enterprise TEP (Unique Recipient)

**Status:** Not executed  
**Scenario:** Each recipient gets unique tracking; leak identifies recipient with evidence.

---

## Prerequisites

- [ ] Enterprise test doc in Vault
- [ ] Two distinct recipients (e.g. journalist A, journalist B)
- [ ] Protect Download OR separate Smart Links per recipient
- [ ] TEP codes recorded per export

---

## Steps

| # | Action | Expected Result | Actual Result | Pass |
|---|--------|-----------------|---------------|------|
| 1 | Generate DNA + Certificate | Complete | | |
| 2 | Recipient A: Smart Link OR protected download | Unique token / TEP A | | |
| 3 | Recipient B: separate link or download | Unique token / TEP B | | |
| 4 | Each opens link → allow location | Separate VIEWED logs | | |
| 5 | Access Intelligence per parent token | 2 viewers, distinct GPS/device | | |
| 6 | Recipient A downloads file | TEP A in download log | | |
| 7 | Simulate leak: upload A’s copy to investigation | Attribution to Recipient A | | |
| 8 | attribute-leak or unified investigation | Watermark/TEP → recipient A | | |
| 9 | Evidence PDF includes timeline, GPS, device, cert | Full package | | |
| 10 | Recipient B’s copy attributes to B only | No cross-attribution | | |

---

## Evidence Required

1. [ ] Two distinct Smart Link tokens or TEP codes
2. [ ] Access Intelligence showing both viewers
3. [ ] TEP manifest API response for each
4. [ ] Leak attribution result pointing to correct recipient
5. [ ] Evidence PDF

---

## Pass / Fail

| **Result** | ☐ Pass ☐ Fail ☐ Blocked |

---

## Known Limitations

- GPS requires recipient consent on link open.
- No automated HR case management.
- Unique link per recipient requires separate shares or hop chain (Scenario 1 overlap).

---

## Fail Notes

*(Fill if Fail)*
