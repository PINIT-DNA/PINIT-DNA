# 15 — Tech Stack

Complete inventory derived from `package.json` files, Prisma, Docker, and runtime integrations. Items marked **dependency only** appear in manifests; confirm usage before assuming active production paths.

---

## 1. Languages

| Language | Where |
|----------|--------|
| TypeScript | `src/`, `client/src/`, tests, many scripts |
| JavaScript | Extension (`extension/`), some `scripts/*.cjs` |
| Python 3.11 | `python-ai/` |
| SQL | `prisma/migrations/`, `supabase/*.sql` |
| HTML/CSS | `client` (Tailwind), `mockups/`, extension popup |

---

## 2. Frameworks & runtimes

| Tech | Role |
|------|------|
| Node.js ≥ 20 | Backend runtime |
| Express 4 | HTTP API |
| React 18 | SPA |
| Vite 5 | Frontend bundler / dev server |
| React Router 7 | Client routing |
| FastAPI / Uvicorn | Python AI HTTP server |
| Tailwind CSS 3 | UI styling |
| Prisma 5 | ORM |
| Jest | Backend/unit tests |
| Chrome Extension Manifest V3 | Browser extension |

---

## 3. Libraries (backend — selected from root `package.json`)

| Library | Role |
|---------|------|
| `@prisma/client` | DB access |
| `@supabase/supabase-js` | Storage (and Supabase APIs) |
| `axios` | Outbound HTTP |
| `bcryptjs` | Password hashing (profile) |
| `cors` | CORS |
| `dotenv` | Env loading |
| `exifr` | EXIF |
| `express-async-errors` | Async error plumbing |
| `express-rate-limit` | Rate limiting |
| `helmet` | Security headers |
| `jsonwebtoken` | JWT |
| `multer` | Uploads |
| `morgan` | HTTP logging |
| `winston` | Logging |
| `zod` | Schema validation (limited use) |
| `sharp` | Image processing |
| `tesseract.js` | OCR (Node path) |
| `ffmpeg-static` / `@ffprobe-installer/ffprobe` | Media tooling |
| `music-metadata` | Audio metadata |
| `pdf-lib` / `pdf-parse` / `mammoth` | Document handling |
| `jszip` | ZIP |
| `qrcode` | QR codes |
| `razorpay` | Billing |
| `node-cron` | Schedulers |
| `uuid` | IDs |
| `vectra` | Vector helper library |
| `@noble/hashes` | Cryptographic hashes |
| `diff` | Text diff |
| `file-type` | Sniff MIME |
| `ts-node` / `ts-node-dev` | Dev execution |

Dev: ESLint, TypeScript, Jest, Prisma CLI, type packages.

---

## 4. Libraries (frontend — selected from `client/package.json`)

| Library | Role |
|---------|------|
| `react` / `react-dom` | UI |
| `react-router-dom` | Routing |
| `axios` | HTTP |
| `framer-motion` | Motion |
| `face-api.js` | Face embeddings in browser |
| `tesseract.js` | Client OCR |
| `leaflet` / `react-leaflet` | Maps |
| `recharts` / `d3` | Charts / viz |
| `jspdf` / `jspdf-autotable` | PDF export |
| `jszip` | ZIP export |
| `docx-preview` | DOCX preview |
| `react-dropzone` | Uploads |
| `react-hot-toast` | Toasts |
| `lucide-react` | Icons |
| `date-fns` | Dates |
| `qrcode` | QR |
| `@supabase/supabase-js` | Supabase client check |
| Tailwind / PostCSS / Autoprefixer | CSS pipeline |

**Not present:** Redux, Zustand, React Query, Capacitor.

---

## 5. Databases

| Store | Technology |
|-------|------------|
| Primary relational DB | **PostgreSQL** via Prisma |
| Hosting options | Supabase Postgres and/or Render Postgres (`render.yaml`) |

---

## 6. Cloud / hosting services

| Service | Use |
|---------|-----|
| **Render** | Backend web service + AI Docker + optional blueprint DB |
| **Vercel** | Frontend SPA |
| **Supabase** | Postgres (typical) + Storage |
| **GitHub** | Source (and crawler API usage with token) |

---

## 7. Storage

| Mechanism | Detail |
|-----------|--------|
| Supabase Storage | Bucket `vault-files` |
| Local filesystem | `VAULT_STORAGE_DIR`, `UPLOAD_TEMP_DIR` |
| Python AI disk | `python-ai/data`, `python-ai/models` |

---

## 8. Utilities & media tooling

| Tool | Role |
|------|------|
| FFmpeg / ffprobe | Video/audio pipelines (Phase 2) |
| fpcalc (optional path) | Audio fingerprint tooling when configured |
| Apache Tika | Metadata extraction sidecar |
| Tesseract (system in AI Docker + JS libs) | OCR |
| node-cron | In-process schedules |

---

## 9. Third-party services / APIs

| Service | Purpose |
|---------|---------|
| Razorpay | Subscription payments |
| YouTube Data API | Monitoring discovery |
| GitHub API | Crawler |
| Bing Image Search API | Visual search monitoring |
| Crawl4AI (optional URL) | Crawler assist |
| Hugging Face / model hub | Sentence-transformers model fetch for AI (`all-MiniLM-L6-v2`) |

---

## 10. Python AI stack (from `python-ai/`)

- FastAPI + Uvicorn  
- Sentence-transformers / embeddings (`all-MiniLM-L6-v2`, dim 384)  
- FAISS-backed index data  
- OpenCV / forensic scanner / OCR / CV / authenticity ensemble modules under `python-ai/services/`  
- Docker image based on `python:3.11-slim`

---

## 11. Explicitly not in stack

| Item | Status |
|------|--------|
| Redis | Not implemented |
| Kafka / RabbitMQ | Not implemented |
| Stripe/PayPal live SDK billing | Enum values only; Razorpay + mock used |
| SMTP providers | Not implemented |
| GraphQL | Not implemented |
| Kubernetes manifests | Not in-repo |
| Backend Docker image | Not in-repo (Node on Render) |

---

## 12. Version anchors (from manifests)

| Component | Version signal |
|-----------|----------------|
| Backend package | `pinit-dna` `1.0.0` |
| UI package | `pinit-dna-ui` `1.0.0` |
| Prisma | `^5.14.0` |
| Express | `^4.19.2` |
| React | `^18.3.1` |
| Vite | `^5.3.1` |
| TypeScript | `^5.4.5` |
| Python AI config version string | `2.1.0-enterprise-prep` (in AI config) |
