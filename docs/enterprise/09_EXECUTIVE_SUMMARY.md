# PINIT-DNA — Executive Summary

**Document version:** 1.0  
**Audience:** Management and enterprise stakeholders  
**Date:** July 2026

---

## 1. Problem

Organisations need to prove that a digital file:

- Originated from a specific owner and vault  
- Was not altered without detection  
- Has a documented chain of custody from creation to investigation  

Traditional checksums and metadata are insufficient because they break after compression, cropping, screenshotting, or re-encoding. Legal and forensic teams need a deterministic, auditable system that survives file transformation.

---

## 2. Solution

**PINIT-DNA** is a universal forensic identity platform that assigns every supported file a **15-layer DNA fingerprint** at generation time. The DNA is immutable. Lifecycle events (encryption, vault storage, download, share, investigation) are recorded in a separate append-only provenance system.

When a suspect file is found — on the internet, in email, or on a device — it can be uploaded to **Unified Investigation**. The system searches the owner's vault, ranks candidates, runs deep DNA comparison, and returns an authoritative verdict through the **Acceptance Engine**.

---

## 3. Architecture (High Level)

```
User / Analyst
      |
      v
Web Application (React + Vite on Vercel)
      |
      v
API Server (Node.js + Express on Render)
      |
      +---> DNA Engine (15 layers, 10 file types)
      +---> Vault (AES-256-GCM + Supabase Storage)
      +---> Investigation Pipeline
      +---> TEP / Protected Download
      +---> Forensic Provenance (append-only events)
      |
      v
Database (PostgreSQL on Supabase)
```

---

## 4. Current Status

| Area | Status |
|------|--------|
| 15-layer DNA generation | Implemented — all 10 file types LIVE |
| Vault encryption and storage | Implemented |
| Certificate issuance | Implemented |
| Unified Investigation | Implemented |
| Acceptance Engine (5 verdicts) | Implemented |
| Candidate Ranking Engine | Implemented |
| TEP Protected Download | Implemented |
| Forensic provenance / chain of custody | Implemented (partial event coverage) |
| Tracking Dashboard | Implemented |
| Biometric login (face/voice/fingerprint) | Implemented |
| Smart Links (share with access logs) | Implemented |
| Monitoring / Crawler | Implemented |
| Semantic AI search | Implemented |
| Native mobile/desktop apps | Not Yet Implemented |
| Post-download continuous tracking | Not Yet Implemented |

---

## 5. Completed Modules

| Module | Description |
|--------|-------------|
| Universal File Router | Routes 10 file types to DNA engines |
| DNA Orchestrator | Image 15-layer pipeline |
| Universal Engines | TXT, CSV, JSON, PDF, DOCX, PPTX, ZIP, VIDEO, AUDIO |
| Vault Service | Encrypt, store, retrieve, protected download |
| Certificate Service | Issue, verify, revoke certificates |
| TEP Service | Tracked export packages v3.0 |
| Unified Investigation Orchestrator | End-to-end forensic pipeline |
| Acceptance Engine | Sole verdict authority |
| Candidate Ranking Engine | Multi-stage candidate funnel |
| Investigation Manifest | Immutable sealed report contract |
| Forensic Provenance Service | Append-only lifecycle events |
| Comparison Engine | L1–L6 scoring with derivative-aware logic |
| Biometric Auth | Face, voice, fingerprint fusion login |
| Share Links | Smart links with viewer tracking |
| Monitoring | URL watch and crawl alerts |

---

## 6. Modules Under Development / Partial

| Module | Gap |
|--------|-----|
| Provenance events | FORWARDED, RECOVERED, CRAWLER_DETECTION not yet appended |
| TEP expiry enforcement | Stored but not checked at extraction |
| Revoked TEP blocking | Status in DB; file still matches on re-upload |
| Video/audio engines | Baseline fingerprints; advanced algorithms planned |
| L11 deepfake | Heuristic only; ML model planned |
| Native viewer | Planned for post-download control |
| Prisma migrate on legacy DB | Workaround script in production start |

---

## 7. Next Milestones

| Milestone | Description | Priority |
|-----------|-------------|----------|
| Production deployment alignment | Single backend URL + Supabase DATABASE_URL on Render | High |
| Vercel env synchronisation | VITE_API_BASE_URL matches live Render service | High |
| Complete provenance event coverage | Live append for share revoke, cert revoke, crawler | Medium |
| TEP expiry + revoked blocking | Enforce at extraction time | Medium |
| Investigation stability | Deterministic results for same input | Medium |
| Native PINIT Viewer | Controlled open + OPENED events | Future |
| ML deepfake layer | Replace L11 heuristics | Future |
| Enterprise PDF documentation | This document set | Current |

---

## 8. Key Metrics (System Capabilities)

| Metric | Value |
|--------|-------|
| Supported file types | 10 (all LIVE) |
| DNA layers | 15 |
| Investigation verdicts | 5 (Acceptance Engine) |
| Evidence channels in scorecard | 7 |
| Tamper detectors | 19 |
| Provenance event types declared | 15 |
| Provenance event types actively appended | 10 |

---

## 9. Deployment

| Component | Platform |
|-----------|----------|
| Frontend | Vercel — https://pinit-dna.vercel.app |
| Backend API | Render — https://pinit-dna-uf5y.onrender.com |
| Database | Supabase PostgreSQL |
| File storage | Supabase Storage (vault-files bucket) |
| Python AI (optional) | Local sidecar / external URL in production |

---

## 10. Honest Capability Statement

**PINIT-DNA can reliably prove:**

> "This file matches Vault X, DNA Record Y, owned by User Z, was exported via Protected Download at time T, and shows tamper vectors A, B, C compared to the original."

**PINIT-DNA cannot currently prove:**

> "This file was forwarded on WhatsApp to Person Q and opened at Location R without the file being uploaded back into PINIT."

Post-download tracking requires either file recovery via Investigation or a future PINIT-controlled native viewer.

---

*End of document*
