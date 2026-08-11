-- Pinit Exchange marketplace schema on the shared Supabase Postgres project.
-- Hub Prisma tables stay in public. Do NOT put vault/DNA tables here.
-- Apply once (SQL Editor or Exchange initDatabase when EXCHANGE_DATABASE_URL is set).

CREATE SCHEMA IF NOT EXISTS exchange;

-- Exchange marketplace profiles (not Hub auth users)
CREATE TABLE IF NOT EXISTS exchange.users (
  pinit_id TEXT PRIMARY KEY,
  exchange_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'creator',
  kyc_status TEXT DEFAULT 'verified',
  biometric_verified SMALLINT DEFAULT 1,
  seller_plan TEXT DEFAULT 'pro',
  bio TEXT,
  password_hash TEXT,
  display_name TEXT,
  creator_type TEXT,
  org_name TEXT,
  account_intent TEXT,
  hub_linked SMALLINT DEFAULT 0,
  onboarding_step TEXT DEFAULT 'complete',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Marketplace-safe Hub asset *references* only (assetId + preview/summary). Not vault masters.
CREATE TABLE IF NOT EXISTS exchange.hub_assets (
  asset_id TEXT PRIMARY KEY,
  pinit_id TEXT NOT NULL,
  title TEXT NOT NULL,
  file_type TEXT NOT NULL,
  vertical TEXT NOT NULL,
  preview_url TEXT,
  vault_encrypted SMALLINT DEFAULT 1,
  dna_record_id TEXT NOT NULL,
  human_percent INTEGER NOT NULL,
  ai_percent INTEGER NOT NULL,
  badge_tier TEXT NOT NULL,
  protection_status TEXT DEFAULT 'protected',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.listings (
  listing_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  pinit_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  vertical TEXT NOT NULL,
  tags TEXT,
  price_personal DOUBLE PRECISION DEFAULT 49,
  price_commercial DOUBLE PRECISION DEFAULT 149,
  price_exclusive DOUBLE PRECISION DEFAULT 899,
  price_enterprise DOUBLE PRECISION DEFAULT 2499,
  ai_training_opt_out SMALLINT DEFAULT 1,
  status TEXT DEFAULT 'live',
  badge_tier TEXT NOT NULL,
  human_percent INTEGER NOT NULL,
  ai_percent INTEGER NOT NULL,
  dna_hash TEXT NOT NULL,
  views INTEGER DEFAULT 142,
  saves INTEGER DEFAULT 18,
  tagline TEXT,
  protection_error TEXT,
  protection_attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.orders_sealed (
  seal_id TEXT PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL,
  listing_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  seller_pinit_id TEXT NOT NULL,
  seller_exchange_id TEXT NOT NULL,
  buyer_pinit_id TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_org TEXT,
  license_tier TEXT NOT NULL,
  price_paid DOUBLE PRECISION NOT NULL,
  platform_fee DOUBLE PRECISION NOT NULL,
  creator_net DOUBLE PRECISION NOT NULL,
  dna_hash_summary TEXT NOT NULL,
  license_terms_version TEXT DEFAULT 'v2.1-provenance',
  status TEXT DEFAULT 'sealed',
  sealed_at TIMESTAMPTZ DEFAULT NOW(),
  delivery_url TEXT,
  delivery_token TEXT,
  payment_status TEXT,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  payment_intent_id TEXT,
  license_status TEXT DEFAULT 'active',
  license_expires_at TEXT,
  delivery_status TEXT DEFAULT 'active',
  delivery_issued_at TEXT,
  delivery_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS exchange.requirements (
  req_id TEXT PRIMARY KEY,
  buyer_name TEXT NOT NULL,
  buyer_org TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  vertical TEXT NOT NULL,
  budget DOUBLE PRECISION NOT NULL,
  deadline TEXT NOT NULL,
  proposals_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.tracking_jobs (
  job_id TEXT PRIMARY KEY,
  seal_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  seller_pinit_id TEXT NOT NULL,
  status TEXT DEFAULT 'active_monitoring',
  matches_found INTEGER DEFAULT 0,
  last_checked TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.cart_items (
  id SERIAL PRIMARY KEY,
  buyer_key TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  license_tier TEXT DEFAULT 'commercial',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (buyer_key, listing_id, license_tier)
);

CREATE TABLE IF NOT EXISTS exchange.wishlist (
  id SERIAL PRIMARY KEY,
  buyer_key TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (buyer_key, listing_id)
);

CREATE TABLE IF NOT EXISTS exchange.reviews (
  id SERIAL PRIMARY KEY,
  listing_id TEXT NOT NULL,
  buyer_pinit_id TEXT,
  buyer_name TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.coupons (
  code TEXT PRIMARY KEY,
  seller_pinit_id TEXT NOT NULL,
  percent_off DOUBLE PRECISION NOT NULL,
  active SMALLINT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.payment_intents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  buyer_key TEXT,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_org TEXT,
  buyer_pinit_id TEXT,
  listing_id TEXT,
  license_tier TEXT,
  cart_snapshot TEXT,
  coupon_code TEXT,
  amount_paise INTEGER NOT NULL,
  currency TEXT DEFAULT 'INR',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.asset_commerce_locks (
  asset_id TEXT PRIMARY KEY,
  lock_type TEXT NOT NULL,
  listing_id TEXT,
  order_id TEXT,
  seal_id TEXT,
  locked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.hub_bridge_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  asset_id TEXT,
  listing_id TEXT,
  order_id TEXT,
  license_id TEXT,
  payload_json TEXT,
  status TEXT DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  next_retry_at TEXT,
  processed_at TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  seal_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange.seller_earnings (
  id TEXT PRIMARY KEY,
  seller_pinit_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  seal_id TEXT NOT NULL,
  gross_amount DOUBLE PRECISION NOT NULL,
  platform_fee DOUBLE PRECISION NOT NULL,
  net_amount DOUBLE PRECISION NOT NULL,
  status TEXT DEFAULT 'accrued',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ex_listings_asset ON exchange.listings (asset_id);
CREATE INDEX IF NOT EXISTS idx_ex_listings_seller_status ON exchange.listings (pinit_id, status);
CREATE INDEX IF NOT EXISTS idx_ex_orders_buyer ON exchange.orders_sealed (buyer_pinit_id);
CREATE INDEX IF NOT EXISTS idx_ex_orders_asset ON exchange.orders_sealed (asset_id);
CREATE INDEX IF NOT EXISTS idx_ex_orders_license_status ON exchange.orders_sealed (license_status);
CREATE INDEX IF NOT EXISTS idx_ex_bridge_events_status ON exchange.hub_bridge_events (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_ex_hub_assets_pinit ON exchange.hub_assets (pinit_id);
CREATE INDEX IF NOT EXISTS idx_ex_cart_buyer ON exchange.cart_items (buyer_key);
CREATE INDEX IF NOT EXISTS idx_ex_wishlist_buyer ON exchange.wishlist (buyer_key);
