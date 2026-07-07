# PINIT-DNA
## Complete User Test Flow & Application Guide

**Document Type:** User Test Flow / Product Walkthrough  
**Version:** 1.0  
**Date:** 6 July 2026  
**Prepared for:** New users, testers, and stakeholders  
**Live Application:** https://dna-pinit-web.vercel.app  
**Repository:** ashwitha2004/DNA-PINIT-WEB (branch: ashwitha)

---

## Purpose of This Document

This document helps a **new user** understand and **test the full PINIT-DNA application** from login to forensic investigation. Each section explains **what the module does**, **how to use it**, and **what result to expect**.

Use this when:
- Onboarding a new tester or reviewer
- Demonstrating the product to management
- Validating that all modules work end-to-end

---

## Before You Start

| Item | Detail |
|------|--------|
| **URL** | https://dna-pinit-web.vercel.app |
| **Browser** | Chrome or Edge (latest) recommended |
| **Location** | Allow GPS when prompted (required for share viewing) |
| **Camera / Mic** | Needed only if testing biometric login or scanner |
| **Test account** | Use credentials provided by the PINIT team |

**Tip:** First API call after idle may take 30–60 seconds (server wake-up). Refresh once if a page loads empty.

---

## Application Overview

PINIT-DNA is a **secure digital vault and forensic platform**. It protects files with DNA fingerprinting, encryption, tracked sharing, and investigation tools.

```
Login → Dashboard → Generate DNA → Vault → Share → Viewer Tracking
                                              ↓
                         Timeline → Intelligence → Investigation → Certificates
```

---

# PART A — CORE USER JOURNEY (Test Flow 1–9)

---

## Test 1 — Secure User Login

**Module:** Authentication (PINIT HOID)

**What it does:** Verifies identity before allowing access. Supports multi-factor biometric authentication.

**Steps:**
1. Open https://dna-pinit-web.vercel.app
2. Click **Login** or go to `/login`
3. Enter your PINIT User ID
4. Complete verification (Face / Voice / Device as configured)
5. Wait for redirect to Dashboard

**Expected result:**
- [ ] Login succeeds only for registered users
- [ ] User ID appears in sidebar (e.g. PINIT-XXXXXXXX)
- [ ] Dashboard loads without errors

---

## Test 2 — Forensic Dashboard

**Module:** Dashboard (Home)

**What it does:** Shows platform overview — DNA records, vault files, analytics, and quick actions.

**Steps:**
1. After login, confirm you are on the **Dashboard**
2. Review stat cards: Total DNA, Vault Records, Verified Files, Forensic Reports
3. Check **File Type Distribution** chart
4. Click **Refresh** and confirm data updates
5. Use quick actions: Generate DNA, Vault, Investigate, Certificates

**Expected result:**
- [ ] Stats show real numbers (not all zeros if you have data)
- [ ] Charts render correctly
- [ ] Quick action links open correct pages

---

## Test 3 — Generate File DNA

**Module:** Generate DNA

**What it does:** Creates a unique 15-layer DNA fingerprint for any supported file.

**Supported inputs:**
- Upload file
- Scan document (camera)
- Record video / audio (where enabled)

**Supported types:** Images, PDF, DOCX, PPTX, TXT, CSV, JSON, ZIP, Video, Audio

**Steps:**
1. Go to **Generate DNA** from sidebar
2. Upload a test file (e.g. PDF or JPG)
3. Review file preview: name, type, size
4. Optional: enable **location permission** for custody record
5. Click **Generate DNA Fingerprint**
6. Wait for processing to complete

**Expected result:**
- [ ] File preview shows correct metadata
- [ ] DNA generation completes (status: COMPLETE or PARTIAL)
- [ ] No error toast or blank screen
- [ ] Summary shows DNA Record ID and processing time

---

## Test 4 — Duplicate Detection

**Module:** Global DNA Registry check

**What it does:** Compares uploaded file SHA-256 hash against existing records. Duplicate attempts are logged for forensic audit.

