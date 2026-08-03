# PINIT-DNA
## Complete User Test Flow & Application Guide

**Document Type:** User Test Flow / Product Walkthrough  
**Version:** 1.1  
**Date:** 3 August 2026  
**Prepared for:** New users, testers, and stakeholders  
**Live Application:** https://dna-pinit-web.vercel.app  
**Repository:** ashwitha2004/DNA-PINIT-WEB (branch: ashwitha)  
**Update note:** v1.1 adds **Business Account** walkthrough (Part F). Earlier tests covered Individual / core Hub before Business was built.

---

## Purpose of This Document

This document helps a **new user** understand and **test the full PINIT-DNA application** from login to forensic investigation — including both **Individual** and **Business** account paths. Each section explains **what the module does**, **how to use it**, and **what result to expect**.

Use this when:
- Onboarding a new tester or reviewer
- Demonstrating the product to management
- Validating that all modules work end-to-end
- Walking through the **Business / Organization** shell (dashboard, setup, team, ops)

---

## Before You Start

| Item | Detail |
|------|--------|
| **URL** | https://dna-pinit-web.vercel.app |
| **Browser** | Chrome or Edge (latest) recommended |
| **Location** | Allow GPS when prompted (required for share viewing) |
| **Camera / Mic** | Needed only if testing biometric login or scanner |
| **Test account (Individual)** | Credentials provided by the PINIT team |
| **Test account (Business)** | A **Business** account (or Enterprise plan) — required for Part F |
| **Second tester (optional)** | Another PinIT User ID to invite as a team member |

**Tip:** First API call after idle may take 30–60 seconds (server wake-up). Refresh once if a page loads empty.

**Account types:**
| Type | Default home after login | Sidebar |
|------|--------------------------|---------|
| **Individual** | Personal Dashboard (`/`) | Core / Explorer / Intelligence / Forensics groups |
| **Business** | Business Dashboard (`/business`) | Flat **Organization** nav (Protect, Digital Assets, Team, etc.) |

Use the top **Individual | Business** switcher (when available) to move between personal and organization shells.

---

## Application Overview

PINIT-DNA (PinIT Hub) is a **secure digital vault and forensic platform**. It protects files with DNA fingerprinting, encryption, tracked sharing, and investigation tools — for a solo owner **or** a company team.

