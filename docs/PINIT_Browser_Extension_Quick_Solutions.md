# PINIT Browser Extension — Quick Solutions Guide

**Purpose:** Simple overview of what a PINIT browser extension solves, how fast it helps users, where it works, and how it fits into the product.

**Status:** Product design document (extension not built in repo yet). Builds on existing web APIs: Unified Investigation, leaked-file verify, Vault, DNA match.

---

## 1. The idea (in one paragraph)

Users stay on any public webpage. They right-click an image (or scan the page) and ask PINIT: *“Is this ours / is this protected / investigate this?”* The extension sends the image to the same forensic engine as the web app, then shows a short result and can open the full report in PinIT Hub. No need to download the file by hand and upload it first.

---

## 2. How it works (simple flow)

```
User opens public webpage
        │
        ▼
Install PINIT Chrome extension + sign in (same account as PinIT Hub)
        │
        ├─ Right-click image → “Verify with PINIT”
        ├─ Popup → “Scan this page”
        └─ Popup → “Report suspicious content”
        │
        ▼
Extension captures image bytes (or image URL)
        │
        ▼
Calls PINIT backend (JWT): verify / investigate / vault save
        │
        ▼
Quick result in extension (match / no match / confidence)
        │
        ▼
Optional: “Open full report” → PinIT Hub Investigation page
```

### How we include it in the product

| Piece | Role |
|-------|------|
| Chrome extension (Manifest V3) | Right-click menu, page scan, popup UI, alerts |
| Existing PinIT Hub APIs | DNA verify, Unified Investigation, Vault save, reports |
| User login | Same `pinit_access_token` / OAuth-style login into extension |
| Deep links | Open `/investigation` or evidence page with result IDs |

Phase 1 does **not** need new DNA science — it reuses Investigation + leak verify.

---

## 3. Problems → quick solutions (application view)

| User problem | Extension solution | How fast for the user |
|--------------|--------------------|------------------------|
| “I saw my photo stolen on a website” | Right-click → Verify | **Seconds** (if image loads) |
| “I don’t want to download + re-upload manually” | Capture from page → Investigate | **Seconds to ~1–2 min** for full report |
| “Is this cropped/edited copy of my work?” | Same match cascade (hash → perceptual → watermark → embedding) | **Seconds to ~1 min** |
| “Before I reuse this image, is it in PINIT?” | Quick ownership / copyright check vs PINIT index | **Seconds** |
| “Security team needs evidence now” | Save to Vault + open detailed report | **Under 2 minutes** |
| “Closed group / random site — crawler never finds it” | Human reports from the browser | **As fast as the user reports** (not crawl-bound) |
| “I need to scan a whole article page” | Scan current webpage images | **~30 sec–few minutes** (depends on image count) |

**Pace summary**

- **Instant path (seconds):** verify one image, match / no-match badge, open Hub.
- **Fast path (1–5 min):** full investigation + vault evidence.
- **Not instant:** crawling the whole internet; private DMs; sites that block image access.

---

## 4. Use cases for users

### Creators / rights holders
1. See a leak on Instagram / blog / news site → right-click verify.
2. Confirm ownership before sending a takedown.
3. Save evidence pack to Vault in one click.
4. Report suspicious posts without leaving the browser.

### Security / enterprise teams
1. Scan public pages during an investigation.
2. Send page image straight into Investigation Engine.
3. Document findings for HR/legal without a separate upload workflow.
4. Get notified when a page scan hits a protected asset (user-triggered scan).

### Everyday / quick check
1. “Is this image registered in PINIT?” before reuse.
2. Open full forensic report only when needed.

---

## 5. Short scenarios + expected success rate

Success rate = chance of a **correct, useful result** when the user can see the image in Chrome and the extension can read it. Not “we find every leak on earth.”

| # | Scenario | What user does | Expected success | Why |
|---|----------|----------------|------------------|-----|
| A | Exact re-upload of vaulted image on a public blog | Right-click → Verify | **High (~85–95%)** | Exact / perceptual hash works well |
| B | Cropped / compressed / lightly edited copy | Verify | **Good (~70–85%)** | Watermark + embedding layers |
| C | Heavy filter + re-encode + small crop | Verify | **Medium (~50–70%)** | Probabilistic; may need full investigation |
| D | Public news / portfolio / GitHub image page | Page scan or right-click | **High (~80–90%)** | Open DOM, normal image URLs |
| E | Public X / YouTube thumbnail / LinkedIn public post | Right-click | **Good (~65–80%)** | Often works; CDN/login quirks |
| F | Instagram / Facebook public post | Right-click | **Medium (~40–65%)** | Login walls, blobs, anti-bot |
| G | Private DM / closed Telegram / Discord | Extension on that UI | **Low unless user can capture visible image** | Same closed-platform limit as crawler |
| H | Image not registered in PINIT at all | Verify | **“No match” is correct** | Not a global copyright DB |

**Honest rule:** Highest success on **public web + PINIT-registered assets**. Social platforms are best-effort. Closed apps need a visible image the user can capture/report.

---

## 6. Websites — where it works

### Strong support (best experience)
- News websites  
- Blogs  
- Portfolio sites  
- GitHub (and similar public code/doc hosts)  
- Most public marketing / company pages  
- Any public page where images are normal `<img>` / CDN URLs  

### Good support (usually works)
- YouTube (thumbnails / public page images)  
- X / Twitter (public posts)  
- LinkedIn (public pages/posts, where accessible)  

### Fragile / best-effort
- Instagram (public posts only)  
- Facebook (public pages/posts only)  

### Not a promise
- Private chats, closed groups, paywalled feeds without a visible image  
- Sites that fully block extension access to media  

**Pitch line:** Supports public webpages the user can open; strongest on open web; best-effort on major social platforms when the image is publicly visible.

---

## 7. Feature list vs speed of value

| Feature | User gets value in | Relies on |
|---------|--------------------|-----------|
| One-click image verification | Seconds | Verify API |
| Instant ownership check | Seconds | DNA index (PINIT users only) |
| Detect modified/copied images | Seconds–1 min | Match cascade |
| Quick copyright check (PINIT index) | Seconds | Same |
| Generate investigation | ~1–2 min | Unified Investigation |
| Save evidence to Vault | Seconds after match | Vault API + auth |
| Report suspicious content | Seconds | Report / incident API |
| Scan current webpage | 30 sec–few min | DOM image list + batch verify |
| Alerts during scan | Immediate on hit | Extension UI |
| Open detailed report | Instant redirect | Hub deep link |
| Enterprise workflow | Minutes per case | Same stack + team accounts |

---

## 8. What the extension does *not* replace

- Does **not** continuously track a file after download on the user’s disk.  
- Does **not** prove which OnlyFans subscriber leaked a native upload (Scenario 2 — ownership only).  
- Does **not** crawl closed platforms by itself.  
- Does **not** check copyright for images never registered in PINIT.  

It **does** make Scenario 3/4-style discovery much faster when a human is already looking at the page.

---

## 9. Suggested build phases (so users get value quickly)

| Phase | Ship | User pace win |
|-------|------|----------------|
| **Phase 1** | Login + right-click Verify + open Hub report | Same-day utility |
| **Phase 2** | Page scan + Vault save + report button | Team workflow |
| **Phase 3** | Stronger social-site handlers + alert polish | Better Instagram/FB hit rate |

---

## 10. One-line summary

**The PINIT extension is a fast “verify / investigate / save evidence” remote control for PinIT Hub on public webpages — seconds for a check, minutes for a full case — with highest success on open websites and registered PINIT assets.**