**Steps:**
1. Upload the **same file** again (or a known duplicate)
2. Observe system response
3. Go to **Duplicate Attempts** (Forensics section) if available
4. Confirm duplicate event is logged with owner and uploader info

**Expected result:**
- [ ] System detects duplicate fingerprint
- [ ] User sees duplicate warning / forensic log entry
- [ ] Original owner information is shown

---

## Test 5 — DNA Record & Vault Creation

**Module:** DNA Records + Vault

**What it does:** Every new file gets a permanent **DNA Record ID** and **Vault ID**. File is encrypted and stored.

**Steps:**
1. After successful DNA generation, note the **DNA Record ID**
2. Note the **Vault ID**
3. Go to **Vault Explorer** — confirm file appears
4. Go to **DNA Records** — confirm record appears with status COMPLETE

**Expected result:**
- [ ] One DNA Record ID per file (unique)
- [ ] One Vault ID per file (unique)
- [ ] File visible in Vault and DNA Records lists
- [ ] Encryption shown as AES-256-GCM

---

## Test 6 — Vault Explorer

**Module:** Vault Explorer

**What it does:** Secure storage for all encrypted files. Central place for file actions.

**Steps:**
1. Open **Vault Explorer**
2. Find your test file in the list
3. Review columns: Vault ID, DNA status, encryption, size, date
4. Test action buttons:
   - View / Retrieve (eye icon)
   - Share
   - Protected Download
   - Intelligence Report
   - Activity Timeline
   - Tracking

**Expected result:**
- [ ] File list loads with search working
- [ ] Each action opens correct modal or page
- [ ] Retrieve downloads original decrypted file (owner only)

---

## Test 7 — File Retrieval (Decrypt & Download)

**Module:** Vault Retrieve

**Steps:**
1. In Vault, click **View / Retrieve** on a file
2. Download or preview the original file
3. Confirm downloaded file matches uploaded content

**Expected result:**
- [ ] Only owner can retrieve
- [ ] Decrypted file opens correctly
- [ ] File integrity preserved

---

## Test 8 — DNA Records Registry

**Module:** DNA Records

**Steps:**
1. Open **DNA Records** from sidebar
2. Search for your test file
3. Open detail view
4. Confirm: DNA ID, file type, status, vault link, creation date

**Expected result:**
- [ ] All generated records listed
- [ ] Status badges correct (COMPLETE / PROCESSING / PARTIAL)
- [ ] Detail modal shows owner and engine version

---

## Test 9 — File Timeline (Chain of Custody)

**Module:** File Timeline

**What it does:** Records every lifecycle event with forensic metadata.

**Events tracked:** DNA Generated, Encrypted, Vault Stored, Share Created, Viewed, Downloaded, Screenshot, Tab Switch, Revoked, and more.

**Metadata per event:** Timestamp, IP, GPS, Country, City, Device, Browser, Risk

**Steps:**
1. Open **File Timeline** (or timeline from Vault action)
2. Select a file with share activity
3. Scroll through events chronologically
4. Expand event details for IP, location, device

**Expected result:**
- [ ] Events appear in correct time order
- [ ] Share and access events recorded after testing share (Test 10)
- [ ] Location and device info shown when GPS allowed

---

# PART B — SECURE SHARING & TRACKING (Test Flow 10–15)

---

## Test 10 — Smart Secure Share Link

**Module:** Share Link Creation

**What it does:** Creates a tracked, permission-controlled link for external recipients.

**Configurable options:**
- Expiry date / time
- Max views / max downloads
- Download allowed or view-only
- Require recipient name
- One-time access
- OTP verification
- VPN / TOR blocking
- One device / one IP only
- Allowed countries, devices, IP ranges
- Custom message

**Steps:**
1. In Vault, click **Share** on a file
2. Configure permissions (start simple: 7-day expiry, view-only)
3. Create link and copy URL (format: `https://.../s/TOKEN`)
4. Open link in **incognito window** (simulates recipient)

**Expected result:**
- [ ] Link created successfully
- [ ] Token URL works in incognito
- [ ] Permissions enforced (e.g. download blocked if disabled)

