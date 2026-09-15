# PINITHUB — Oracle Deployment Environment Variables

**2026** · Internal ops document for moving Hub, Exchange, and Landing off current hosts onto **Oracle**.

**Rules**
- This file lists **keys only**. Copy **values** from the current live secrets (Render / Vercel / existing `.env`). Do **not** commit real `.env` files.
- Source of keys: `.env.example`, `exchange/.env.example`, `pinithub-landing/.env.example`, plus Hub `src/config/index.ts` and client `VITE_*` usage.
- On Oracle, set the same keys as **container / Compute / Kubernetes secrets** (or OCI Vault), one surface at a time.

**Shared secrets (must be identical across services)**

| Key | Used by | Why |
|-----|---------|-----|
| `EXCHANGE_BRIDGE_SECRET` | Hub API + Exchange API | SSO, list, seal, licensed share, delivery |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Hub API (subscriptions) + Exchange API (checkout) | Same Razorpay account unless you split merchants |
| Postgres project | Hub `public` · Exchange `exchange` · Landing `landing` | Same database, **different schemas** |

After Oracle cutover, update **public URLs** everywhere (`PUBLIC_APP_URL`, `HUB_APP_URL`, `EXCHANGE_APP_URL`, `LANDING_URL`, `VITE_*`).

---

## 1. Pinit HUB — Backend API

**Where today:** Render (`pinit-dna-uf5y.onrender.com`)  
**Env file locally:** repo root `.env`  
**Oracle:** Node Hub process (port **4000** unless you remap `PORT`)

### 1.1 Required

| Key | Example / notes |
|-----|-----------------|
| `NODE_ENV` | `production` |
| `PORT` | `4000` (Oracle may inject `PORT` — keep Hub listening on it) |
| `API_PREFIX` | `/api/v1` |
| `DATABASE_URL` | Postgres URI (Prisma). Pooler URL if using PgBouncer. |
| `DIRECT_URL` | Direct Postgres URI for Prisma migrations (no pgbouncer). |
| `JWT_SECRET` | ≥32 chars. Signs Hub sessions. |
| `VAULT_MASTER_SECRET` | HKDF for vault encryption. **Do not reuse** as Exchange storage key. |
| `LSB_SIGNATURE_SECRET` | Stego / DNA signature. Rotate in production. |
| `SHARE_HMAC_SECRET` | Smart-link HMAC. |
| `BIOMETRIC_ENCRYPTION_KEY` | Face/voice templates at rest. ≥32 chars. |
| `SUPABASE_URL` | Storage project URL (`vault-files` bucket). |
| `SUPABASE_ANON_KEY` | Supabase anon. |
| `SUPABASE_SERVICE_KEY` | Server-only. Vault uploads. |
| `PUBLIC_APP_URL` | Hub **frontend** origin, never the API host. e.g. `https://www.pinithub.com` |
| `EXCHANGE_APP_URL` | Exchange UI origin. Production fallback if unset: `https://www.pinitexchange.com` |
| `EXCHANGE_API_URL` | Exchange API origin. |
| `EXCHANGE_BRIDGE_SECRET` | Same value as Exchange API. ≥32 chars. |
| `AI_SERVICE_URL` | Python AI sidecar, e.g. `http://ai:8001` on Oracle VCN. |
| `AI_SERVICE_PORT` | `8001` if you start Python on the same box. |

### 1.2 Strongly recommended

