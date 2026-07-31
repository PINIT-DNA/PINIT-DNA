# PinIT Hub (PINIT-DNA) — Complete Project Documentation & Onboarding Guide

**Document Type:** Team Onboarding / Project Handbook  
**Version:** 1.0  
**Date:** July 29, 2026  
**Audience:** New team members, developers, testers, and stakeholders  
**Repository:** [ashwitha2004/DNA-PINIT-WEB](https://github.com/ashwitha2004/DNA-PINIT-WEB) (branch: `main`)

---

## Table of Contents

1. [Welcome](#1-welcome)
2. [Mission, Vision & Motto](#2-mission-vision--motto)
3. [What Is This Project?](#3-what-is-this-project)
4. [The Problem We Solve](#4-the-problem-we-solve)
5. [Complete Tech Stack](#5-complete-tech-stack)
6. [System Architecture](#6-system-architecture)
7. [Project Structure](#7-project-structure)
8. [Completed Implementations](#8-completed-implementations)
9. [Partial / In-Progress Work](#9-partial--in-progress-work)
10. [Core Workflows (How It Works)](#10-core-workflows-how-it-works)
11. [Practical Development Guide](#11-practical-development-guide)
12. [Deployment & Production URLs](#12-deployment--production-urls)
13. [Key Files Every Developer Should Know](#13-key-files-every-developer-should-know)
14. [API Overview](#14-api-overview)
15. [Database Models](#15-database-models)
16. [Chrome Extension (Publish Guardian)](#16-chrome-extension-publish-guardian)
17. [Testing the Application End-to-End](#17-testing-the-application-end-to-end)
18. [Development Rules & Conventions](#18-development-rules--conventions)
19. [Reference Documentation Index](#19-reference-documentation-index)
20. [Quick Reference Card](#20-quick-reference-card)

---

## 1. Welcome

Welcome to **PinIT Hub** (internally also called **PINIT-DNA**). This document is your single entry point to understand what we built, why we built it, how it works in practice, and how to start contributing.

After reading this guide and following the hands-on sections, you should be able to:

- Explain the product to a non-technical stakeholder
- Run the full stack locally
- Walk through every major user flow
- Know which modules are production-ready vs. in progress
- Navigate the codebase confidently

---

## 2. Mission, Vision & Motto

### Brand Identity

| Field | Value |
|-------|-------|
| **Product Name** | PinIT Hub |
| **Tagline / Motto** | **Secure · Connect · Control** |
| **Version** | v2.0 · Universal |
| **Core Concept** | Persistent Image DNA — inspired by biological DNA |

### Mission Statement

> Build a universal forensic identity platform that gives every digital file a **persistent, multi-layer DNA fingerprint** — proving ownership, detecting tampering, and maintaining a documented chain of custody from creation to investigation.

### Vision

Just as human DNA identifies a person across their entire lifetime even if they change appearance, **Image DNA** identifies a photo (and now any supported file) across its entire life on the internet — even after compression, resizing, cropping, screenshotting, or re-encoding.

### What We Aim to Prove (Capability Statement)

**We can reliably prove:**

> "This file matches Vault X, DNA Record Y, owned by User Z, was exported via Protected Download at time T, and shows tamper vectors A, B, C compared to the original."

**We cannot yet prove (future roadmap):**

> "This file was forwarded on WhatsApp to Person Q and opened at Location R without the file being uploaded back into PinIT."

Post-download tracking requires either file recovery via Investigation or a future PinIT-controlled native viewer.

---

## 3. What Is This Project?

PinIT Hub started as a **6-layer image fingerprint API** and evolved into a **full-stack SaaS platform** for digital asset protection and forensic investigation.

### Evolution Timeline

| Phase | Scope |
|-------|-------|
| **Phase 1 (Core)** | 6-layer image DNA fingerprinting API |
| **Phase 2–3** | Vault encryption, certificates, smart share links |
| **Phase 4–5** | Unified investigation, evidence pairing, forensic diff |
| **Phase 8–10** | 15-layer DNA, enterprise features, universal file types |
| **Current (v2.0)** | PinIT Hub — vault + sharing + monitoring + forensics + biometrics + business orgs + Chrome extension + subscription billing |

### Supported File Types (All LIVE)

Images, PDF, DOCX, PPTX, TXT, CSV, JSON, ZIP, Video, Audio — **10 file types total**

### The 15 DNA Layers

| Layer | Name | Purpose |
|-------|------|---------|
| L1 | Cryptographic Hash (SHA-256) | Exact file identity — wax seal |
| L2 | Structural Fingerprint (Sobel edges) | Edge pattern signature, survives colour changes |
| L3 | Perceptual Hash (pHash/aHash/dHash) | Survives JPEG compression, resizing |
| L4 | Semantic Color Fingerprint | RGB histogram — colour personality |
| L5 | Metadata Provenance (C2PA-style) | EXIF/IPTC/XMP, device, GPS |
| L6 | LSB Steganography (AI Signature) | Hidden token in pixel LSBs |
| L7 | Behavioral Layer | Usage and access patterns |
| L8 | Relationship Layer | Links between related files |
| L9 | Origin Layer | Source and creation context |
| L10 | Evolution Layer | Change history over time |
| L11 | Deepfake Detection | AI-generated content detection (heuristic) |
| L12 | DCT Watermark | Frequency-domain watermark |
| L13 | Chain of Custody | Append-only lifecycle events |
| L14 | Zero-Knowledge Proof | Cryptographic ownership proof |
| L15 | Biometric Bind | Links file to owner's biometrics |

**Key insight:** An attacker would need to destroy all layers at once — which would make the file visually or forensically worthless. For any given attack, **at least 3–5 layers survive**.

---

## 4. The Problem We Solve

Every day, billions of images and documents are stolen, reposted, and claimed by others. Existing protection methods fail:

| Method | Why It Fails |
|--------|--------------|
| Visible watermark | Anyone can crop it out in seconds |
| File metadata (EXIF) | Social media platforms strip it automatically |
| Single hidden watermark | One targeted attack removes all protection |
| Copyright notice | Cannot be proven technically inside the file |
| Simple checksum (MD5/SHA) | Breaks after any edit or re-encoding |

**Our solution:** Multiple independent fingerprint layers, each surviving different attacks, combined with encrypted vault storage, tracked sharing, web monitoring, and forensic investigation.

---

## 5. Complete Tech Stack

### Frontend (`client/`)

| Technology | Purpose |
|------------|---------|
| React 18 + TypeScript | UI framework |
| Vite 5 | Build tool & dev server |
| Tailwind CSS 3 | Styling |
| React Router DOM 7 | Client-side routing |
| Axios | HTTP (via authenticated `dashboard.api.ts`) |
| Framer Motion | Animations |
| Lucide React | Icons |
| face-api.js | Face biometric enrollment/login |
| WebAuthn | Device biometric authentication |
| Custom voice fingerprint | Voice biometric capture |
| Tesseract.js | Client-side OCR |
| Leaflet + React Leaflet | Geo maps for share tracking |
| Recharts / D3 | Analytics charts |
| jsPDF / jszip | Report export |

**Deployed on:** Vercel → https://dna-pinit-web.vercel.app

### Backend (`src/`)

| Technology | Purpose |
|------------|---------|
| Node.js 20+ | Runtime |
| TypeScript 5 | Language |
| Express 4 | HTTP API framework |
| Prisma 5 | ORM |
| PostgreSQL 16 | Database (via Supabase) |
| JWT + bcryptjs | Authentication |
| Sharp | Image processing |
| exifr | Metadata extraction |
| ffmpeg-static / ffprobe | Video/audio processing |
| Tesseract.js | Server-side OCR |
| AES-256-GCM | Vault encryption |
| Zod | Request validation |
| Winston + Morgan | Logging |
| node-cron | Scheduled jobs (crawler, vault) |
| Razorpay | Payment processing |
| vectra | Semantic search (Node-side) |

**Deployed on:** Render → https://pinit-dna-backend.onrender.com (port 4000)

### Python AI Sidecar (`python-ai/`)

| Technology | Purpose |
|------------|---------|
| FastAPI + Uvicorn | AI microservice (port 8001) |
| sentence-transformers | Semantic embeddings (`all-MiniLM-L6-v2`) |
| FAISS | Vector similarity search |
| Custom services | OCR, computer vision, deepfake, forensic scanner, screenshot analysis |

**Deployed on:** Render (Docker) as `pinit-dna-ai`

### Chrome Extension (`extension/`)

| Technology | Purpose |
|------------|---------|
| Manifest V3 | Chrome/Edge extension |
| Service worker | Background processing |
| Content scripts | Per-platform adapters (30+ sites) |

### Database & Storage

| Service | Purpose |
|---------|---------|
| Supabase PostgreSQL | Primary database (Prisma ORM) |
| Supabase Storage | Encrypted vault files (`vault-files` bucket) |

### Authentication

- JWT access token stored in `localStorage` as `pinit_access_token`
- Refresh tokens in database
- Multi-modal biometric: face + voice + WebAuthn device fingerprint
- Extension OAuth via short-lived codes

---

## 6. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER / ANALYST                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         v                   v                   v
┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐
│  Web App       │  │ Chrome Extension│  │ Public Share     │
│  (React/Vite)  │  │ (Publish        │  │ Viewer (/s/:token)│
│  Vercel        │  │  Guardian)      │  │ No auth required │
└───────┬────────┘  └────────┬────────┘  └────────┬─────────┘
        │                    │                     │
        └────────────────────┼─────────────────────┘
                             │ HTTPS /api/v1
                             v
              ┌──────────────────────────────┐
              │   API Server (Node/Express)  │
              │   Render — port 4000         │
              └──────────────┬───────────────┘
                             │
     ┌───────────┬───────────┼───────────┬───────────┐
     │           │           │           │           │
     v           v           v           v           v
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│DNA Engine│ │ Vault   │ │Investig-│ │ Share & │ │Monitoring│
│15 layers │ │AES-256  │ │ation    │ │ Tracking│ │ Crawler  │
│10 types  │ │Supabase │ │Pipeline │ │ Engine  │ │ Engine   │
└─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              v              v              v
     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
     │ PostgreSQL  │ │ Supabase    │ │ Python AI   │
     │ (Supabase)  │ │ Storage     │ │ (FastAPI)   │
     │ 60+ models  │ │ vault-files │ │ FAISS/OCR   │
     └─────────────┘ └─────────────┘ └─────────────┘
```

### Data Flow — Core Protect Loop

```
Upload File → Generate DNA (15 layers) → Encrypt (AES-256-GCM)
     → Store in Vault (Supabase) → Issue Certificate
     → Protected Download (TEP watermark) → Share Link (optional)
     → Monitor Web (optional) → Investigate if leaked (optional)
```

---

## 7. Project Structure

```
Pinit-DNA/
├── src/                      # Node.js/Express backend
│   ├── api/
│   │   ├── routes/           # 21 API route modules
│   │   ├── controllers/      # Request handlers
│   │   └── middleware/       # Auth, upload, ownership, errors
│   ├── services/
│   │   ├── layers/           # DNA layer implementations (L1–L15)
│   │   ├── forensics/        # Investigation, tamper, scoring
│   │   ├── vault/            # Encryption, storage, analysis
│   │   ├── share/            # Smart links, tracking, masking
│   │   ├── crawler/          # Web monitoring engine
│   │   ├── auth/             # Biometric auth/matching
│   │   ├── subscription/     # Plans, Razorpay, entitlements
│   │   ├── publish-guardian/ # Extension protect pipeline
│   │   ├── assets/           # Universal asset protection
│   │   ├── organization/     # Business org, team, API keys
│   │   └── tep/              # Tracked Export Package
│   ├── config/               # Environment, DNA versions, file types
│   └── lib/                  # Supabase storage, utilities
│
├── client/                   # React/Vite frontend
│   └── src/
│       ├── pages/            # Feature pages (40+ routes)
│       ├── pages/auth/       # Registration, login, biometrics
│       ├── pages/publish-guardian/  # Protected posts UI
│       ├── pages/business/   # Org dashboard, team, API keys
│       ├── pages/subscription/  # Billing, Razorpay checkout
│       ├── components/auth/  # BiometricStep, VoiceCaptureStep
│       ├── services/         # dashboard.api.ts (authenticated API)
│       ├── config/           # brand.config.ts, api.config.ts
│       └── router.tsx        # Full route table
│
├── extension/                # PinIT Hub Chrome extension (MV3)
│   ├── popup/                # Extension popup UI
│   ├── options/              # API/Hub URL configuration
│   ├── background/           # Service worker
│   └── content/              # Platform-specific content scripts
│
├── python-ai/                # FastAPI AI microservice
│   ├── main.py               # API entry point
│   └── services/             # OCR, CV, deepfake, embeddings
│
├── prisma/
│   ├── schema.prisma         # 60+ database models
│   └── migrations/           # Database migrations
│
├── docs/                     # Architecture & implementation docs
├── tests/                    # Jest layer tests
├── scripts/                  # Dev stack, DB ensure, deployment
├── validation/               # Golden dataset for forensic regression
└── mockups/                  # UI wireframe HTML
```

---

## 8. Completed Implementations

These modules are **implemented and deployed** in production:

### Core DNA & Fingerprinting

| Module | Status | Description |
|--------|--------|-------------|
| Universal File Router | ✅ LIVE | Routes 10 file types to appropriate DNA engines |
| DNA Orchestrator | ✅ LIVE | 15-layer pipeline for images |
| Universal Engines | ✅ LIVE | TXT, CSV, JSON, PDF, DOCX, PPTX, ZIP, VIDEO, AUDIO |
| Comparison Engine | ✅ LIVE | L1–L6 scoring with derivative-aware logic |
| Local DNA Patch Index | ✅ LIVE | Crop/screenshot recovery fingerprints |
| Duplicate Detection | ✅ LIVE | Global SHA-256 registry with forensic logging |

### Vault & Storage

| Module | Status | Description |
|--------|--------|-------------|
| Vault Service | ✅ LIVE | AES-256-GCM encrypt, store, retrieve |
| Supabase Storage | ✅ LIVE | Encrypted `.enc` blobs in `vault-files` bucket |
| Protected Download | ✅ LIVE | TEP (Tracked Export Package) watermarking v3.0 |
| Content Analysis | ✅ LIVE | AI-generated, screenshot, sensitive data detection |
| Vault Integrity Checks | ✅ LIVE | Tamper detection on stored files |

### Certificates & Ownership

| Module | Status | Description |
|--------|--------|-------------|
| Certificate Service | ✅ LIVE | Issue, verify, revoke ownership certificates |
| Public Verification | ✅ LIVE | `/certificates/verify/:id` — no auth required |

### Forensic Investigation

| Module | Status | Description |
|--------|--------|-------------|
| Unified Investigation | ✅ LIVE | End-to-end forensic pipeline |
| Acceptance Engine | ✅ LIVE | 5 verdicts — sole authority for match decisions |
| Candidate Ranking Engine | ✅ LIVE | Multi-stage candidate funnel |
| Investigation Manifest | ✅ LIVE | Immutable sealed report with QR verification |
| Forensic Diff | ✅ LIVE | Side-by-side tamper comparison |
| Evidence Reports | ✅ LIVE | PDF export with signed manifest |
| Forward Chain Graph | ✅ LIVE | Track file forwarding across recipients |
| Leak Attribution | ✅ LIVE | Attribute leaked files to vault owner |

### Smart Share & Tracking

| Module | Status | Description |
|--------|--------|-------------|
| Smart Share Links | ✅ LIVE | Token-based links with rich access controls |
| Access Logging | ✅ LIVE | GPS, device fingerprint, risk scoring |
| Privacy Masking | ✅ LIVE | Email, phone, Aadhaar, PAN, address masking |
| OTP Verification | ✅ LIVE | One-time password for sensitive shares |
| Geo Restrictions | ✅ LIVE | Block/allow by country/region |
| VPN/Tor Blocking | ✅ LIVE | Detect and block anonymous viewers |
| Unmask Request Workflow | ✅ LIVE | Recipient requests unmask, owner approves |
| Live Session Tracking | ✅ LIVE | Real-time viewer map |
| Link Tree | ✅ LIVE | Multi-link share pages |

### Monitoring & Intelligence

| Module | Status | Description |
|--------|--------|-------------|
| Web Monitoring | ✅ LIVE | Enroll DNA records for URL watch |
| Crawler Engine | ✅ LIVE | Platform connectors (YouTube, GitHub, etc.) |
| Crawl Alerts | ✅ LIVE | Notifications when matches found |
| Semantic Search | ✅ LIVE | FAISS + vectra hybrid search |
| OCR Intelligence | ✅ LIVE | Tesseract + Python AI OCR |
| Document Lineage | ✅ LIVE | Track document edit history |
| Intelligence Reports | ✅ LIVE | Per-vault-file analysis reports |

### Authentication & Security

| Module | Status | Description |
|--------|--------|-------------|
| Account Registration | ✅ LIVE | Individual and Business account types |
| Password Login | ✅ LIVE | JWT + refresh token flow |
| Face Biometric | ✅ LIVE | face-api.js enrollment and login |
| Voice Biometric | ✅ LIVE | Custom voice fingerprint capture |
| WebAuthn Device Auth | ✅ LIVE | Hardware biometric binding |
| Fusion Login | ✅ LIVE | Face + voice + device combined verification |
| Login History | ✅ LIVE | Session and security event tracking |
| Extension OAuth | ✅ LIVE | Short-lived code exchange for extension |

### Business & Enterprise

| Module | Status | Description |
|--------|--------|-------------|
| Organizations | ✅ LIVE | Multi-tenant business workspaces |
| Team Management | ✅ LIVE | Invites, RBAC roles, departments |
| API Keys | ✅ LIVE | Organization-scoped API access |
| Webhooks | ✅ LIVE | Event notifications to external systems |
| Integrations | ✅ LIVE | Slack, Teams, Zapier, Dropbox, Google Drive |
| Audit Logs | ✅ LIVE | Organization activity tracking |

### Subscription & Billing

| Module | Status | Description |
|--------|--------|-------------|
| Freemium Plans | ✅ LIVE | FREE / PRO / ENTERPRISE tiers |
| Feature Entitlements | ✅ LIVE | Plan-based feature gating |
| Razorpay Integration | ✅ LIVE | Payment processing |
| Usage Metering | ✅ LIVE | Storage, investigations, monitors, API calls |

### Publish Guardian (Chrome Extension)

| Module | Status | Description |
|--------|--------|-------------|
| Right-Click Protect/Verify | ✅ LIVE | Any image on any website |
| Publish-Time Protection | ✅ LIVE | 30+ platform adapters |
| Protected Posts | ✅ LIVE | Timeline, discoveries, tampering alerts |
| Extension Sync | ✅ LIVE | Bidirectional state with Hub |

### Universal Asset Protection

| Module | Status | Description |
|--------|--------|-------------|
| Asset Lifecycle | ✅ LIVE | Image/video/document/audio aggregate model |
| Asset Timeline | ✅ LIVE | Events, discoveries, monitoring per asset |
| Asset Discoveries | ✅ LIVE | Web crawl matches linked to assets |

### Admin Portals

| Module | Status | Description |
|--------|--------|-------------|
| Admin Portal | ✅ LIVE | User management, vault explorer |
| Super Admin | ✅ LIVE | Executive overview, full system access |

### Platform Infrastructure

| Module | Status | Description |
|--------|--------|-------------|
| Notifications | ✅ LIVE | In-app + SSE stream |
| Forensic Provenance | ✅ LIVE | Append-only lifecycle events (10 of 15 types active) |
| Platform Events Engine | ✅ LIVE | System-wide event bus |

---

## 9. Partial / In-Progress Work

Be aware of these gaps when working on or demoing the product:

| Module | Gap | Priority |
|--------|-----|----------|
| Provenance events | FORWARDED, RECOVERED, CRAWLER_DETECTION not yet appended | Medium |
| TEP expiry enforcement | Stored but not checked at extraction | Medium |
| Revoked TEP blocking | Status in DB; file still matches on re-upload | Medium |
| L11 Deepfake | Heuristic only; ML model planned | Future |
| Video/audio engines | Baseline fingerprints; advanced algorithms planned | Future |
| Post-download continuous tracking | Requires native PinIT Viewer (planned) | Future |
| Native mobile/desktop apps | Not yet implemented | Future |

---

## 10. Core Workflows (How It Works)

### Workflow 1 — User Registration

```
/register/account-type → Choose INDIVIDUAL or BUSINESS
    → Welcome screen → Camera/mic permissions
    → Face enrollment (face-api.js)
    → WebAuthn biometric (BiometricStep.tsx)
    → Voice capture (VoiceCaptureStep.tsx)
    → POST /auth/create + POST /auth/face/register
    → Redirect to onboarding or business setup
```

**Key files:**
- `client/src/pages/auth/RegistrationFlow.tsx`
- `client/src/components/auth/BiometricStep.tsx`
- `client/src/components/auth/VoiceCaptureStep.tsx`

### Workflow 2 — User Login

```
/login → Welcome → Face scan → WebAuthn → Voice verification
    → POST /auth/face/login (fusion: face + voice + device)
    → JWT stored as pinit_access_token in localStorage
    → Redirect to Dashboard
```

**Key files:**
- `client/src/pages/auth/LoginFlow.tsx`
- `src/services/auth/biometric-auth.service.ts`

### Workflow 3 — Generate DNA & Protect File (Core Loop)

```
/generate → Upload file (UploadZone)
    → POST /dna/generate (15-layer fingerprint)
    → Client-side encryption step (EncryptionStep)
    → POST /vault/store (AES-256-GCM → Supabase Storage)
    → Protected download prep with TEP watermark (ProtectReadyStep)
    → Success panel → Certificate / Share options
```

**Supported inputs:** Upload, camera scan, video/audio recording  
**Supported types:** Images, PDF, DOCX, PPTX, TXT, CSV, JSON, ZIP, Video, Audio

### Workflow 4 — Vault Management

```
/vault → Browse encrypted files
    → Preview, rename, delete
    → Protected download (TEP watermarked export)
    → Content analysis, sensitive data scan
    → Create share link from vault file
    → View tracking/access logs
```

### Workflow 5 — Smart Share

**Owner side:**
```
Create share link → Configure restrictions (OTP, geo, device, expiry)
    → Set privacy masking rules
    → Share URL: https://dna-pinit-web.vercel.app/s/:token
```

**Recipient side (no login required):**
```
Open /s/:token (ShareViewerPage.tsx)
    → Access logged (GPS, device, IP, fingerprint)
    → Optional OTP verification
    → View masked/unmasked content
    → Risk score calculated
```

### Workflow 6 — Forensic Investigation

```
/pinit-hub/investigation → Upload suspect file
    → POST /forensics/unified-investigate
    → System searches owner's vault
    → Candidate Ranking Engine filters matches
    → Deep DNA comparison (all layers)
    → Acceptance Engine returns 1 of 5 verdicts:
        • CONFIRMED_MATCH
        • PROBABLE_MATCH
        • POSSIBLE_DERIVATIVE
        • NO_MATCH
        • INSUFFICIENT_EVIDENCE
    → Generate signed evidence report (PDF + QR)
```

### Workflow 7 — Web Monitoring

```
/monitoring → Enroll DNA record for URL watch
    → Crawler engine scans configured platforms
    → Matches create alerts and discoveries
    → Link to Protected Posts or Asset timeline
```

### Workflow 8 — Chrome Extension (Publish Guardian)

```
Install extension → Configure API + Hub URLs in options
    → Sign in via popup (OAuth at /extension/auth)
    → Right-click any image → "Protect with PinIT"
        OR on supported platform → auto-protect at upload
    → POST /extension/publish-protect
    → View in Hub → /protected-posts
```

**Supported platforms:** Instagram, Facebook, X, YouTube, TikTok, Canva, Shopify, GitHub, and 20+ more.

### Workflow 9 — Business Organization

```
Register as BUSINESS → Organization setup
    → Invite team members → Assign RBAC roles
    → Create API keys → Configure webhooks
    → Business dashboard at /business
```

### Workflow 10 — Subscription Upgrade

```
/upgrade → Select PRO or ENTERPRISE plan
    → Razorpay checkout → Payment
    → Feature entitlements updated
    → Usage limits increased
```

---

## 11. Practical Development Guide

### Prerequisites

- Node.js 20+
- PostgreSQL access (Supabase credentials)
- Python 3.11+ (for AI sidecar)
- Chrome or Edge (for extension testing)
- Git

### Environment Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ashwitha2004/DNA-PINIT-WEB.git
   cd DNA-PINIT-WEB
   ```

2. **Install backend dependencies:**
   ```bash
   npm install
   ```

3. **Install frontend dependencies:**
   ```bash
   cd client && npm install && cd ..
   ```

4. **Set up environment variables:**
   - Copy `.env.example` to `.env` (root) and configure:
     - `DATABASE_URL` — Supabase PostgreSQL connection string
     - `DIRECT_URL` — Supabase direct connection (migrations)
     - `JWT_SECRET` — JWT signing secret
     - `VAULT_MASTER_SECRET` — Vault encryption key
     - `LSB_SIGNATURE_SECRET` — L6 steganography HMAC key
     - `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — Storage access
     - `AI_SERVICE_URL` — Python AI sidecar URL (optional)

5. **Set up database:**
   ```bash
   npm run db:generate    # Generate Prisma client
   npm run db:push        # Push schema to database
   ```

6. **Set up Python AI (optional but recommended):**
   ```bash
   npm run dev:ai:setup   # Creates venv and installs dependencies
   ```

### Running Locally

**Option A — Full stack (recommended):**
```bash
npm run dev:all
```
Starts backend (:4000), frontend (:3000), and Python AI (:8001).

**Option B — Individual services:**
```bash
npm run dev              # Backend only — port 4000
npm run dev:client       # Frontend only — port 3000 (proxies /api → :4000)
npm run dev:ai           # Python AI only — port 8001
```

**Access points:**
| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:4000/api/v1 |
| Python AI | http://localhost:8001 |
| Prisma Studio | `npm run db:studio` |

### Loading the Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Open extension **Options** → set API to `http://localhost:4000/api/v1` and Hub to `http://localhost:3000`
5. Click extension popup → **Sign in to PinIT**

### Building for Production

```bash
npm run build:all        # Build frontend + backend
npm run start:prod       # Start production server
```

---

## 12. Deployment & Production URLs

| Component | Platform | URL |
|-----------|----------|-----|
| **Frontend** | Vercel | https://dna-pinit-web.vercel.app |
| **Frontend (custom domain)** | Vercel | https://www.pinithub.com |
| **Backend API** | Render | https://pinit-dna-backend.onrender.com/api/v1 |
| **Python AI** | Render (Docker) | Configured via `AI_SERVICE_URL` env var |
| **Database** | Supabase | PostgreSQL (connection via env vars) |
| **File Storage** | Supabase | `vault-files` bucket |

### Deployment Flow (Mandatory for Every Change)

1. Verify locally
2. Verify backend APIs
3. Verify database migrations
4. Commit to Git
5. Push to GitHub (`main` branch)
6. Confirm Render backend deployment
7. Confirm Vercel frontend deployment
8. Validate on live URL
9. Confirm production matches localhost

> **Note:** First API call after idle may take 30–60 seconds (Render free tier wake-up). Refresh once if a page loads empty.

---

## 13. Key Files Every Developer Should Know

### Backend

| File | Purpose |
|------|---------|
| `src/server.ts` | Express server entry point |
| `src/app.ts` | Middleware and route mounting |
| `src/config/index.ts` | Environment configuration |
| `src/services/dna.orchestrator.ts` | DNA generation pipeline |
| `src/services/vault/vault.service.ts` | Vault encrypt/store/retrieve |
| `src/services/forensics/unified-investigation.service.ts` | Investigation pipeline |
| `src/services/share/share.service.ts` | Smart share link logic |
| `src/lib/supabase-storage.ts` | Supabase Storage integration |
| `prisma/schema.prisma` | All database models |

### Frontend

| File | Purpose |
|------|---------|
| `client/src/router.tsx` | All application routes |
| `client/src/services/dashboard.api.ts` | Authenticated Axios instance (USE THIS for API calls) |
| `client/src/config/api.config.ts` | API base URL configuration |
| `client/src/config/brand.config.ts` | Product branding constants |
| `client/src/pages/GeneratePage.tsx` | Core DNA generation flow |
| `client/src/pages/ShareViewerPage.tsx` | Public share viewer (no auth) |
| `client/src/pages/UnifiedInvestigationPage.tsx` | Forensic investigation UI |

### Extension

| File | Purpose |
|------|---------|
| `extension/manifest.json` | Extension configuration |
| `extension/shared/config.js` | API/Hub URL defaults |
| `extension/background/service-worker.js` | Background processing |

---

## 14. API Overview

**Base URL:** `/api/v1`

### Route Modules (21 total)

| Prefix | Module | Auth Required |
|--------|--------|---------------|
| `/auth/*` | Authentication, biometrics, extension OAuth | Mixed |
| `/dna/*` | DNA generation, verification, comparison | Yes |
| `/vault/*` | Encrypted storage, protected download | Yes |
| `/share/*` | Smart links, tracking, analytics | Mixed (viewer is public) |
| `/certificates/*` | Issue, verify, revoke | Mixed (verify is public) |
| `/monitor/*` | Web monitoring, alerts | Yes |
| `/forensics/*` | Unified investigation | Yes |
| `/forensic/diff` | Forensic diff comparison | Yes |
| `/evidence/*` | Reports, incidents, chain | Mixed |
| `/intelligence/*` | OCR, search, lineage | Yes |
| `/ai/*` | Python AI proxy | Yes |
| `/extension/*` | Publish Guardian | Yes |
| `/assets/*` | Universal asset protection | Yes |
| `/organization/*` | Business org management | Yes |
| `/subscription/*` | Plans, billing, usage | Yes |
| `/profile/*` | User profile, sessions | Yes |
| `/notifications/*` | In-app notifications + SSE | Yes |
| `/tep/*` | Tracked Export Packages | Mixed |
| `/admin/*` | Admin portal | Admin only |
| `/super-admin/*` | Super admin portal | Super admin only |
| `/ping`, `/health` | Health checks | Public |

---

## 15. Database Models

**Schema file:** `prisma/schema.prisma` (60+ models)

### Model Groups

| Group | Key Models |
|-------|------------|
| **DNA Core** | `DnaRecord`, `CryptoLayer`, `StructuralLayer`, `PerceptualLayer`, `SemanticLayer`, `MetadataLayer`, `StegoLayer`, `BehavioralLayer`, `RelationshipLayer`, `OriginLayer`, `EvolutionLayer`, `DeepfakeLayer`, `DctWatermarkLayer`, `CustodyLayer`, `ZkProofLayer`, `BiometricBindLayer` |
| **Vault** | `VaultRecord`, `Certificate`, `LocalFeatureIndex`, `LocalDnaPatch` |
| **Users & Auth** | `User`, `RefreshToken`, `LoginHistory`, `BiometricIdentity`, `FaceTemplate`, `VoiceTemplate`, `UserSession`, `SecurityEvent` |
| **Sharing** | `ShareLink`, `ShareAccessLog`, `ShareRecipient`, `UnmaskRequest`, `LinkForwardEvent`, `BlockedShareViewer`, `FileTamperEvent`, `TrackedExportPackage` |
| **Monitoring** | `MonitorRecord`, `CrawlResult`, `MonitoringRun`, `CrawlerJob`, `CrawlerMatch` |
| **Evidence** | `Incident`, `EvidenceRecord`, `ForensicProvenanceEvent` |
| **Business** | `Organization`, `Workspace`, `Department`, `OrganizationMember`, `OrganizationInvite`, `OrganizationApiKey`, `OrganizationWebhook` |
| **Subscription** | `Plan`, `Subscription`, `FeatureEntitlement`, `BillingHistory`, `UsageRecord` |
| **Extension & Assets** | `ProtectedPost`, `ProtectedPostDiscovery`, `ExtensionAuthCode`, `Asset`, `AssetDiscovery` |
| **Platform** | `Notification`, `PlatformEvent`, `AuditEvent` |

### Multi-Tenant Rule

**All Prisma queries must be scoped to `ownerUserId`** (or `organizationId` for business accounts). Never return data across tenant boundaries.

---

## 16. Chrome Extension (Publish Guardian)

### What It Does

The PinIT Hub Chrome extension protects digital assets **at the moment of publishing** — before they leave the user's control.

### Three Modes

| Mode | Trigger | Action |
|------|---------|--------|
| **Verify** | Right-click image → "Verify with PinIT" | Checks if image matches a vault record |
| **Protect** | Right-click image → "Protect with PinIT" | Generates DNA + registers protected post |
| **Publish Guardian** | Upload file on supported platform | Auto-captures bytes and calls `publish-protect` |

### Supported Platforms (30+)

- **Social:** Instagram, Facebook, X, Pinterest, LinkedIn, Telegram Web
- **Creators:** YouTube/Studio, TikTok, Threads, Reddit, Tumblr, Medium, Substack, Patreon, Vimeo, Twitch, Behance, Dribbble, ArtStation, DeviantArt
- **Business:** GitHub, Canva, Figma, Shopify Admin, WordPress Admin

### Extension ↔ Hub Sync

Extension state syncs bidirectionally with the Hub via `GET /extension/sync`. Protected posts appear in Hub at `/protected-posts` with timeline, discoveries, and tampering alerts.

---

## 17. Testing the Application End-to-End

Follow this sequence to validate the full product:

| # | Test | Route | Expected Result |
|---|------|-------|-----------------|
| 1 | Login | `/login` | Biometric login succeeds, dashboard loads |
| 2 | Dashboard | `/` | Stats, charts, quick actions visible |
| 3 | Generate DNA | `/generate` | 15-layer fingerprint created |
| 4 | Duplicate Detection | Upload same file again | Duplicate warning logged |
| 5 | Vault | `/vault` | Encrypted file listed with preview |
| 6 | Protected Download | Vault → Download | TEP-watermarked file exported |
| 7 | Create Share Link | Vault → Share | Link created with restrictions |
| 8 | View Share (incognito) | `/s/:token` | File viewable, access logged |
| 9 | Share Analytics | Share dashboard | GPS map, access logs visible |
| 10 | Investigation | `/pinit-hub/investigation` | Upload suspect → verdict returned |
| 11 | Certificate | `/certificates` | Certificate issued and verifiable |
| 12 | Monitoring | `/monitoring` | DNA record enrolled for watch |
| 13 | Extension Protect | Right-click image | Protected post created in Hub |
| 14 | Business (if applicable) | `/business` | Team, API keys functional |

> **Full test guide:** See `docs/PINIT-DNA-USER-TEST-FLOW.md` for detailed step-by-step instructions with 20+ test scenarios.

---

## 18. Development Rules & Conventions

### Critical Rules

1. **Always use authenticated API client:** Import `api` from `client/src/services/dashboard.api.ts` — never bare `axios`
2. **Never hardcode API paths:** Use `API_BASE_URL` from `client/src/config/api.config.ts`
3. **Vault files go to Supabase Storage:** Never store on local disk in production (Render filesystem is ephemeral)
4. **Multi-tenant isolation:** All Prisma queries scoped to `ownerUserId`
5. **ShareViewerPage is public:** No auth headers on `/s/:token` routes
6. **JWT token key:** Stored as `pinit_access_token` in `localStorage`

### Code Conventions

- TypeScript everywhere (backend + frontend)
- Zod for request validation (backend)
- Prisma for all database access
- Express async error handling via `express-async-errors`
- React functional components with hooks
- Tailwind CSS for styling (no inline styles)
- Feature-based page organization in `client/src/pages/`

### Git Workflow

- Repository: `ashwitha2004/DNA-PINIT-WEB`
- Main branch: `main`
- Do not force-push to `main`
- Only commit when explicitly requested

---

## 19. Reference Documentation Index

| Document | Path | Contents |
|----------|------|----------|
| **This guide** | `docs/TEAM-ONBOARDING-PROJECT-GUIDE.md` | Complete onboarding handbook |
| README | `README.md` | 6-layer DNA overview, API docs, setup |
| Architecture | `ARCHITECTURE.md` | System architecture and roadmap |
| Deployment rules | `CLAUDE.md` | Mandatory deployment sync checklist |
| User test flow | `docs/PINIT-DNA-USER-TEST-FLOW.md` | 20+ end-to-end test scenarios |
| Executive summary | `docs/enterprise/09_EXECUTIVE_SUMMARY.md` | Management overview, status matrix |
| 15-layer DNA spec | `docs/PHASE8_STEP1_15_LAYER_DNA_SPECIFICATION.md` | Layer algorithm details |
| Unified investigation | `docs/architecture/01_UNIFIED_INVESTIGATION.md` | Investigation pipeline spec |
| Acceptance rules | `docs/architecture/02_ACCEPTANCE_RULES.md` | 5-verdict acceptance policy |
| DNA specification | `docs/architecture/03_DNA_SPECIFICATION.md` | Algorithm version `15-layer-v1` |
| Protected download | `docs/PHASE_B_PROTECTED_DOWNLOAD.md` | TEP watermarking spec |
| Publish Guardian | `docs/PINIT_Publish_Guardian_Spec.md` | Extension architecture |
| Extension README | `extension/README.md` | Extension setup and testing |
| Subscription | `docs/SUBSCRIPTION_ENTITLEMENT.md` | Plan tiers and feature gating |
| Forensic provenance | `docs/FORENSIC_PROVENANCE.md` | Chain of custody events |
| Enterprise docs | `docs/enterprise/` | Full enterprise documentation set |

---

## 20. Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                    PinIT Hub Quick Reference               │
├─────────────────────────────────────────────────────────────┤
│ Motto:     Secure · Connect · Control                       │
│ Version:   v2.0 · Universal                                 │
│                                                             │
│ LIVE URLS:                                                  │
│   App:      https://dna-pinit-web.vercel.app                │
│   API:      https://pinit-dna-backend.onrender.com/api/v1   │
│   Domain:   https://www.pinithub.com                        │
│                                                             │
│ LOCAL DEV:                                                  │
│   Frontend: http://localhost:3000                           │
│   Backend:  http://localhost:4000/api/v1                    │
│   AI:       http://localhost:8001                           │
│   Start:    npm run dev:all                                 │
│                                                             │
│ AUTH TOKEN: localStorage → pinit_access_token              │
│ API CLIENT: client/src/services/dashboard.api.ts            │
│ DB SCHEMA:  prisma/schema.prisma (60+ models)               │
│ DNA LAYERS: 15 layers × 10 file types                      │
│ VERDICTS:   5 (Acceptance Engine)                          │
│                                                             │
│ REPO:       github.com/ashwitha2004/DNA-PINIT-WEB          │
│ BRANCH:     main                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Next Steps for New Team Members

1. **Read this document** fully
2. **Clone the repo** and set up local environment (Section 11)
3. **Run `npm run dev:all`** and explore the app at http://localhost:3000
4. **Create a test account** and walk through Registration → Generate DNA → Vault → Share → Investigation
5. **Load the Chrome extension** and test Protect on an image
6. **Browse `prisma/schema.prisma`** to understand the data model
7. **Read `docs/PINIT-DNA-USER-TEST-FLOW.md`** for hands-on testing exercises
8. **Review `docs/enterprise/09_EXECUTIVE_SUMMARY.md`** for business context
9. **Ask the team** for Supabase credentials and test account access

---

*Document maintained by the PinIT Hub development team. Last updated: July 29, 2026.*
