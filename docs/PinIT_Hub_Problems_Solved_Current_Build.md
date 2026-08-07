# PinIT Hub — Problems Solved for Users

**Product:** PinIT Hub (PINIT-DNA platform)  
**Tagline:** Secure · Connect · Control  
**Document type:** User-facing problem catalog (current build phase)  
**Scope:** Capabilities implemented in the current codebase (web Hub, API, vault, share, investigation, monitoring, Publish Guardian extension, business workspace)  
**Date:** July 2026

---

## 1. Purpose of this document

This document lists the **real-world problems PinIT Hub solves for its users** based on features that exist in the **current build**, not a future roadmap.

Users include:

- Individual creators and file owners  
- Business / organization teams  
- Investigators and auditors reviewing authenticity or leaks  
- Publishers protecting content at the moment of upload (browser extension)

---

## 2. Core problems PinIT Hub solves

### 2.1 Ownership and identity of digital files

| # | Problem users face | How PinIT Hub solves it (current build) |
|---|--------------------|----------------------------------------|
| 1 | Filenames, EXIF, or “I uploaded it first” claims are weak proof of ownership | Multi-layer **DNA fingerprints** bind identity to file content (images, documents, video, audio, and other supported types) |
| 2 | Copies, crops, recompressions, or lookalike files confuse “is this mine?” | DNA **generate / verify / compare / auto-compare** and local-patch matching help identify originals vs derivatives |
| 3 | Users need a portable claim of authenticity | **Certificates** can be issued, listed, verified, and revoked against vault/DNA records |
| 4 | Duplicate or lookalike uploads waste storage and create confusion | Duplicate-attempt tracking and authenticity / similarity checks reduce silent re-uploads of the same identity |

### 2.2 Secure storage and controlled access to originals

| # | Problem users face | How PinIT Hub solves it (current build) |
|---|--------------------|----------------------------------------|
| 5 | Sensitive originals sit unprotected on local disks or chat apps | Encrypted **Vault** storage (AES-256-GCM) with tenant-scoped ownership |
| 6 | Anyone with a download can walk away with a clean copy and zero accountability | **Protected download / TEP** (Tracked Export Package) adds recipient-aware export tracking where enabled |
| 7 | Owners cannot tell if vault blobs were corrupted or lost | Vault **integrity checks** and scheduled integrity jobs |
| 8 | Hard to browse and manage protected assets at scale | Vault UI with preview, rename, retrieve, content analysis, and tracking views |

### 2.3 Safe sharing without losing visibility

| # | Problem users face | How PinIT Hub solves it (current build) |
|---|--------------------|----------------------------------------|
| 9 | Normal share links give no insight into who opened a file | **Smart Share** links with access logging |
| 10 | Shared files get forwarded and the owner loses the trail | Hop / forward-chain links and **link tree** / Access Intelligence views |
| 11 | Owners need geo and live visibility into access patterns | Share **geo analytics**, live map, and live session views (feature-gated) |
| 12 | Sensitive text must be shared carefully | Privacy **masking**, unmask requests, and owner review workflows |
| 13 | Compromised viewers keep access forever | Block viewer, force logout, revoke link |
| 14 | OTP / gated access for higher-sensitivity shares | Share OTP verify path (in-app; email SMTP delivery is not implemented in current build) |

### 2.4 Leak, tamper, and investigation problems

| # | Problem users face | How PinIT Hub solves it (current build) |
|---|--------------------|----------------------------------------|
| 15 | A leaked or found file appears online / in someone’s hands and ownership is disputed | **Unified investigation** pipeline matches probes against vault DNA and produces investigation reports |
| 16 | Two files look similar but users cannot explain what changed | **Forensic diff** between two files |
| 17 | Need structured evidence for audit / escalation | Evidence reports, incidents, signed-manifest / verify paths (where enabled) |
| 18 | Need to attribute a leaked file back toward a share/recipient path | Leak attribution forensics API/UI path |
| 19 | Forward history of a DNA identity is opaque | Forward-chain views for DNA records |

### 2.5 Continuous monitoring and publish-time protection

