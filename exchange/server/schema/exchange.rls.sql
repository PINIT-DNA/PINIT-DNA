-- Row Level Security for exchange.* (defense in depth).
-- Exchange Node uses DATABASE_URL (often bypasses RLS). Backend ownership checks remain mandatory.
-- These policies protect anon/authenticated PostgREST access if tables are ever exposed via Supabase API.

ALTER TABLE exchange.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.hub_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.orders_sealed ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.tracking_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.wishlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.asset_commerce_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.hub_bridge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange.seller_earnings ENABLE ROW LEVEL SECURITY;

-- Public may read published marketplace listings
DROP POLICY IF EXISTS exchange_listings_public_read ON exchange.listings;
CREATE POLICY exchange_listings_public_read ON exchange.listings
  FOR SELECT
  USING (status IN ('published', 'live'));

-- Public may read safe hub asset *references* that underpin published listings
DROP POLICY IF EXISTS exchange_hub_assets_public_read ON exchange.hub_assets;
CREATE POLICY exchange_hub_assets_public_read ON exchange.hub_assets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM exchange.listings l
      WHERE l.asset_id = hub_assets.asset_id
        AND l.status IN ('published', 'live')
    )
  );

-- Public may read reviews on published listings
DROP POLICY IF EXISTS exchange_reviews_public_read ON exchange.reviews;
CREATE POLICY exchange_reviews_public_read ON exchange.reviews
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM exchange.listings l
      WHERE l.listing_id = reviews.listing_id
        AND l.status IN ('published', 'live')
    )
  );

-- Public may read open requirements
DROP POLICY IF EXISTS exchange_requirements_public_read ON exchange.requirements;
CREATE POLICY exchange_requirements_public_read ON exchange.requirements
  FOR SELECT
  USING (status = 'open');

-- Note: seller/buyer scoped write policies via JWT claims are not wired yet
-- (Exchange uses its own auth, not Supabase Auth). Do not expose write via PostgREST
-- without claim mapping. Service role / Exchange API role handles writes.