| Key | Example / notes |
|-----|-----------------|
| `TEP_SIGNING_SECRET` | Falls back to `LSB_SIGNATURE_SECRET` if unset. |
| `SHARE_PUBLIC_BASE_URL` | Public share/handover host if different from `PUBLIC_APP_URL`. |
| `ADMIN_APP_URL` | Master Admin UI, default `http://localhost:3003`. |
| `ADMIN_BRIDGE_SECRET` | Falls back to `JWT_SECRET`. |
| `RAZORPAY_KEY_ID` | Hub subscriptions. |
| `RAZORPAY_KEY_SECRET` | Hub subscriptions. |
| `RAZORPAY_WEBHOOK_SECRET` | Optional webhook verify. |
| `WEBAUTHN_RP_NAME` | e.g. `PINIT` |
| `WEBAUTHN_RP_ID` | Production domain, e.g. `pinithub.com` (not `localhost`). |
| `WEBAUTHN_ORIGIN` | Full Hub origin, e.g. `https://www.pinithub.com` |
| `WEBAUTHN_REQUIRE_PASSKEY` | `true` / `false` |
| `TIKA_URL` | Document extract, e.g. `http://tika:9998` |
| `LOG_LEVEL` | `info` in production |
| `RATE_LIMIT_WINDOW_MS` | default `900000` |
| `RATE_LIMIT_MAX` | Hub default in code is `2000` if unset |
| `ALLOWED_IMAGE_TYPES` | comma-separated MIME list |
| `ALLOWED_FILE_TYPES` | optional override of accepted MIME list |
| `MAX_FILE_SIZE` | bytes |
| `UPLOAD_TEMP_DIR` | e.g. `/tmp/pinit-uploads` (Oracle disk is ephemeral unless you mount volume) |
| `VAULT_STORAGE_DIR` | local fallback only; production uses Supabase |
| `DNA_SCHEMA_VERSION` | `1.0.0` |
| `DNA_ENGINE_VERSION` | optional override |
| `SUBSCRIPTION_ENFORCEMENT` | `true` / `false` |
| `SUBSCRIPTION_FREE_ASSET_LIMIT` | default `5` |
| `SUBSCRIPTION_BUSINESS_FREE_TEAM_LIMIT` | default `1` |
| `SUBSCRIPTION_BUSINESS_FREE_WORKSPACE_LIMIT` | default `1` |

### 1.3 Feature flags (optional — leave unset unless you need them)

```
SPATIAL_AUTH_ENABLED=false
SPATIAL_AUTH_SECRET=
SPATIAL_AUTH_KEY_ID=spatial-key-v1
SPATIAL_PIXEL_AUTH_ENABLED=false
SPATIAL_HIERARCHY_ENABLED=false
SPATIAL_4X4_AUTH_ENABLED=false
SPATIAL_2X2_AUTH_ENABLED=false
SPATIAL_1X1_AUTH_ENABLED=false
TEP_PROTECTED_DOWNLOAD_ENABLED=true
MONITORING_CRAWLER_ENABLED=
CRAWLER_ENGINE_ENABLED=
YOUTUBE_API_KEY=
GITHUB_TOKEN=
BING_SEARCH_API_KEY=
VAULT_IDENTITY_PIPELINE_ENABLED=
VAULT_INVISIBLE_WATERMARK_ENABLED=
INVISIBLE_WATERMARK_EMBEDDING_ENABLED=
DNA_ENHANCEMENTS_ENABLED=
DNA_PHASE2_ENABLED=
DNA_PHASE3_ENABLED=
PHASE3_SIGNING_SECRET=
PHASE3_ED25519_PRIVATE_KEY_PEM=
PROTECTED_DOWNLOAD_ENABLED=
FFMPEG_PATH=
FFPROBE_PATH=
FPCALC_PATH=
RENDER_EXTERNAL_URL=          # Render keep-alive only; omit on Oracle or replace with Oracle public API URL if you keep a ping
```

DNA layer toggles (all optional): `DNA_L1_BLAKE3`, `DNA_L1_SHA3_512`, `DNA_L1_CHUNK_HASH`, `DNA_L2_MULTI_SCALE`, `DNA_L3_BM_HASH`, `DNA_L3_WAVELET_HASH`, `DNA_L4_LAB`, `DNA_VERIFY_WEIGHTED`, `DNA_VERIFY_TAMPER_CLASS`, `DNA_L11_CLIP`, `DNA_P2_*`, `DNA_P3_*`.

Biometric tuning (optional): `BIOMETRIC_FACE_LOGIN_THRESHOLD`, `BIOMETRIC_FACE_DUPLICATE_THRESHOLD`, `BIOMETRIC_FACE_LOGIN_MARGIN`, `BIOMETRIC_FACE_IDENTIFY_THRESHOLD`, `BIOMETRIC_VOICE_LOGIN_THRESHOLD`, `BIOMETRIC_VOICE_DUPLICATE_THRESHOLD`, `BIOMETRIC_FINGERPRINT_LOGIN_THRESHOLD`, `BIOMETRIC_FINGERPRINT_DUPLICATE_THRESHOLD`, `BIOMETRIC_FUSION_MIN_CONFIDENCE`, `BIOMETRIC_WEIGHT_FACE`, `BIOMETRIC_WEIGHT_VOICE`, `BIOMETRIC_WEIGHT_FINGERPRINT`.

### 1.4 Hub frontend (Vite / Oracle static or Node)

Build-time keys (`VITE_*` are baked into the JS bundle):

