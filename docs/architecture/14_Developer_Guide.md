# 14 — Developer Guide

Onboarding guide for senior engineers joining PINIT-DNA / PinIT Hub.

---

## 1. What you are looking at

A **TypeScript Express monolith** (`src/`) with:

- React SPA (`client/`)
- Python AI sidecar (`python-ai/`)
- Chrome extension (`extension/`)
- Prisma/Postgres schema (`prisma/`)

Product surface: DNA fingerprinting, encrypted vault, smart share, monitoring, unified investigation, business orgs, subscriptions, Publish Guardian.

---

## 2. Folder walkthrough (first day)

| Order | Path | Why |
|-------|------|-----|
| 1 | `CLAUDE.md` + this `docs/architecture/` set | Rules + architecture map |
| 2 | `src/app.ts` + `src/server.ts` | HTTP surface + boot |
| 3 | `src/api/routes/*.ts` | Every endpoint |
| 4 | `src/services/` domain of interest | Real business logic |
| 5 | `prisma/schema.prisma` | Data model |
| 6 | `client/src/router.tsx` | UI map |
| 7 | `client/src/services/dashboard.api.ts` | Authenticated API client |
| 8 | `docs/architecture/07_API_Documentation.md` | Full endpoint map |

Ignore temporary `scripts/tmp-*` and mockups until needed.

---

## 3. How to run (local)

Prerequisites: Node ≥ 20, npm, Postgres URL (Supabase or local), Python 3.11 for AI.

```bash
# Backend
cp .env.example .env   # fill secrets + DATABASE_URL
npm install
npx prisma generate
npm run dev            # :4000 ; starts AI sidecar in non-prod

# Frontend (second terminal)
cd client
npm install
npm run dev            # :3000
```

Optional:

```bash
npm run db:studio
docker run -d -p 9998:9998 apache/tika   # metadata enrichment
```

Health checks:

- `GET http://localhost:4000/api/v1/ping`
- `GET http://localhost:4000/api/v1/health`
- UI: `http://localhost:3000`

---

## 4. Configuration

- Root `.env` — backend (see `.env.example`)
- `client/.env.development` / `.env.production` — Vite `VITE_*`
- Typed access: `src/config/index.ts` and feature modules under `src/config/`
- DNA/investigation feature flags: `DNA_*`, `DNA_PHASE2_*`, `DNA_PHASE3_*`, enterprise flags

Never commit secrets. Rotating `VAULT_MASTER_SECRET` requires re-encrypting vault blobs.

---

## 5. Common workflows

### Create account + login
1. UI register/login or `POST /api/v1/auth/create` then `/login`
2. Store JWTs; call `/auth/me`

### Protect a file
1. `POST /dna/generate` (multipart)
2. `POST /vault/store`
3. Optional certificate / share / monitor enroll

### Smart share
1. `POST /share` or `/share/file`
2. Open `/s/:token` as recipient
3. Owner views `/share/:token/logs` or Access Intelligence UI

### Investigation
1. UI `/pinit-hub/investigation`
2. `POST /forensics/unified-investigate`
3. Review response payload / evidence output in UI and API

### Extension protect
1. Load `extension/` unpacked
2. Extension auth code flow
3. `POST /extension/publish-protect`

### Database change
1. Edit `schema.prisma`
2. `npm run db:migrate`
3. Regenerate client; update services

---

## 6. Coding standards (from existing code)

- **Auth API calls (frontend):** use `api` from `dashboard.api.ts`, not bare axios.
- **API base URL:** `API_BASE_URL` from `api.config.ts` — no hardcoded `/api/v1` paths in new UI code.
- **Multi-tenant:** scope Prisma queries by `ownerUserId` (and org ids when applicable).
- **Vault storage:** Supabase in production — do not rely on Render local disk.
- **Errors:** prefer throwing/`next(err)` with `AppError` or domain errors; let `errorMiddleware` format.
- **Config:** read via `config` modules.
- **Public share page:** no auth interceptor.
- Match existing naming: `*.routes.ts`, `*.controller.ts`, `*.service.ts`.
- Keep controllers thin; put logic in `src/services/`.

---

## 7. Architecture principles (as built)

1. **Modular monolith** — domains are folders, not microservices.
2. **Service-centric business logic** — no formal repository/DTO layers.
3. **Tenant isolation by ownership middleware + query scoping.**
4. **Feature flags + subscription entitlements** gate expensive/enterprise routes.
5. **Sidecar AI** — embeddings/CV/OCR out-of-process over HTTP.
6. **Append-friendly forensic/provenance events** for audit trails.
7. **Document only what exists** — prefer code and this architecture set over stale root `README.md` / early `ARCHITECTURE.md`.

---

## 8. Testing

```bash
npm test          # Jest
```

Tests live under `tests/` (forensics, validation, extension adapters, etc.).

---

## 9. Deployment awareness

Follow team checklist in `CLAUDE.md`: local → commit/push → Render → Vercel → live verify.  
Do not mark features complete until production parity is checked when that process applies.

---

## 10. Where things are *not*

| Expectation | Reality |
|-------------|---------|
| Redis / BullMQ | Not implemented |
| SMTP email | Not implemented |
| Redux/Zustand | Not used |
| OpenAPI/Swagger | Not generated |
| Formal Repository layer | Prisma-in-services |
| Dedicated staging env | Not in-repo |
| Capacitor Android app | Not in current tree |

When unsure, search routes → controller → service → Prisma model. Prefer code over outdated root `README.md` / early `ARCHITECTURE.md` claims (they describe the original 6-layer core).
