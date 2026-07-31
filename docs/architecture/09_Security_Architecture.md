# 09 — Security Architecture

Based on middleware, auth services, vault encryption, and config as implemented.

---

## 1. Authentication

| Mechanism | Implementation |
|-----------|----------------|
| ShortId login | `POST /auth/login` → JWT pair |
| Account create | Auto-generated `PINIT-` shortId |
| Face biometric | `/auth/face/*` with encrypted templates |
| Extension OAuth | One-time codes → token exchange |
| Session continuity | Refresh tokens in `refresh_tokens` table |

Access JWT payload: `sub` (user id), `shortId`, `name`, `role`.  
TTL: access **7d**, refresh **30d** (`auth.service.ts`).

Frontend stores tokens in **`localStorage`** (`pinit_access_token`, `pinit_refresh_token`) — not httpOnly cookies for API auth.

---

## 2. Authorization

Defense in depth:

1. **JWT required** (`requireAuth`) for protected routes  
2. **Role gates** — `ADMIN`, `SUPER_ADMIN`, `requireAdminOrSuper`  
3. **Ownership** — DNA/vault/share/monitor/certificate/alert scoped to `ownerUserId`  
4. **Feature entitlements** — `requireFeature(FeatureKey.*)`  
5. **Org RBAC** — OWNER/MANAGER/INVESTIGATOR/MEMBER/VIEWER in organization services  
6. **Platform owner shortId** — Super Admin UI/API alignment  

Unauthenticated surfaces are intentional: health, some share token routes, certificate verify, evidence verify, DNA supported-types, AI/Tika health, face login/register.

---

## 3. JWT

- Library: `jsonwebtoken`
- Secret: `JWT_SECRET` → `config.jwt.secret` (dev default exists — **must rotate in production**)
- Verification: `authService.verifyAccess`
- Transport: `Authorization: Bearer` or SSE `?token=`

---

## 4. Cookies

**Not used as the primary API auth mechanism.**

- API auth is Bearer tokens in headers / localStorage.
- Supabase browser client may persist its own session key `pinit_supabase_session` for connectivity checks — separate from Hub JWT auth.
- CORS sets `credentials: true`, but cookie-session auth for the Node API is **not implemented**.

---

## 5. Encryption

| Data | Algorithm / approach |
|------|----------------------|
| Vault file blobs | AES-256-GCM with HKDF-derived keys from `VAULT_MASTER_SECRET` |
| Biometric templates | Encrypted at rest using `BIOMETRIC_ENCRYPTION_KEY` |
| LSB / stego signatures | `LSB_SIGNATURE_SECRET` |
| Share HMAC | `SHARE_HMAC_SECRET` |
| TEP signing | `TEP_SIGNING_SECRET` (fallback to LSB secret) |
| Phase 3 signed reports | `PHASE3_SIGNING_SECRET` / optional Ed25519 PEM when enabled |

TLS termination is expected at Render/Vercel/reverse proxy — not terminated inside Express.

---

## 6. Password hashing

- Profile supports `PUT /profile/password` (bcryptjs is a dependency).
- **Primary login is shortId (+ face), not password.**
- Do not assume every `User` has a password hash populated.

---

## 7. File security

- Uploads land in temp dir then processed; cron cleans stale `dna_*` temps.
- Vault objects stored encrypted; plaintext not kept as the durable vault form.
- Protected download / TEP paths add recipient tracking manifests when enabled.
- Ownership middleware prevents cross-tenant vault/DNA access on owned routes.
- Multer size limits + supported MIME matrix; large media routes raise limits (up to 500MB for some asset/extension paths).
- Public share file access still enforces link policy (expiry, OTP, blocks) in share services.

---

## 8. Secrets

Managed via environment variables (Render sync:false / generateValue where configured). Critical secrets:

`JWT_SECRET`, `VAULT_MASTER_SECRET`, `LSB_SIGNATURE_SECRET`, `TEP_SIGNING_SECRET`, `SHARE_HMAC_SECRET`, `BIOMETRIC_ENCRYPTION_KEY`, `SUPABASE_SERVICE_KEY`, `RAZORPAY_KEY_SECRET`, crawler API keys, Phase3 signing materials.

**Never commit `.env`.** Rotate vault master secret only with a re-encryption plan (`render.yaml` comments warn about this).

---

## 9. Environment variables

See `.env.example` and `10_Deployment_Architecture.md`. Config centralization: `src/config/index.ts` (+ feature modules). Prefer not reading `process.env` ad hoc in controllers.

---

## 10. CORS

Implemented in `app.ts`:

Allowed when origin includes localhost, 127.0.0.1, ngrok hosts, `vercel.app`, `pinithub.com`, `chrome-extension://`, `extension://`, or exact match in `ALLOWED_ORIGIN` / `ALLOWED_ORIGINS`.

Denied origins log a warning and fail CORS (not 500). No-origin requests allowed (server-to-server / curl).

---

## 11. Helmet

`helmet({ contentSecurityPolicy: false })` enabled for standard security headers; CSP explicitly disabled (SPA / inline needs).

---

## 12. Rate limiting

- Global `express-rate-limit` using `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` (config defaults window 15m, max 2000).
- **Skipped entirely when `NODE_ENV !== 'production'`.**
- Also skipped for health/ping and GET `/api/v1/share/*`.
- Separate `biometricLimiter` on face register/login routes.

---

## 13. Input validation

- Ad-hoc checks in controllers (required fields, enums).
- Zod used on DNA verify body.
- File type detection after upload.
- **No global Zod validation middleware** across all routes.

---

## 14. SQL injection protection

- Dominant path: Prisma query API (parameterized).
- Raw SQL (`$queryRaw` / `$executeRaw`) uses tagged template parameterization in auth helpers.
- Avoid concatenating user input into raw SQL in new code.

---

## 15. XSS protection

- React escapes text content by default in UI.
- Share OG HTML injection path replaces `</head>` with title/description — values are quote-escaped for attributes in `app.ts`.
- Helmet without CSP means CSP-based XSS mitigation is **not** enforced at the API layer.
- Clients should treat any `dangerouslySetInnerHTML` usage carefully (audit when adding).

---

## 16. CSRF

**Not implemented as a dedicated CSRF token middleware.**

Mitigations relied upon:

- Authorization via Bearer token from localStorage (not cookie-auth for API)
- CORS origin allowlist

If cookie-based auth is introduced later, CSRF tokens would be required — currently N/A for primary API auth.

---

## 17. Additional notes

| Topic | Status |
|-------|--------|
| Email OTP delivery | Not implemented (OTP generated; no SMTP) |
| Redis-backed rate limit store | Not implemented (in-memory default of express-rate-limit) |
| WAF | Not in repo (would be external to Render/Vercel) |
