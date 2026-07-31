# Scenario 1 Test — Link Forward Chain (A → B → C)

**Status:** Not executed (awaiting local proof)  
**Scenario:** Smart Link forward hop chain with per-viewer revoke  
**Acceptance:** Owner sees A→B→C; revoke Viewer 3 only; others continue.

---

## Prerequisites

- [ ] Backend running locally (`localhost:4000`) OR production Render @ latest `ashwitha` commit
- [ ] Frontend running locally OR `https://pinit-dna.vercel.app` with matching backend
- [ ] Logged in as owner
- [ ] Test file in Vault (e.g. `han.webp`)
- [ ] 3 devices OR 3 browsers with distinct fingerprints (phone, laptop, sir’s phone)
- [ ] WhatsApp or SMS to share URLs between testers
- [ ] Location enabled on phone for GPS proof

---

## Steps

| # | Action | Expected Result | Actual Result | Pass |
|---|--------|-----------------|---------------|------|
| 1 | Vault → Share → create Smart Link (note parent token) | Link created; production URL copied | | |
| 2 | Device A opens parent URL → Allow location | File visible within ~3s | | |
| 3 | Wait for VIEWED in Access Intelligence | Viewer 1 on map with GPS/IP | | |
| 4 | Device A forwards same URL to Device B via WhatsApp | B receives parent URL | | |
| 5 | Device B opens link | Redirect to new hop URL OR separate timeline | | |
| 6 | Device B taps “Share further”, sends to Device C | New URL copied | | |
| 7 | Device C opens hop URL | File loads; VIEWED logged | | |
| 8 | Owner → Access Intelligence → parent token | ≥3 unique viewers; hop count shown | | |
| 9 | Owner → Link Tree (`/link-tree/{parentToken}`) | Tree shows parent → hops | | |
| 10 | Owner revokes Viewer 3 only | Viewer 3 marked Revoked | | |
| 11 | Viewer 3 reopens their URL | “Access Revoked” screen | | |
| 12 | Viewers 1, 2, 4 reopen URLs | File still loads | | |

---

## Evidence Required (Screenshots)

1. [ ] Smart Link creation in Vault (production URL visible)
2. [ ] Share viewer on Device A with watermark
3. [ ] Access Intelligence map with 3+ pins
4. [ ] Link Tree showing hop chain
5. [ ] Viewer 3 revoked in list
6. [ ] Viewer 3 “Access Revoked” screen
7. [ ] Viewer 1 still viewing file after revoke

---

## Pass / Fail

| | |
|-|-|
| **Result** | ☐ Pass ☐ Fail ☐ Blocked |
| **Tester** | |
| **Date** | |
| **Commit tested** | |
| **Environment** | ☐ Localhost ☐ Production |

---

## Known Limitations

- GPS requires browser consent; laptop may show IP-only location.
- First Render request after idle may take ~50s (free tier).
- Hop redirect requires recipient to keep page open until VIEWED fires.

---

## Fail Notes

*(Fill if Fail)*
