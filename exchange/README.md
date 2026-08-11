# Pinit Exchange (marketplace app)

Lives beside **Pinit HUB** in the same monorepo — **do not mix into `client/` or `src/`**.

```
Pinit-DNA/
├── client/     ← Hub web (security / vault / DNA)
├── src/        ← Hub API + exchange bridge
└── exchange/   ← this app (commerce only)
```

## Trust boundary

| Hub owns | Exchange owns |
|---|---|
| Identity, face auth, vault, DNA, certificates, monitoring, investigations | Listings, pricing, cart/checkout, orders, licenses, seller desk UI |

Exchange never stores vault keys or DNA engines. Link assets by **`assetId`** only.

## Ports (local)

| App | URL |
|---|---|
| Hub web | http://localhost:3000 |
| Hub API | http://localhost:4000 |
| Exchange web | http://localhost:5174 |
| Exchange API | http://localhost:5000 |

## Run

```bash
# Terminal 1 — Hub
npm run dev

# Terminal 2 — Hub UI
cd client && npm run dev

# Terminal 3 — Exchange
cd exchange && npm install && npm run dev
```

## Seller flows

**Workflow A:** Hub Digital Assets → Add asset to Exchange → set price → Publish.

**Workflow B:** Exchange → List asset → upload file → Hub silently protects (DNA + vault) → Publish listing.

## Buyer flow

Pay (Razorpay when keys set, otherwise mock) → order sealed → Hub prepares licensed delivery → download from My Licenses.

## Payments (Phase 3)

Shared with Hub in local dev: put test keys in the **repo root** `.env` (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`).
Exchange inherits them automatically when `exchange/.env` leaves those blank.

```
# repo root .env (Hub)
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

- `GET /api/orders/billing/config` — shows `provider: razorpay` once keys load
- Without keys → mock pay (still seals licenses)
- Optional force mock: `PAYMENT_MOCK=1`

## API docs

- Swagger UI: http://localhost:5000/api/docs
- Spec: `exchange/server/openapi.yaml`

## Database

| Mode | How |
|---|---|
| **Local / tests (default)** | SQLite → `exchange/server/exchange.db` |
| **Postgres (Supabase)** | Set `EXCHANGE_DATABASE_URL` → schema **`exchange`** on the **same** Hub project (`kqdqmimdqecensurjplh`) |

Hub Prisma tables stay in `public`. Exchange never stores vault masters, DNA layers, or Hub encryption keys. Listings reference Hub via **`assetId`** + bridge APIs.

### Migrate SQLite → Postgres

```bash
# 1) Put EXCHANGE_DATABASE_URL in exchange/.env (Supabase DB URI)
# 2) Apply schema + copy rows (SQLite file is NOT deleted)
cd exchange
npm run migrate:postgres
# 3) Restart Exchange with EXCHANGE_DATABASE_URL set
npm run server
```

Schema SQL: `server/schema/exchange.postgres.sql`  
RLS: `server/schema/exchange.rls.sql`  
Storage buckets SQL: `server/schema/exchange.storage.sql` (`exchange-previews`, `exchange-deliveries` — never `vault-files`)

### Rollback

Unset `EXCHANGE_DATABASE_URL` and restart — Exchange uses SQLite again. Keep `exchange.db` until Postgres is verified.

### Backup

Supabase project backups cover the `exchange` schema with the database. Storage objects in `exchange-previews` / `exchange-deliveries` are separate from DB dumps — retain bucket backups if you store previews there. Hub `vault-files` remains Hub-owned.

## Storage

| Bucket | Purpose |
|---|---|
| `vault-files` | **Hub only** — do not write from Exchange |
| `exchange-previews` | Marketplace-safe previews/thumbnails |
| `exchange-deliveries` | Short-lived licensed staging (prefer Hub delivery redeem for masters) |

## Bridge env (same secret both sides)

```
# Hub .env
EXCHANGE_APP_URL=http://localhost:5174
EXCHANGE_API_URL=http://localhost:5000
EXCHANGE_BRIDGE_SECRET=change_me_exchange_bridge_secret_min_32_chars

# exchange/.env
HUB_API_URL=http://localhost:4000/api/v1
HUB_APP_URL=http://localhost:3000
EXCHANGE_BRIDGE_SECRET=change_me_exchange_bridge_secret_min_32_chars
EXCHANGE_PUBLIC_URL=http://localhost:5174
```

Restart Hub API after changing Hub `.env`.
