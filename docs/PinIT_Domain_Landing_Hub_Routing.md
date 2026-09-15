# pinithub.com — Landing + Hub on one domain

## Goal

| URL | App |
|-----|-----|
| `https://www.pinithub.com` | Marketing landing (this Next.js project) |
| `https://www.pinithub.com/login` | Hub (Vite SPA, proxied) |
| `https://www.pinithub.com/vault` … | Hub routes (proxied) |
| `https://www.pinithub.com/admin` | Landing CMS only |

## How it works

1. **Landing Vercel project** owns `pinithub.com` / `www.pinithub.com`.
2. `vercel.json` **rewrites** Hub paths (`/login`, `/vault`, `/s/:token`, `/static/…`, etc.) to `https://pinit-dna.vercel.app/…` without changing the browser URL.
3. Landing CTAs use `hubLoginUrl()` / `hubSignupUrl()` → same-domain `/login` and `/register/account-type`.

Hub API traffic still goes to Render (`VITE_API_BASE_URL` / default backend). Only the **UI** is proxied under pinithub.com.

## Vercel checklist (one-time)

### A. Landing project (this repo / LandingPage root)

1. Domains → add `www.pinithub.com` and `pinithub.com` (redirect apex → www if you prefer).
2. Env:
   - `NEXT_PUBLIC_HUB_APP_URL` = `https://www.pinithub.com` (or leave empty for relative `/login`)
   - `NEXT_PUBLIC_LANDING_URL` = `https://www.pinithub.com`
   - `APP_SURFACE` = `public` (hides `/admin` on public marketing if desired) or `full`
3. Redeploy after `vercel.json` / `lib/site.ts` changes.

### B. Hub project (`client` / pinit-dna)

1. Keep deploying to `pinit-dna.vercel.app` (rewrite target).
2. Optionally keep `pinithub.com` **removed** from Hub so Landing is the only owner of the domain (required for path routing).
3. Env unchanged for API (Render backend).

### C. DNS

Point `www` (and apex) to the **Landing** Vercel project only — not Hub.

## Local testing

- Landing: `cd pinithub-landing && npm run dev` (often :3000 or :3001)
- Hub: `cd client && npm run dev` on another port
- For same-domain behaviour locally, set `NEXT_PUBLIC_HUB_APP_URL=http://localhost:<hub-port>`

Production path proxy is Vercel-only (`vercel.json` rewrites).

## Conflict note

Landing CMS lives at `/admin` and `/admin/login`. Hub “admin portal” is `/admin-portal` so they do not collide.