---

## Test 11 — Location Permission (Recipient)

**Module:** Share Viewer — GPS Gate

**Steps:**
1. Open share link as recipient
2. Browser asks for location — click **Allow**
3. Confirm viewer loads after permission
4. Try again with location **Denied** — note behavior

**Expected result:**
- [ ] GPS captured when allowed (city / coordinates in logs)
- [ ] Access blocked or limited when mandatory GPS enabled and denied
- [ ] Timestamp recorded

---

## Test 12 — Secure Viewer & Live Monitoring

**Module:** Share Viewer

**What it does:** Renders file securely with watermark and behavioral tracking.

**Tracked behaviors:** View time, screenshot attempts, tab switch, idle, download, print, copy

**Steps:**
1. View shared PDF or image in secure viewer
2. Spend 30 seconds on page
3. Switch browser tab and return
4. Attempt screenshot (if on mobile/desktop)
5. Close viewer

**Expected result:**
- [ ] File renders with watermark (if enabled)
- [ ] No direct raw file URL exposed
- [ ] Activity appears in owner timeline within 1–2 minutes

---

## Test 13 — Privacy Masking & Unmask Requests

**Module:** Privacy Protection

**What it does:** Automatically masks sensitive data (Aadhaar, PAN, phone, email, etc.) in shared documents. Recipients request unmask; owner approves.

**Steps:**
1. Share a document containing sensitive text with masking enabled
2. Open as recipient — confirm masked content
3. Submit **Unmask Request** (if module available)
4. As owner, review request in **Unmask Requests**

**Expected result:**
- [ ] Sensitive fields masked for recipient
- [ ] Unmask request reaches owner (when module active)
- [ ] Unmasked content only after owner approval

**Status note:** Unmask workflow — verify with team if fully enabled in your environment.

---

## Test 14 — Protected Download (TEP)

**Module:** Protected Download / Tracked Export Package

**What it does:** Enterprise download with watermark, chain of custody, and download logging.

**Steps:**
1. In Vault, open **Protected Download** on a file
2. Complete owner verification steps
3. Generate protected download / TEP package
4. Download and note TEP code
5. Check timeline for PROTECTED_EXPORT / TEP_CREATED events

**Expected result:**
- [ ] Protected package generates successfully
- [ ] TEP code displayed and logged
- [ ] Download event in timeline

**Status note:** Post-download TEP tracking (opens, re-share, tamper) — partially implemented.

---

## Test 15 — Access Intelligence

**Module:** Access Intelligence + Link Intelligence

**What it does:** Per-link forensic dashboard — map, viewers, sessions, risk, revoke.

**Steps:**
1. Open **Access Intelligence** from sidebar
2. Select the share link you created in Test 10
3. Review: view count, countries, devices, map markers
4. Open individual **viewer profile** — device, IP, GPS, risk score
5. Test **Revoke Link** — confirm recipient loses access immediately

**Expected result:**
- [ ] All share links listed with live stats
- [ ] Map shows viewer locations
- [ ] Per-viewer activity log accurate
- [ ] Revoke terminates active sessions

---

# PART C — INTELLIGENCE & FORENSICS (Test Flow 16–20)

---

## Test 16 — Document Intelligence Report

**Module:** Intelligence Report (per vault file)

**What it does:** Master forensic report combining identity, provenance, integrity, discovery, distribution, and risk.

**Sections:**
| Section | Contains |
|---------|----------|
| Identity Intelligence | Owner, Vault ID, DNA ID, filename, engine |
| Provenance Intelligence | Upload time, vault time, GPS, country, city |
| Integrity Intelligence | DNA status, SHA-256, layers completed |
| Discovery Intelligence | OCR, monitoring matches, similar files |
| Distribution Intelligence | Share links, views, countries, devices |
| Risk Intelligence | Risk score, suspicious events, leak indicators |

**Steps:**
1. From Vault, click **Intelligence Report** on a file with share history
2. Review each section
3. Export or print if needed