```
Login → Choose / open account shell
          │
          ├─ Individual → Personal Dashboard → Generate DNA → Vault → Share → Tracking
          │                                                      ↓
          │                              Timeline → Intelligence → Investigation → Certificates
          │
          └─ Business → Business Dashboard → Org Setup → Team → same Protect / Vault / Investigate stack
                              ↓
                    Org Profile · Audit · API (Enterprise) · Workspaces
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

# PART F — BUSINESS ACCOUNT WALKTHROUGH (Test Flow 25–33)

> **Why this part exists:** Tests 1–24 covered the core Individual / forensic Hub **before** Business account was built. Part F walks through the **organization shell**: business dashboard, setup wizard, team, profile, and the same protect stack from a company view.

**Prerequisite:** Log in with a **Business** account (account type = BUSINESS), **or** an Individual account on **Enterprise** that can switch into Business view.

**Time required:** ~25–40 minutes

**Problem this part proves:** A company cannot share one personal PinIT login. PinIT Hub gives a Business workspace with roles, team invites, and ops visibility — while keeping the same DNA → Vault → Share → Investigate engine.

---

## Test 25 — Enter Business Shell (Login / Switch)

**Module:** Account type + Individual | Business switcher

**What it does:** Opens the organization operating mode instead of the personal dashboard.

**Steps:**
1. Log in with the **Business** test account
2. Confirm you land on **Business Dashboard** (`/business`) — not only the personal home
3. If you see the top **Individual | Business** switcher:
   - Click **Individual** → personal dashboard should open
   - Click **Business** → return to `/business`
4. Confirm sidebar shows the **Organization** nav (Dashboard, Protect file, Digital Assets, Team, etc.)

**Expected result:**
- [ ] Business home is `/business`
- [ ] Switcher works when available (Business ↔ Individual)
- [ ] Organization sidebar labels appear (not only Individual groups)

**Record tip (voice):** “Problem: teams need a company shell. Solution: Business dashboard and organization navigation.”

---

## Test 26 — Business Dashboard Overview

**Module:** Business Dashboard (`/business`)

**What it does:** Organization operations home — org name, workspace, snapshots for vault, investigation, monitoring, certificates, team, activity, and quick actions.

**Steps:**
1. Stay on `/business`
2. Note **organization name** and **workspace** label in the header
3. Review ops snapshot panels (as shown): vault / assets, investigation, monitoring, reports, certificates, team
4. Open **Live activity / alerts / notifications** panels if visible
5. Use a **Quick Action** (e.g. Protect file or Digital Assets) and confirm it opens the correct page
6. Return to `/business`

**Expected result:**
- [ ] Dashboard loads without blank/error state
- [ ] Org name and workspace are visible (or clear placeholders)
- [ ] Snapshot / quick-action links navigate correctly

---

## Test 27 — Business Setup Wizard (Organization Onboarding)

**Module:** Business Setup Wizard

**What it does:** Creates / completes the organization profile (name required; industry, country, workspace, optional logo).

**Steps:**
1. On Business Dashboard, if **Welcome** card is shown → click **Start Setup**
2. If welcome was skipped earlier, open **Organization Profile** (`/profile`) and use setup / edit org fields instead
3. In the wizard:
   - **Step 1 — Organization Information:** enter Organization Name (required, min 2 characters); set industry / country if available
   - **Step 2 — Workspace:** keep or rename **Main Workspace** (or your test name)
   - **Step 3 — Logo:** optional — upload a small PNG/JPG or skip
   - **Step 4 — Finish:** review and complete
4. Confirm success toast / welcome card dismisses
5. Confirm org name updates on the Business Dashboard header

**Expected result:**
- [ ] Organization name saves successfully
- [ ] Default workspace exists
- [ ] Dashboard shows the new org name
- [ ] Setup can be completed without errors

**Note:** If setup was already completed on this account, re-open **Organization Profile** and edit name/industry/country, then save — still mark the “org profile editable” path as tested.

---

## Test 28 — Organization Profile Hub

**Module:** Organization Profile (`/profile` in Business shell)

**What it does:** Central place for org details, contact, workspace, subscription, security, activity, team, and (by plan) departments / audit / API / integrations / billing.

**Steps:**
1. From sidebar open **Organization Profile**
2. Walk through available tabs (open each that appears):
   - Organization / Contact / Workspace
   - Subscription / Billing (plan, limits, upgrade path)
   - Security / Settings / Activity
   - Team (can skip deep invite until Test 29)
3. Edit one safe field (e.g. country or bio) and **Save** if Save bar appears
4. Confirm org **short ID** / identity is visible where shown

**Expected result:**
- [ ] Profile hub loads with organization context
- [ ] Key tabs open without crash
- [ ] Save (if used) succeeds
- [ ] Subscription / plan info visible

---

## Test 29 — Team Invite & Roles

**Module:** Team (`/profile?tab=team` or `/business/team`)

**What it does:** Invite teammates by PinIT ID (and optional email); assign roles: Owner, Manager, Investigator, Member, Viewer.

**Steps:**
1. Open **Team** from the Business sidebar
2. Review **Team overview** (member count / limit, pending invites)
3. Invite a second test user:
   - Enter their **PINIT ID** (e.g. `PINIT-XXXXXX`)
   - Optional email
   - Choose role: **MEMBER** or **VIEWER** for a safe first invite
   - Submit invite
4. Confirm invite appears under pending invites (or member list if auto-accepted in your environment)
5. If you have permission, try **change role** on a non-owner member
6. Do **not** remove the Owner account

**Expected result:**
- [ ] Team page loads
- [ ] Invite accepts PinIT ID (or shows a clear validation error if ID invalid)
- [ ] Pending invite or member row appears
- [ ] Role labels are clear (OWNER / MANAGER / INVESTIGATOR / MEMBER / VIEWER)
- [ ] Team limit respects plan (Free may block extra seats)

**If blocked by plan:** Mark **Blocked — team limit** and still record the limit message on video.

---

## Test 30 — Protect Stack Inside Business Shell

**Module:** Same core engine, Business sidebar labels

**What it does:** Proves Business mode still runs DNA → Vault → Investigate — not a separate weak product.

**Steps:**
1. From Business sidebar click **Protect file** (`/generate`)
2. Upload a small test PDF or JPG
3. Generate DNA — wait for COMPLETE / PARTIAL
4. Open **Digital Assets** (`/vault`) — confirm file appears
5. Optional: create a short share link and open in Incognito (same as Test 10–12, abbreviated)
6. Open **Unified Investigation** — upload the same file (or a copy) and confirm pipeline starts
7. Open **Certificates** — confirm list / issue path still works from Business shell

**Expected result:**
- [ ] Protect / DNA works while in Business view
- [ ] File appears in Digital Assets (Vault)
- [ ] Investigation and Certificates reachable from Business nav
- [ ] No “wrong shell” blank pages

**Record tip:** “Business is the same protection engine — with an organization home around it.”

---

## Test 31 — Monitoring, Assets & Protected Posts (Business)

**Module:** Monitoring · Assets · Protected Posts

**Steps:**
1. Open **Monitoring** — confirm page loads; run a check if button available
2. Open **Assets** — confirm list/empty state loads
3. Open **Protected Posts** — confirm list/empty state loads
4. Return to Business Dashboard

**Expected result:**
- [ ] All three pages open without error
- [ ] Empty states are acceptable if no data yet
- [ ] Navigation back to `/business` works

**Status note:** Full automated crawler may be partial (same as Test 17). Still verify the Business entry points.

---

## Test 32 — Audit Logs & API Access (Enterprise-gated)

**Module:** Audit Logs · API Access · Integrations / Departments (if visible)

**What it does:** Enterprise ops — who did what, API keys, integrations, departments.

**Steps:**
1. Open **Audit Logs** from Business sidebar (`/profile?tab=audit`)
2. If Enterprise: review recent org events; confirm list or empty state
3. Open **API Access** (`/profile?tab=api`)
4. If gated: confirm upgrade / feature lock message is clear
5. If unlocked: view keys list; **do not** paste secret keys into chat or leave them on screen in shared videos
6. Optionally open Departments / Integrations tabs if shown

**Expected result:**
- [ ] Audit and API pages open (or show clear plan gate)
- [ ] No crash / infinite spinner
- [ ] Secrets are not exposed in recordings

**Tester note:** On Business Free / Pro, marking “feature gated correctly” is a **Pass** for this test.

---

## Test 33 — Business End-to-End Mini Scenario

**Time required:** ~15–20 minutes  
**Goal:** Prove company onboarding + protect path in one continuous walkthrough

| Step | Action | Pass |
|------|--------|------|
| 1 | Login as Business → land on `/business` | [ ] |
| 2 | Complete or confirm Organization Setup (name + workspace) | [ ] |
| 3 | Open Organization Profile — confirm org identity | [ ] |
| 4 | Open Team — invite (or show invite form + limits) | [ ] |
| 5 | Protect a file → DNA complete | [ ] |
| 6 | Confirm file in Digital Assets | [ ] |
| 7 | Open Unified Investigation on that file | [ ] |
| 8 | Return to Business Dashboard — snapshots look sane | [ ] |
| 9 | Switch to Individual view (if switcher available) then back to Business | [ ] |

**Video name suggestion:** `PINIT_Test33_BusinessE2E_YYYY-MM-DD.mp4`  
**Proud line to say:** “PinIT Hub for business: organization home, team roles, and the same DNA vault protection stack.”

---

# MODULE REFERENCE — QUICK GUIDE

| # | Module | Sidebar Location | Purpose |
|---|--------|------------------|---------|
| 1 | Dashboard | Core (Individual) | Personal system overview |
| 2 | Business Dashboard | Organization → Dashboard | Company ops home (`/business`) |
| 3 | Generate DNA / Protect file | Core / Organization | Create file fingerprint |
| 4 | Vault / Digital Assets | Explorer / Organization | Encrypted file storage |
| 5 | DNA Records | Explorer | Ownership registry |
| 6 | File Timeline | Explorer | Chain of custody |
| 7 | Access Intelligence | Intelligence | Per-link viewer tracking |
| 8 | Difference Engine | Intelligence | File change analysis |
| 9 | Monitoring & Crawler | Intelligence / Organization | Leak detection |
| 10 | Unified Investigation | Forensics / Organization | Owner recovery |
| 11 | Forensic Reports | Forensics / Organization | Report history |
| 12 | Unmask Requests | Forensics | Sensitive data approval |
| 13 | Duplicate Attempts | Forensics | Duplicate upload log |
| 14 | Vault Integrity | Forensics | Storage validation |
| 15 | Certificates | Sharing / Organization | Ownership proof |
| 16 | Verify Certificate | Sharing | Public verification |
| 17 | Team | Organization → Team | Invites and roles |
| 18 | Organization Profile | Organization → Profile | Org details, plan, settings |
| 19 | Audit Logs | Organization → Audit | Org activity (Enterprise) |
| 20 | API Access | Organization → API | Keys / automation (Enterprise) |

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
| **Business account type** | ✅ Live | Part F — Tests 25–33 |
| **Business Dashboard** | ✅ Live | `/business` |
| **Business Setup Wizard** | ✅ Live | Org name + workspace |
| **Team invites & roles** | ✅ Live | Plan seat limits apply |
| **Individual \| Business switcher** | ✅ Live | Business account or Enterprise |
| **Org Audit / API / Integrations** | 🟡 Plan-gated | Full on Enterprise; Free/Pro show gates |
| Automated Web Crawler | 🟡 Pending | Manual monitoring only |
| AI Service (production) | 🟡 Pending | Requires AI hosting connection |
| Unmask Requests | 🟡 Verify | Confirm with team |
| Enterprise Admin Console | 🟡 In progress | SUPER_ADMIN only |

---

# REPORTING ISSUES

When reporting a bug during testing, include:

1. **Test number** (from this document)
2. **URL** and page name
3. **Account type** (Individual / Business) and plan if known
4. **Steps** you followed
5. **Expected** vs **Actual** result
6. **Screenshot** or screen recording
7. **Browser** and device used
8. **Date and time**

Send reports to: **admin@pinit.in**

---

# GLOSSARY (Simple Terms)

| Term | Meaning |
|------|---------|
| **DNA Record** | Unique fingerprint ID for a file |
| **Vault / Digital Assets** | Encrypted storage for the original file |
| **TEP** | Tracked Export Package — protected download |
| **Chain of Custody** | Complete history of who accessed a file and when |
| **Cosine Similarity** | AI measure of how similar two files are (0–100%) |
| **PINIT HOID** | PINIT Host Owner Identity — your user ID system |
| **Individual account** | Personal Hub shell — solo owner workflow |
| **Business account** | Organization shell — company dashboard, team, org profile |
| **Workspace** | Named work area inside an organization (e.g. Main Workspace) |
| **Org role** | OWNER / MANAGER / INVESTIGATOR / MEMBER / VIEWER |

---

**End of Document**

*PINIT-DNA — Secure Digital Vault · Forensic Tracking · Investigation Platform · Individual & Business*

