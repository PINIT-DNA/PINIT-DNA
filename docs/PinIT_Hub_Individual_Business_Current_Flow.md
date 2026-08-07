# PinIT Hub — Current Application
## Individual Users & Business Users: Flows, Challenges & Solutions

**Product:** PinIT Hub  
**Document type:** Current-build product narrative (not Exchange marketplace)  
**Scope:** What is implemented today for Individual and Business account types  
**Date:** July 2026  
**Style note:** Black-and-white document for print / stakeholder sharing  

---

## 1. Executive view

PinIT Hub is built around one idea:

**Digital files lose control the moment they are copied, forwarded, or republished.**

Until the current build phase, the application helps two kinds of operators:

| Operator | Who they are | What Hub optimizes for |
|----------|--------------|------------------------|
| **Individual** | Creators, freelancers, professionals acting alone | Personal ownership, private vault, trackable sharing, investigation |
| **Business** | Teams and organizations | Same protection stack **plus** shared workspace, roles, audit, and ops controls |

The product does **not** stop at “upload a file.” It covers a fuller life cycle:

**Identify → Protect → Store → Share with accountability → Monitor → Investigate → Prove (certificates) → Operate as a person or as a company.**

---

## 2. Who the product is for today

### 2.1 Individual users

People who own valuable media or documents and need personal control:

- Photographers, designers, writers, consultants  
- Anyone who shares sensitive files and later needs to know who opened them  
- Anyone who must prove “this file is mine” after a leak or dispute  

**Home in the app:** Personal dashboard (`/`)

### 2.2 Business users

Teams that cannot rely on one shared personal login:

- Agencies, studios, legal/media ops, internal brand teams  
- Managers who need invites, roles, and audit trails  
- Companies that need API/webhooks/integrations as they grow (Enterprise-gated)

**Home in the app:** Business dashboard (`/business`)

### 2.3 Greater beyond “one user uploading”

The current build already stretches beyond a single-person tool:

| Layer | Individual value | Business / organizational value |
|-------|------------------|----------------------------------|
| Identity | ShortId + face biometric for the person | Org identity + member roles under one company |
| Asset control | Personal vault & DNA | Same vault capabilities under business operating mode |
| Sharing | Trackable links for one owner | Same share stack available to business operators; team can work in one org context |
| Investigation | Owner investigates leaks against their vault | Business can treat investigation as an ops function across protected assets |
| Continuity | Protect → share → monitor → report alone | Protect → share → monitor → report **with** team, audit, and (on Enterprise) API/integrations |
| Growth | Free / Pro plans | Free / Pro / Enterprise with team and workspace limits that scale |

---

## 3. Current application flow (end-to-end)

### 3.1 Entry and account type

1. User arrives at login / register  
2. Chooses **Individual** or **Business** (pre-register and/or onboarding)  
3. Completes registration (including face biometric path where used)  
4. Logs in with PinIT ShortId and/or face  
5. If account type missing → onboarding forces selection  
6. App opens the correct home shell  

```
Register / Login
      │
      ▼
Choose account type: INDIVIDUAL or BUSINESS
      │
      ├─────────────── Individual ───────────────┐
      │                                          │
      ▼                                          ▼
Personal dashboard                         Business dashboard
Protect · Vault · Share                    Org setup · Team · Ops
Investigate · Monitor                      + same protect stack
Certificates · Plans                       + audit / API (by plan)
```

### 3.2 Core protection flow (both Individual and Business)

This is the heart of the current build:

1. **Protect / Generate DNA** — upload media or documents; system builds multi-layer DNA identity  
2. **Store in Vault** — encrypt original (AES vault); owner-scoped retrieval  
3. **Optional certificate** — issue / verify authenticity claims  
4. **Smart Share** — create trackable link; recipient opens public share viewer  
5. **Access Intelligence** — owner sees opens, forwards/hops, geo/session views (as enabled)  
6. **Monitor** — enroll for web discovery alerts (when crawler/providers configured)  
7. **Investigate** — upload a probe / leaked file; match against vault DNA; produce report  
8. **Publish Guardian (extension)** — protect around publish time; register protected posts  

