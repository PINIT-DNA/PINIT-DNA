# PINITHUB — Landing Page + separate CMS

Public marketing site for **PINITHUB** (platform) featuring **PinIT Hub** (live product).
Content is edited in a **separate admin deploy** so the shareable landing URL does not expose CMS login.

## Brand hierarchy

| Name | Role |
| ---- | ---- |
| **PINITHUB** | Parent platform brand |
| **PinIT Hub** | Live product — protect, prove, share, detect, investigate |
| **PinIT Vault** | Module inside Hub (not a separate live app URL) |
| **PinIT Exchange / Career** | Roadmap — labeled Coming soon |

## Stack

| Concern | Choice |
| ------- | ------ |
| Framework | Next.js 15 (App Router) |
| Database | PostgreSQL (Prisma) |
| Styling | Tailwind CSS v4 |
| Motion | Framer Motion |
| 3D | three.js |

## Local development

```bash
npm install
cp .env.example .env
docker compose up -d          # Postgres on localhost:5434
npm run setup                 # tables + seed
npm run dev                   # http://localhost:3000
```

Local uses `APP_SURFACE=full` so both landing and `/admin` work on one host.

| URL | Purpose |
| --- | ------- |
| http://localhost:3000 | Landing |
| http://localhost:3000/admin/login | CMS (local only) |

Default owner: `admin@pinithub.com` / `ChangeMe!2026` (change after first login).

```bash
npm run db:seed              # owner + empty-table content
npm run db:apply-defaults    # force-replace marketing copy from lib/defaults.ts
npm run db:reset-password    # reset owner password
```

---

## Dual deploy (production)

```
GitHub
  ├─ Vercel project A (landing)  APP_SURFACE=public   → share with anyone
  └─ Vercel project B (admin)    APP_SURFACE=admin    → team only
           └─ same Render Postgres
```

### Landing project env

| Variable | Value |
| -------- | ----- |
| `DATABASE_URL` | Render **External** URL + `?sslmode=require` |
| `APP_SURFACE` | `public` |
| `AUTH_SECRET` | same secret as admin (≥ 32 chars) |
| `REVALIDATE_SECRET` | same secret as admin (cache bust key) |
| `NEXT_PUBLIC_DEMO_VIDEO_URL` | YouTube/Vimeo/ScreenPal/MP4 URL for Watch Platform |

On `public`, `/admin` returns **404**.

### Admin project env

| Variable | Value |
| -------- | ----- |
| `DATABASE_URL` | same Render URL |
| `APP_SURFACE` | `admin` |
| `AUTH_SECRET` | same as landing |
| `REVALIDATE_SECRET` | same as landing |
| `LANDING_URL` | `https://pinit-landing-page.vercel.app` (no trailing slash) |
| `SEED_ADMIN_*` | only needed for seed scripts |

On `admin`, `/` redirects to `/admin`. Share only this URL with editors.

When you save content in admin, it POSTs to `{LANDING_URL}/api/revalidate` so the public site updates immediately. Without these vars, landing can stay stale for up to 1 hour.

### After first deploy / after messaging updates

```powershell
$env:DATABASE_URL="postgresql://...render...?sslmode=require"
npm run db:apply-defaults
```

Then open Admin → edit Hero `videoUrl` if you prefer CMS over env, or set `NEXT_PUBLIC_DEMO_VIDEO_URL`.

### Watch Platform video

1. Set `NEXT_PUBLIC_DEMO_VIDEO_URL` on the **landing** Vercel project, **or**
2. Admin → Content → Hero → `videoUrl` (YouTube / Vimeo / MP4)

---

## Messaging rules (procurement-safe)

- **Available now:** DNA, Vault, Smart Share, monitoring, investigation, Publish Guardian, org workspaces
- **Coming soon:** Exchange, Career, SSO/SCIM, full collaboration, licensing/monetize marketplace
- No placeholder logos, testimonials, or unverified KPIs in defaults

---

## Environment variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `DATABASE_URL` | Yes | Postgres |
| `AUTH_SECRET` | Yes | Session signing |
| `APP_SURFACE` | Prod | `public` \| `admin` \| `full` |
| `REVALIDATE_SECRET` | Dual deploy | Shared secret for landing cache bust |
| `LANDING_URL` | Admin only | Public landing URL (e.g. `https://pinit-landing-page.vercel.app`) |
| `NEXT_PUBLIC_HUB_APP_URL` | Optional | PinIT Hub product URL |
| `NEXT_PUBLIC_DEMO_VIDEO_URL` | Optional | Watch Platform video |
| `SEED_ADMIN_EMAIL` / `PASSWORD` / `NAME` | Seed | Owner account |

Never commit `.env`.

---

## Project structure

```
app/page.tsx            public landing
app/admin/              CMS (blocked when APP_SURFACE=public)
app/api/                demo + newsletter
components/ui/Logo.tsx  official brand mark (public/brand/pinithub-logo.png)
lib/defaults.ts         procurement-safe launch copy
lib/site.ts             Hub URL, video URL, APP_SURFACE
scripts/apply-defaults.ts
middleware.ts           dual-deploy gate + admin auth
```

---

## Troubleshooting

| Issue | Fix |
| ----- | --- |
| Old overselling copy still live | `npm run db:apply-defaults` against production DB |
| Admin edits don’t show on landing | Set `LANDING_URL` + `REVALIDATE_SECRET` on admin, `REVALIDATE_SECRET` on landing, redeploy both |
| Watch Platform does nothing | Set `NEXT_PUBLIC_DEMO_VIDEO_URL` or Hero `videoUrl` |
| `/admin` on public URL | Set `APP_SURFACE=public` and redeploy landing |
| Admin login fails | `npm run db:reset-password` or seed with `RESET_OWNER_PASSWORD=true` |
