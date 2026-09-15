# PINIT-DNA — Database Migrations & Deployment Sequence

**Document type:** Operational reference
**Audience:** Anyone changing the database schema
**Status:** Current as of 2026-08-25
**Read this before adding a table, column, enum or index.**

---

## The one thing to know

**Production does not run `prisma migrate deploy`.**

Schema changes reach production through idempotent `scripts/ensure-*.cjs` scripts
that run on every boot. A migration file alone will **never** reach production.

Every schema change therefore needs **two** artifacts:

| Artifact | Purpose | Runs where |
|---|---|---|
| `prisma/migrations/<ts>_<name>/migration.sql` | Reviewable source of truth, in git | Local / fresh databases |
| `scripts/ensure-<name>.cjs` | What actually applies it | **Production, every boot** |

They contain the same DDL. If you write only one, you have a bug:
write only the migration and production never gets the change; write only the
ensure script and the schema history has a hole.

---

## How it got this way

This is documented rather than tidied away, because the history explains the
constraints and stops the same mistakes recurring.

1. The project was bootstrapped with `prisma db push`, not migrations.
   **49 of 85 tables are created by no migration at all** — including `users`,
   `vault_records`, `certificates`, `share_links` and `notifications`.
2. `prisma/migrations/` was in `.gitignore`, so migration files never reached
   the remote. Only 10 of 26 were tracked, and those only because they predated
   the ignore rule.
3. With nothing to deploy, the team wrote idempotent `ensure-*.cjs` bootstraps
   and chained them into `start:prod`. That mechanism works and is what
   production actually relies on.

The ignore rule was a *symptom*, not the cause. It has been removed and all 26
migrations are now tracked, but that alone does not make `migrate deploy`
usable — see "Why we can't just switch" below.

---

## The production boot sequence

`render.yaml` → `startCommand: npm run render:start` → `start:prod`:

```
normalize-db-env.cjs
  └─ ensure-provenance-table.cjs
  └─ ensure-platform-events.cjs
  └─ ensure-notification-prefs.cjs
  └─ ensure-crawler-tables.cjs
  └─ ensure-extension-auth-codes.cjs
  └─ ensure-webauthn-credentials.cjs
  └─ ensure-asset-linkage.cjs
  └─ ensure-asset-versions.cjs        ← collaboration Phase 1
      └─ mkdir vault/tmp dirs
          └─ node dist/server.js
```

The build step (`buildCommand`) runs `npx prisma generate && npm run build`.
It does **not** touch the database.

---

## Adding a schema change — the checklist

1. **Edit `prisma/schema.prisma`.**
2. **Write the migration by hand** into
   `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`.
   Do **not** run `prisma migrate dev` — see the warning below.
   Make every statement guarded:
   - `CREATE TABLE IF NOT EXISTS`
   - `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - `CREATE TYPE` inside `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
   - `ALTER TYPE … ADD VALUE IF NOT EXISTS` (issue standalone — it cannot run
     inside an explicit transaction on some PG versions)
3. **Apply it locally** without `migrate dev`:
   ```bash
   npx prisma db execute --file prisma/migrations/<dir>/migration.sql --schema prisma/schema.prisma
   npx prisma migrate resolve --applied <dir>
   npx prisma generate
   ```
4. **Write `scripts/ensure-<name>.cjs`** with the same DDL, following
   `scripts/ensure-asset-versions.cjs` as the template. It must:
   - be safe to run on every boot
   - never `DROP`, `RENAME` or `DELETE`
   - never block boot on failure — log a warning and continue, so a feature
     table can never take the whole API down
5. **Chain it into `start:prod`** in `package.json`, after the previous
   ensure script.
6. **Verify** it is idempotent by running it twice against a populated database.
7. Confirm `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma
   --to-schema-datamodel prisma/schema.prisma --script` prints
   `-- This is an empty migration.` (database matches schema).

`scripts/baseline-migrations.cjs` derives its bootstrap list from `start:prod`
automatically, so step 5 also keeps baselining correct. There is nothing to
update there by hand.

---

## ⚠️ Never run `prisma migrate dev` against this database

It detects the pre-existing drift (`clients`, `campaigns`, `campaign_members`
exist but appear in no migration) and **offers to reset the database**.

This database has already been lost once. Use the `db execute` +
`migrate resolve` sequence in step 3 instead.

Also avoid `prisma db push` for new work: it is what created the drift. It
remains in `package.json` as `db:push` for emergencies only.

---

## Why we can't just switch to `migrate deploy`

It is the better long-term answer, but two things block it today:

1. **The history is not replayable.** With 49 tables created by no migration,
   a fresh database cannot be built from `prisma/migrations/` — the first
   migration would `ALTER` tables that do not exist. Fixing this needs a proper
   baseline (`0_init` holding the full current schema) which supersedes the
   existing 26 folders.
2. **Production's migration state is unknown** and cannot be baselined without
   production credentials. If `migrate deploy` ran against a database with no
   `_prisma_migrations` history it fails with **P3005** — and because it would
   sit in the boot chain, that failure would be an outage, not a warning.

`scripts/baseline-migrations.cjs` (`npm run db:baseline`) exists to do step 1
and 2 safely: it applies the ensure-* bootstraps, then marks every migration
folder as applied **without replaying any SQL**. It drops nothing and deletes
nothing.

**Recommended follow-up, when someone has production DB access:**

```bash
# against production, once — no DDL replay, no data touched
npm run db:baseline
npx prisma migrate status     # expect: up to date
```

Only after that is `migrate deploy` safe to add to the boot chain, at which
point the paired `ensure-*.cjs` scripts become belt-and-braces rather than the
primary mechanism.

---

## Verifying nothing was lost

Before any schema work, snapshot the small business tables:

```bash
# writes scripts/backups/… which is gitignored (it contains real user data)
node scripts/db-snapshot.cjs pre-migration
```

Afterwards, confirm row counts have not *dropped*. These are live counts and
rise with normal use — sharing a file adds a `share_links` row, protecting one
adds to `assets` and `dna_records` — so compare against the snapshot you took
minutes earlier, not against a fixed table.

Reference point, 2026-08-25 after the Phase 1 migration:

| Table | Rows |
|---|---|
| `assets` | 6 |
| `asset_versions` | 1 |
| `campaigns` | 1 |
| `clients` | 1 |
| `campaign_members` | 1 |
| `share_links` | 12 |
| `dna_records` | 253 |
| `vault_records` | 25 |
| `certificates` | 13 |

A **decrease** in `dna_records`, `vault_records` or `certificates` is the alarm
signal — those only ever grow in normal operation.

---

---

## Verifying the database before a deploy

`npm run db:audit` runs a read-only audit — SELECTs against `information_schema`
and `pg_catalog` only, no DDL, no writes. It is safe against production.

It checks:

- every table the Prisma schema declares actually exists
- every table this collaboration work added has **both** a migration and an
  ensure script, and that every ensure script is chained into `start:prod`
- every `@@index`, `@@unique` and foreign key declared in the schema exists in
  the database
- nullability and defaults agree between Prisma and Postgres
- migration history and the migrations directory agree

Two findings are expected and benign:

| Finding | Why it is fine |
|---|---|
| 2 rolled-back attempts retained in history | `20260721140000_business_workspace_setup` and `20260721180000_organization_workspace` failed on 2026-07-21 and were rolled back. Prisma keeps the failed attempt alongside the later successful one, which is why `_prisma_migrations` holds 34 rows for 32 directories. `rolled_back_at` is set, so they are resolved and do not block `migrate deploy`. |
| Boot chain does not run `migrate deploy` | By design — see above. The ensure scripts are the route to production. |

A note on `@updatedAt`: a database default on an `updatedAt` column is only drift
when the schema does **not** also declare `@default()`. The biometric template
tables declare `@default(now()) @updatedAt`, so their default is correct;
`campaign_members` declared only `@updatedAt`, so its default was genuine drift
and was removed.

---

## The production baseline — still outstanding, needs credentials

This is the one step that cannot be completed without access to the production
database, and it is a prerequisite for ever using `migrate deploy` there.

**What is needed:** `DIRECT_URL` for the production database (Supabase session
pooler, port 5432 — not the transaction pooler on 6543, which cannot run
`migrate resolve`).

**What to run, once, against production:**

```bash
npm run db:snapshot pre-baseline   # safety copy first
npm run db:baseline                # applies ensure-* bootstraps, then marks
                                   # every migration folder as applied
npx prisma migrate status          # expect: up to date
npm run db:audit                   # expect: PASS
```

`db:baseline` **drops nothing, deletes nothing, and replays no SQL** — it marks
existing migrations as applied so Prisma stops reporting P3005 on a database
that was bootstrapped with `db push`.

**Until that runs**, production continues to get schema changes exclusively
through the `ensure-*.cjs` boot chain, which is proven and idempotent. Nothing is
broken; the baseline simply unlocks `migrate deploy` as an additional, more
conventional route.

## Related

- `docs/BUSINESS_CLIENT_COLLABORATION_BLUEPRINT.md` — the feature these
  migrations support
- `docs/DATABASE_ACCESS.md` — roles and grants
