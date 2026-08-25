# Database access — who can do what, and how to test safely

Written after 2026-08-24, when the shared Supabase database was wiped: every
user row was deleted, organizations/clients/campaigns went to zero, and 245 DNA
records were orphaned. The files themselves survived in Supabase Storage and
were recovered, but nothing in the database could be restored, because the
project had no backups.

The cause was structural, not anyone's carelessness: **everyone shared one
database and one owner credential.** Any `prisma migrate reset` or
`db push --force-reset` on any laptop wiped everyone's work. This document
removes that possibility while still letting the whole team test schema changes.

---

## The model

| Environment | Who owns it | What you may do |
|---|---|---|
| **Your own local DB** | you | anything — reset, migrate, seed, drop |
| **Shared Supabase DB** | Ashwitha only | read/write rows; **no** schema changes |

Test everything locally. The shared database only ever receives a migration
that has already been reviewed and merged.

---

## Setting up your local database

Requires Docker Desktop running.

```bash
docker compose -f docker-compose.dev.yml up -d
```

Then in your `.env`:

```bash
DATABASE_URL="postgresql://pinit:pinit@localhost:5435/pinit_hub"
DIRECT_URL="postgresql://pinit:pinit@localhost:5435/pinit_hub"
```

Apply the schema:

```bash
npx prisma migrate deploy   # or: npx prisma db push
npx prisma generate
```

You now own this database completely. `npx prisma migrate reset` is safe here
and affects nobody else.

**Keep vault files local too**, so test uploads don't fill the shared Storage
bucket — leave `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` unset in your `.env`
and the vault writes to `./vault/encrypted` instead.

*(No Docker? Ask for a second free Supabase project instead and use its
connection string in place of the localhost one above. Same rules apply.)*

---

## If you genuinely need the shared database

Use the restricted role — **never** the `postgres` owner credential:

```bash
DATABASE_URL="postgresql://dev_app.<project-ref>:<password>@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
```

Ask Ashwitha for the password. This role can `SELECT`, `INSERT` and `UPDATE`,
and is blocked from `DELETE`, `TRUNCATE`, `DROP` and `CREATE TABLE` — verified
against the live database:

```
DELETE FROM users     -> permission denied for table users
TRUNCATE users        -> permission denied for table users
DROP TABLE users      -> must be owner of table users
CREATE TABLE ...      -> permission denied for schema public
SELECT / UPDATE       -> allowed
```

`prisma migrate reset` and `db push --force-reset` cannot run on this role.

Features that delete rows (removing a vault asset, revoking a share link,
removing a team member) will fail with this role. That is deliberate. Test
those locally, where you have full rights.

---

## Shipping a schema change

1. Change `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <what_changed>` — against your local DB.
3. Verify the app works, then commit the generated folder in
   `prisma/migrations/` along with your code.
4. Open the PR. The migration is reviewed like any other code.
5. **Ashwitha alone** runs `npx prisma migrate deploy` against the shared
   database using the owner credential.

Never point `migrate dev`, `db push`, or `migrate reset` at the shared
database. `migrate dev` and `db push` can drop columns and tables to make the
database match your schema file; `migrate reset` drops everything by design.

---

## Current lockdown

| Role | DELETE / TRUNCATE | Notes |
|---|---|---|
| `anon` | revoked | the public key shipped in frontend JS — it had DELETE **and TRUNCATE on all 85 tables** |
| `authenticated` | revoked | same exposure |
| `dev_app` | never granted | the team's role |
| `service_role` | still granted | server-side key; review separately |
| `postgres` | full | owner — Ashwitha only |

The app is unaffected by these revocations: it reaches Supabase only for file
Storage and talks to Postgres through Prisma as the owner. There are no
PostgREST data calls anywhere in the codebase.

Two items remain, and both need the Supabase dashboard:

- **Rotate the `postgres` password.** Until this is done, every old copy of the
  owner credential still works and the `dev_app` role changes nothing in practice.
- **Enable PITR backups.** This is the difference between a five-minute
  rollback and permanent loss. It was unavailable before; the project is on Pro now.

---

## RLS

33 of 85 tables have row-level security disabled, including `organizations` and
`assets`. That was harmless only because `anon` has now lost DELETE — but
enabling RLS on those tables is still worth doing. Prisma connects as the table
owner and bypasses RLS, so the application is unaffected.