| Key | Notes |
|-----|--------|
| `VITE_API_BASE_URL` | **Oracle Hub API** public URL + `/api/v1`. If empty, production build still falls back to Render — **must set this** on Oracle or traffic stays on Render. |
| `VITE_MAPTILER_API_KEY` | Leaflet maps. Restrict HTTP referrers to Hub domains. |
| `VITE_SUPABASE_URL` | Optional; client has a default project URL. |
| `VITE_SUPABASE_ANON_KEY` | Optional anon key. |
| `VITE_PLATFORM_OWNER_SHORT_IDS` | Optional comma-separated PINIT short IDs. |

---

## 2. Pinit Exchange — API + frontend

**Where today:** Exchange app (`pinitexchange.com`) + Express API  
**Env file locally:** `exchange/.env`  
**Oracle:** Exchange API (port **5000**) + Exchange Vite/static UI

### 2.1 Exchange API — required

| Key | Example / notes |
|-----|-----------------|
| `NODE_ENV` | `production` |
| `PORT` | `5000` (or Oracle-injected `PORT`) |
| `HUB_API_URL` | Oracle Hub API, e.g. `https://hub-api.example.com/api/v1` |
| `HUB_APP_URL` | Oracle Hub **UI**, e.g. `https://www.pinithub.com` |
| `EXCHANGE_BRIDGE_SECRET` | **Same as Hub** |
| `EXCHANGE_PUBLIC_URL` | Public Exchange UI origin |
| `EXCHANGE_DATABASE_URL` | `postgresql://…` **required in production**. Schema `exchange`. Do not use SQLite in prod. |
| `EXCHANGE_SUPABASE_URL` | Same Supabase project as Hub is OK |
| `EXCHANGE_SUPABASE_ANON_KEY` | Exchange preview buckets only — **not** Hub vault keys |
| `RAZORPAY_KEY_ID` | Marketplace checkout |
| `RAZORPAY_KEY_SECRET` | Server-only |

### 2.2 Exchange API — optional

| Key | Notes |
|-----|--------|
| `DATABASE_URL` | Used if `EXCHANGE_DATABASE_URL` is empty (still must be `postgresql://` in prod) |
| `SHARE_PUBLIC_BASE_URL` | Licensed share links on Hub domain |
| `RAZORPAY_WEBHOOK_SECRET` | Defaults to `RAZORPAY_KEY_SECRET` if unset |
| `PAYMENT_MOCK` | `1` = mock checkout (do **not** set in live Oracle) |
| `EXCHANGE_SUPABASE_SERVICE_KEY` | Private delivery uploads; prefer SQL-created buckets |
| `EXCHANGE_STRICT_AUTH` | `1` to tighten RBAC |
| `CORS_ALLOWED_ORIGINS` | Comma-separated extra origins |
| `SESSION_SIGNING_SECRET` | Falls back to `EXCHANGE_BRIDGE_SECRET` |
| `PREVIEW_SIGNING_SECRET` | Falls back to bridge secret |
| `HUB_BRIDGE_SECRET` | Alias; prefer `EXCHANGE_BRIDGE_SECRET` |
| `JWT_SECRET` | Last-resort fallback for bridge; set Hub JWT separately |
| `EXCHANGE_FORCE_SQLITE` | **Forbidden in production** |
| `EXCHANGE_ISOLATED_TEST` | Tests only |
| `EXCHANGE_DB_PATH` | Tests only |

### 2.3 Exchange frontend (Vite)

| Key | Notes |
|-----|--------|
| `VITE_HUB_APP_URL` | Hub UI for SSO / “protect in Hub”. Production: live Hub origin. |

Never prefix secrets with `VITE_`.

---

## 3. PINITHUB Landing (and CMS admin)

**Where today:** Vercel (`pinithub-landing`)  
**Env file locally:** `pinithub-landing/.env`  
**Oracle:** Next.js (public landing ± admin). Dual deploy uses **same** `DATABASE_URL` with `schema=landing`.

### 3.1 Required

| Key | Example / notes |
|-----|-----------------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Same Postgres **project** as Hub/Exchange, query `schema=landing`. Do **not** use `public` or `exchange`. |
| `AUTH_SECRET` | ≥32 chars. CMS session signing. |
| `APP_SURFACE` | `public` (marketing only) · `admin` (CMS) · `full` (local) |
| `REVALIDATE_SECRET` | ≥32 chars. **Same value** on public + admin if split. |
| `LANDING_URL` | Public site, no trailing slash, e.g. `https://www.pinithub.com` |
| `SEED_ADMIN_EMAIL` | First CMS user (seed / reset) |
| `SEED_ADMIN_PASSWORD` | Change immediately after first login |
| `SEED_ADMIN_NAME` | Display name |

### 3.2 Optional / routing