### 3.3 Individual operating flow (current)

| Step | What the user does in Hub |
|------|---------------------------|
| 1 | Register as Individual → land on personal dashboard |
| 2 | Protect a file → DNA created |
| 3 | Vault holds encrypted original |
| 4 | Share via Smart Link when needed |
| 5 | Review Access Intelligence / unmask requests |
| 6 | Monitor assets / protected posts |
| 7 | Run investigation if something looks leaked or tampered |
| 8 | Manage certificates and subscription (Free / Pro) |
| 9 | Profile: security (face), notifications, activity |

### 3.4 Business operating flow (current)

| Step | What the organization does in Hub |
|------|-----------------------------------|
| 1 | Register as Business → land on `/business` |
| 2 | Complete Business Setup Wizard (org name, industry, country, workspace, optional logo) |
| 3 | Use the **same** protect / vault / share / investigate / monitor stack |
| 4 | Invite teammates; assign roles (Owner, Manager, Investigator, Member, Viewer) |
| 5 | Work across default workspace; create more within plan limits |
| 6 | On Enterprise: departments, API keys, audit logs, integrations/webhooks |
| 7 | Toggle Individual vs Business view when allowed (business account / Enterprise) |
| 8 | Manage org profile, billing summary, and subscription (Free / Pro / Enterprise) |

---

## 4. Challenges vs Solutions (current build)

### 4.1 Universal challenges (Individual and Business)

| # | Challenge in the real world | Solution in PinIT Hub today |
|---|----------------------------|-----------------------------|
| 1 | Filenames and EXIF are weak ownership proof | Multi-layer DNA fingerprints bound to content |
| 2 | Originals live in chat apps and drives with no control | Encrypted vault with owner-scoped retrieve |
| 3 | Downloads walk away with zero accountability | Protected download / tracked export paths (TEP-style) where enabled |
| 4 | Normal share links are blind | Smart Share with access logging |
| 5 | Files get forwarded; trail is lost | Hop / forward-chain and link tree / Access Intelligence |
| 6 | Sensitive content must be shared carefully | Masking + unmask request and owner review |
| 7 | A leaked copy appears; authorship is disputed | Unified investigation against vault DNA + forensic reports |
| 8 | Two files look similar; changes are unclear | Forensic diff |
| 9 | Copies may reappear on the public web | Monitoring enrollment + crawler paths (when enabled/keyed) |
| 10 | Protection after upload is often too late | Publish Guardian browser extension + protected posts |
| 11 | Weak account security for valuable vaults | ShortId identity + face biometric login/register |
| 12 | Free vs paid access must be fair | Plans, storage/asset quotas, Razorpay billing |

### 4.2 Individual-specific challenges vs solutions

| # | Individual challenge | Hub solution today |
|---|----------------------|--------------------|
| 13 | “I work alone — I still need enterprise-grade proof” | Full DNA → vault → share → investigate path on Individual Free/Pro |
| 14 | Hard to manage personal protected library | Personal dashboard, vault UI, DNA records, certificates |
| 15 | Need to upgrade storage / limits without changing identity | Pro plan for individuals |
| 16 | Want biometric convenience without sharing passwords | Face register / login tied to PinIT ID |

### 4.3 Business-specific challenges vs solutions

| # | Business challenge | Hub solution today |
|---|--------------------|--------------------|
| 17 | Company cannot share one personal PinIT login | Business account type + organization workspace |
| 18 | Different people need different powers | Org roles: Owner / Manager / Investigator / Member / Viewer |
| 19 | Onboarding a company is messy | Business Setup Wizard on business dashboard |
| 20 | Need visibility of org activity | Business dashboard snapshots + activity; audit logs (Enterprise) |
| 21 | Team growth must be controlled on Free | Team and workspace limits on Business Free; scale on Pro/Enterprise |
| 22 | Ops need automation hooks | API keys, webhooks, Slack/Teams/Zapier/Dropbox/Google Drive connection paths (Enterprise) |
| 23 | Departments matter at larger scale | Departments module when plan is Enterprise |
| 24 | Leaders need company shell and personal shell | Account view mode switch (Individual vs Business) where allowed |