**Expected result:**
- [ ] All sections load with real data
- [ ] Risk score reflects share activity
- [ ] Distribution shows your test share from Part B

---

## Test 17 — Monitoring & Crawler

**Module:** Monitoring & Crawler

**What it does:** Monitors internet for unauthorized copies of protected files.

**Steps:**
1. Open **Monitoring & Crawler**
2. Confirm files auto-enrolled after DNA generation
3. Run **Check All Now** or check single file
4. Review alerts if matches found
5. Start investigation from alert (if match appears)

**Expected result:**
- [ ] Files listed with monitor status
- [ ] Manual check runs without error
- [ ] Alerts dashboard accessible

**Status note:** Fully automated background crawler requires AI service + Bing API (pending infrastructure).

---

## Test 18 — Unified Investigation Center

**Module:** Unified Investigation

**What it does:** Upload or scan a suspected file to identify original owner and detect tampering.

**Steps:**
1. Open **Unified Investigation** (Forensics)
2. **Upload** a file you own (positive test) — confirm owner match
3. Upload an **unrelated file** (negative test) — confirm no false match
4. Review investigation pipeline stages (live timeline during processing)
5. Check: Visual comparison, DNA match %, trust score, certificate status
6. Review: Identity recovery report, 15-layer analysis, tamper analysis, evidence timeline

**Expected result (positive):** Original owner identified with acceptable confidence  
**Expected result (negative):** "No PINIT Asset Found" — not a wrong owner match

**Status note:** Camera scanner less reliable than upload — use upload for official tests.

---

## Test 19 — Ownership Certificates

**Module:** Certificates

**Steps:**
1. Open **Certificates**
2. Issue certificate for a vaulted file (if not auto-issued)
3. Download **PDF** and **JSON**
4. Test **Revoke** with reason — confirm status changes to REVOKED

**Expected result:**
- [ ] Certificate listed with ACTIVE status
- [ ] PDF downloads with owner and file info
- [ ] Revoked certificate cannot export PDF

---

## Test 20 — Verify Certificate (Public)

**Module:** Verify Certificate (no login required)

**Steps:**
1. Open **Verify Certificate** from sidebar (or public URL)
2. Enter Certificate ID from Test 19
3. Confirm validity, owner, and file details shown

**Expected result:**
- [ ] Valid certificate shows ACTIVE and owner info
- [ ] Revoked certificate shows REVOKED status
- [ ] Invalid ID shows not found error

---

# PART D — ADDITIONAL MODULES (Test Flow 21–24)

---

## Test 21 — Duplicate Attempts (Forensics)

**Steps:**
1. Open **Duplicate Attempts**
2. Review logged duplicate upload attempts
3. Confirm: uploader, original owner, filename, risk, timestamp

**Expected result:**
- [ ] Duplicate events visible after Test 4
- [ ] User IDs populated for new attempts

---

## Test 22 — Vault Integrity

**Steps:**
1. Open **Vault Integrity**
2. Run integrity check
3. Review results for missing or inconsistent files

**Expected result:**
- [ ] Check completes without error
- [ ] Results match actual vault state

---

## Test 23 — Forensic Reports

**Steps:**
1. Open **Forensic Reports**
2. Review past investigation / comparison reports
3. Search and filter reports

**Expected result:**
- [ ] Reports list loads
- [ ] Reports open with full detail

---

## Test 24 — Notifications

**Steps:**
1. Trigger a share access (open link as recipient in Test 12)
2. As owner, check **notification bell** in top bar
3. Confirm alert for link access / risk event

**Expected result:**
- [ ] Notification received within 1–2 minutes
- [ ] Mark as read works

---

# PART E — END-TO-END TEST SCENARIO (Complete Walkthrough)

**Time required:** ~45–60 minutes  
**Goal:** Prove full secure document lifecycle

