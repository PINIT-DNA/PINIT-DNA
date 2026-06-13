# PINIT-DNA — Claude Code Project Rules

## Deployment Synchronization Rule (MANDATORY)

Every change — feature, bug fix, UI, API, database, security, forensics, tracking, monitoring, masking, analytics, or workflow — must follow this sequence before being marked COMPLETE:

1. Verify the change locally
2. Verify backend APIs are functioning correctly
3. Verify database migrations are applied
4. Commit code to Git
5. Push to GitHub (`ashwitha2004/DNA-PINIT-WEB`, branch `main`)
6. Confirm Render backend deployment succeeds
7. Confirm Vercel frontend deployment succeeds
8. Validate the feature on the live Vercel URL (`https://dna-pinit-web.vercel.app`)
9. Confirm live production behaves exactly like localhost
10. Only then mark the task COMPLETE

## Mandatory Verification Checklist

After every task, report:

| Check | Status |
|-------|--------|
| Localhost Tested | ✅ / ❌ |
| Backend API Tested | ✅ / ❌ |
| Database Tested | ✅ / ❌ |
| Git Commit Completed | ✅ / ❌ |
| GitHub Push Completed | ✅ / ❌ |
| Render Deployment Successful | ✅ / ❌ |
| Vercel Deployment Successful | ✅ / ❌ |
| Live URL Tested | ✅ / ❌ |
| No Console Errors | ✅ / ❌ |
| No API Errors | ✅ / ❌ |

## Never Mark Complete Until Working On

- Localhost
- Render Backend (`https://pinit-dna-backend.onrender.com`)
- Vercel Frontend (`https://dna-pinit-web.vercel.app`)
- Production Database (Supabase PostgreSQL)

## After Every Task, Always Provide

- Git commit hash used
- GitHub push status
- Render deployment status
- Vercel deployment status
- Production verification result
- Live URL tested

## Stack Reference

- **Frontend**: React + TypeScript + Tailwind CSS + Vite → deployed on Vercel
- **Backend**: Node.js + Express + TypeScript → deployed on Render (port 4000)
- **Database**: PostgreSQL + Prisma ORM → Supabase
- **File Storage**: Supabase Storage bucket `vault-files`
- **Auth**: JWT stored in `localStorage` as `pinit_access_token`
- **API Base**: `https://pinit-dna-backend.onrender.com/api/v1` (production)
- **Vite proxy**: `/api` → `localhost:4000` (dev only)
- **Authenticated API calls**: use `api` from `client/src/services/dashboard.api.ts` (has JWT interceptor)

## Key Rules

- All authenticated API calls must use the `api` axios instance from `dashboard.api.ts` — never bare `axios` (no auth headers)
- Never use hardcoded `/api/v1/...` paths in frontend — always use `API_BASE_URL` from `api.config.ts`
- Vault files are stored in Supabase Storage — never local disk (Render filesystem is ephemeral)
- Multi-tenant isolation: all Prisma queries must be scoped to `ownerUserId`
- `ShareViewerPage.tsx` is public — no auth headers needed there