| Key | Notes |
|-----|--------|
| `NEXT_PUBLIC_HUB_APP_URL` | Hub link on the landing. Same-domain Hub: `https://www.pinithub.com` |
| `HUB_REWRITE_ORIGIN` | Origin Next rewrites Hub UI from (today: Vercel Hub). Point at **Oracle Hub UI** after move. |
| `NEXT_PUBLIC_HUB_REWRITE_ORIGIN` | Alternate for rewrite origin |
| `NEXT_PUBLIC_DEMO_VIDEO_URL` | Watch-demo video |
| `NEXT_PUBLIC_LANDING_URL` | Fallback if `LANDING_URL` unset |
| `NEXT_PUBLIC_APP_SURFACE` | Public surface flag |
| `RESET_OWNER_PASSWORD` | `true` only for one-off seed password reset |
| `RESET_EMAIL` / `NEW_PASSWORD` | Admin password reset script |

---

## 4. Oracle cutover checklist

1. Provision Postgres (or keep Supabase and only move **compute**). Confirm schemas: `public`, `exchange`, `landing`.
2. Create three secret groups: **Hub API**, **Hub UI**, **Exchange API**, **Exchange UI**, **Landing**.
3. Copy values from current Render/Vercel — then **change public URLs** to Oracle hostnames.
4. Set `VITE_API_BASE_URL` to the **new** Hub API before rebuilding Hub frontend (otherwise production still calls Render).
5. Point Exchange `HUB_API_URL` / `HUB_APP_URL` / `VITE_HUB_APP_URL` at Oracle Hub.
6. Point Landing `HUB_REWRITE_ORIGIN` at Oracle Hub UI.
7. Keep `EXCHANGE_BRIDGE_SECRET` in lockstep on Hub + Exchange; rotate only if you update both at once.
8. Restrict Supabase and Razorpay to new Oracle outbound IPs / domains.
9. Do **not** put Hub `VAULT_MASTER_SECRET` or `SUPABASE_SERVICE_KEY` on Exchange.
10. Smoke: Hub `/api/v1/health`, Hub login, share link, Exchange SSO, Landing home + admin login.

---

## 5. Blank templates (values empty)

### Hub API

```
NODE_ENV=production
PORT=4000
API_PREFIX=/api/v1
DATABASE_URL=
DIRECT_URL=
JWT_SECRET=
VAULT_MASTER_SECRET=
LSB_SIGNATURE_SECRET=
TEP_SIGNING_SECRET=
SHARE_HMAC_SECRET=
BIOMETRIC_ENCRYPTION_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
PUBLIC_APP_URL=
SHARE_PUBLIC_BASE_URL=
EXCHANGE_APP_URL=
EXCHANGE_API_URL=
EXCHANGE_BRIDGE_SECRET=
ADMIN_APP_URL=
ADMIN_BRIDGE_SECRET=
AI_SERVICE_URL=
AI_SERVICE_PORT=8001
TIKA_URL=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
WEBAUTHN_RP_NAME=PINIT
WEBAUTHN_RP_ID=
WEBAUTHN_ORIGIN=
WEBAUTHN_REQUIRE_PASSKEY=false
LOG_LEVEL=info
SUBSCRIPTION_ENFORCEMENT=true
```

### Hub frontend (build)

```
VITE_API_BASE_URL=
VITE_MAPTILER_API_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_PLATFORM_OWNER_SHORT_IDS=
```

### Exchange API

```
NODE_ENV=production
PORT=5000
HUB_API_URL=
HUB_APP_URL=
EXCHANGE_BRIDGE_SECRET=
EXCHANGE_PUBLIC_URL=
EXCHANGE_DATABASE_URL=
EXCHANGE_SUPABASE_URL=
EXCHANGE_SUPABASE_ANON_KEY=
EXCHANGE_SUPABASE_SERVICE_KEY=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
SHARE_PUBLIC_BASE_URL=
CORS_ALLOWED_ORIGINS=
SESSION_SIGNING_SECRET=
```

### Exchange frontend (build)

```
VITE_HUB_APP_URL=
```

### Landing

```
NODE_ENV=production
DATABASE_URL=
AUTH_SECRET=
APP_SURFACE=public
REVALIDATE_SECRET=
LANDING_URL=
NEXT_PUBLIC_HUB_APP_URL=
HUB_REWRITE_ORIGIN=
NEXT_PUBLIC_DEMO_VIDEO_URL=
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
SEED_ADMIN_NAME=
```

---

*Keys taken from repo examples and config. Fill values from current production secret stores. Never paste live secrets into git.*