### 4.4 Greater organizational challenges Hub begins to solve

These go beyond “a person uploaded a photo”:

| # | Broader challenge | How current Hub addresses it |
|---|-------------------|------------------------------|
| 25 | Creative and legal risk when assets leave the building | Protect + trackable share + investigation as one system |
| 26 | Brand / agency work needs an ops home, not only a vault | Business dashboard and org profile hub |
| 27 | Investigations become a team function | Investigator role + shared business operating mode |
| 28 | Leadership wants auditability | Organization audit logs (Enterprise) |
| 29 | Product must grow from solo creator → company without a rewrite | Same core APIs; account type + plan gates expand surface |
| 30 | Publish surfaces (YouTube etc.) leak unprotected uploads | Extension protect path into Hub assets / protected posts |

---

## 5. Side-by-side: Individual vs Business (current)

| Dimension | Individual | Business |
|-----------|------------|----------|
| Account type | INDIVIDUAL | BUSINESS |
| Default home | Personal dashboard | Business dashboard |
| Setup | Account type onboarding | Org setup wizard + workspace |
| Core protect stack | Yes | Yes (same product engine) |
| Team invites / roles | No org team model | Yes |
| Workspaces | Personal context | Org workspaces (capped on Free) |
| Departments | No | Enterprise |
| API keys / webhooks / integrations | Not the business ops focus | Enterprise-gated |
| Audit logs | Personal activity/profile | Org audit (Enterprise) |
| Plans | Free, Pro | Free, Pro, Enterprise |
| View switch | N/A (personal shell) | Can switch to Individual view when allowed |

---

## 6. Subscription reality (current code)

| Plan | Typical intent | Notable limits / unlocks |
|------|----------------|--------------------------|
| Free | Start protecting | Asset count + storage caps; Business Free also caps team & workspaces |
| Pro | Power users / growing use | Higher / unlimited assets path + larger storage |
| Enterprise | Organizations | Unlimited team/workspaces emphasis; API access, enterprise teams, extension-oriented entitlements, advanced ops tabs |

Pricing in code (indicative): Free ₹0 · Pro ₹999/mo · Enterprise ₹4999/mo (Razorpay).

---

## 7. Honest limits of the current phase

Do not over-claim these as solved:

| Topic | Current status |
|-------|----------------|
| Email delivery of OTP / alerts (SMTP) | Not implemented — OTP shown in product UI |
| PinIT Exchange marketplace (buy/sell licenses) | Not part of current Hub shipping surface |
| Full marketplace / bulk-upload product UIs | Feature keys exist on Enterprise; not full product journeys |
| Continuous tracking after file leaves the browser onto a device | Not implemented |
| Native mobile app as primary product | Web Hub is the current product |

---

## 8. Closing statement

**For individuals,** PinIT Hub is a private command center: prove ownership, encrypt originals, share with eyes open, monitor, and investigate.

**For businesses,** PinIT Hub is the same protection engine lifted into an organization: roles, workspaces, audit, and enterprise ops — so control does not collapse when more than one person must handle the company’s digital assets.

That is the current build’s promise: from a single user protecting one file, to a business operating a protected asset practice — without abandoning the DNA → vault → share → monitor → investigate spine.

---

## Document control

| Field | Value |
|-------|-------|
| Product | PinIT Hub |
| Audience | Founders, product, business stakeholders, onboarding partners |
| Basis | Current implemented application (routes, services, plans) |
| Out of scope | Exchange creator/buyer marketplace segment sales playbook |