| Step | Action | Pass |
|------|--------|------|
| 1 | Login with test account | [ ] |
| 2 | Generate DNA for a PDF file | [ ] |
| 3 | Confirm file in Vault + DNA Records | [ ] |
| 4 | Create share link with expiry + view limit | [ ] |
| 5 | Open link in incognito, allow GPS, view file | [ ] |
| 6 | Check File Timeline for view event | [ ] |
| 7 | Open Access Intelligence — see viewer on map | [ ] |
| 8 | Open Intelligence Report — review all sections | [ ] |
| 9 | Generate Protected Download (TEP) | [ ] |
| 10 | Issue Certificate + download PDF | [ ] |
| 11 | Verify certificate publicly | [ ] |
| 12 | Run Unified Investigation on same file (upload) | [ ] |
| 13 | Revoke share link — confirm access denied | [ ] |

---

# MODULE REFERENCE — QUICK GUIDE

| # | Module | Sidebar Location | Purpose |
|---|--------|------------------|---------|
| 1 | Dashboard | Core | System overview |
| 2 | Generate DNA | Core | Create file fingerprint |
| 3 | Vault Explorer | Explorer | Encrypted file storage |
| 4 | DNA Records | Explorer | Ownership registry |
| 5 | File Timeline | Explorer | Chain of custody |
| 6 | Access Intelligence | Intelligence | Per-link viewer tracking |
| 7 | Difference Engine | Intelligence | File change analysis |
| 8 | Monitoring & Crawler | Intelligence | Leak detection |
| 9 | Unified Investigation | Forensics | Owner recovery |
| 10 | Forensic Reports | Forensics | Report history |
| 11 | Unmask Requests | Forensics | Sensitive data approval |
| 12 | Duplicate Attempts | Forensics | Duplicate upload log |
| 13 | Vault Integrity | Forensics | Storage validation |
| 14 | Certificates | Sharing | Ownership proof |
| 15 | Verify Certificate | Sharing | Public verification |

---

# FEATURE STATUS SUMMARY (For Testers)

| Feature | Status | Tester note |
|---------|--------|-------------|
| AES-256-GCM Vault | ✅ Live | Fully testable |
| 15-Layer DNA | ✅ Live | Fully testable |
| Secure Share Links | ✅ Live | Fully testable |
| GPS + Viewer Tracking | ✅ Live | Allow location in browser |
| Activity Timeline | ✅ Live | Fully testable |
| Access Intelligence + Map | ✅ Live | Fully testable |
| Intelligence Report | ✅ Live | Fully testable |
| Protected Download / TEP | ✅ Core live | Post-download TEP tracking partial |
| Unified Investigation (upload) | ✅ Live | Use upload for reliable tests |
| Unified Investigation (scanner) | 🟡 Partial | Camera quality affects results |
| Certificates PDF/JSON | ✅ Live | Fully testable |
| Public Certificate Verify | ✅ Live | No login needed |
| Notifications | ✅ Live | Test via share access |
| Automated Web Crawler | 🟡 Pending | Manual monitoring only |
| AI Service (production) | 🟡 Pending | Requires AI hosting connection |
| Unmask Requests | 🟡 Verify | Confirm with team |
| Enterprise Admin Console | 🟡 In progress | SUPER_ADMIN only |

---

# REPORTING ISSUES

When reporting a bug during testing, include:

1. **Test number** (from this document)
2. **URL** and page name
3. **Steps** you followed
4. **Expected** vs **Actual** result
5. **Screenshot** or screen recording
6. **Browser** and device used
7. **Date and time**

Send reports to: **admin@pinit.in**

---

# GLOSSARY (Simple Terms)

| Term | Meaning |
|------|---------|
| **DNA Record** | Unique fingerprint ID for a file |
| **Vault** | Encrypted storage for the original file |
| **TEP** | Tracked Export Package — protected download |
| **Chain of Custody** | Complete history of who accessed a file and when |
| **Cosine Similarity** | AI measure of how similar two files are (0–100%) |
| **PINIT HOID** | PINIT Host Owner Identity — your user ID system |

---

**End of Document**

*PINIT-DNA — Secure Digital Vault · Forensic Tracking · Investigation Platform*