| # | Problem users face | How PinIT Hub solves it (current build) |
|---|--------------------|----------------------------------------|
| 20 | After publishing, owners do not know if copies reappear on the public web | **Monitoring** enrollment + crawler engine (YouTube / Bing / GitHub providers when configured) with alerts |
| 21 | Protecting content only *after* upload is too late | **Publish Guardian** Chrome extension can protect at publish/capture time and register **protected posts** |
| 22 | Assets need a lifecycle beyond a single upload | Universal **Asset** protect/list/status flow alongside protected posts |

### 2.6 Account, identity, and team operations

| # | Problem users face | How PinIT Hub solves it (current build) |
|---|--------------------|----------------------------------------|
| 23 | Password-only or shared-login accounts are weak for high-value vaults | **ShortId** identity plus **face biometric** register/login (with encryption of biometric templates) |
| 24 | Individuals and businesses need different operating modes | Account-type onboarding: **Individual** vs **Business** workspace |
| 25 | Teams need shared org context without sharing one personal login | Organization setup, members, invites, roles, departments, workspaces |
| 26 | Businesses need auditability of who did what | Organization audit logs and platform activity views |
| 27 | Integrations and automation hooks are needed for ops | Org API keys, webhooks, and integration connection/test endpoints (Slack/Teams/Zapier/Dropbox/Google Drive config paths) |
| 28 | Users need timely awareness of security/account events | In-app **notifications** + realtime SSE stream |

### 2.7 Commercial access and product clarity

| # | Problem users face | How PinIT Hub solves it (current build) |
|---|--------------------|----------------------------------------|
| 29 | Advanced features must be gated fairly for free vs paid users | Subscription plans, entitlements, usage quotas, Razorpay billing (and mock billing path for testing) |
| 30 | Users need one Hub for protect → store → share → monitor → investigate | Unified PinIT Hub web app with dashboards for vault, DNA, shares, monitoring, investigation, certificates, business ops, and admin/super-admin consoles |

---

## 3. Problems grouped by user persona

### Individual creator / file owner
- Prove “this file is mine” beyond filename  
- Keep originals encrypted in a personal vault  
- Share with tracking and revoke when needed  
- Investigate a leaked copy against their vault  
- Protect posts while publishing via the extension  

### Business / organization
- Separate business workspace from personal mode  
- Invite teammates with roles  
- Audit org activity  
- Use API keys / webhooks for workflow hooks  
- Apply subscription limits and upgrade paths  

### Investigator / auditor
- Run unified investigation on a probe file  
- Compare two files forensically  
- Review certificates and evidence artifacts  
- Trace share access and forward chains  

### Publisher (extension user)
- Capture/protect during platform publish flows  
- Sync protected post state back to Hub  
- Reduce unprotected uploads slipping through  

---

## 4. Explicit non-goals / not solved yet (current build)

Documented honestly so stakeholders do not over-claim:

| Area | Status in current build |
|------|-------------------------|
| SMTP email delivery of share OTPs / alerts | Not implemented |
| Continuous tracking of a file *after* it leaves the browser onto a recipient device | Not implemented (viewer/share events only) |
| Fully automatic internet-wide leak search without enrollment/config | Limited to monitoring/crawler paths when enabled and keyed |
| Native Android / Capacitor app as primary product | Not present in current web-focused tree after web-only restore |
| Dedicated Redis-backed queues / multi-region HA productization | Not implemented as productized infra |

---

## 5. One-line summary

**PinIT Hub solves the problem of unprotected digital life-cycles:** it helps users **identify**, **encrypt**, **share with accountability**, **monitor**, and **investigate** their files—so ownership and control do not disappear the moment a file is copied, forwarded, or republished.

---

## 6. Reference (implementation anchors)

| Capability | Primary implementation areas |
|------------|------------------------------|
| DNA | `src/services/layers`, `src/services/engines`, `/api/v1/dna` |
| Vault | `src/services/vault`, `/api/v1/vault` |
| Smart Share | `src/services/share`, `/api/v1/share`, `/s/:token` |
| Investigation | `src/services/forensics`, `/api/v1/forensics` |
| Monitoring | `src/services/crawler`, `/api/v1/monitor` |
| Publish Guardian | `extension/`, `/api/v1/extension/*`, `/api/v1/posts` |
| Business org | `src/services/organization`, `/api/v1/organization` |
| Auth | `/api/v1/auth`, biometric services |
| Architecture docs | `docs/architecture/01_Project_Overview.md` … `15_Tech_Stack.md` |
