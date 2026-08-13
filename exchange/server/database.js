/**
 * Exchange database entry — SQLite (default / tests) or Postgres (EXCHANGE_DATABASE_URL).
 * Hub vault/DNA stays on Hub Prisma public schema; this only owns marketplace tables.
 */
import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createPostgresDatabase, initPostgresSchema } from './drivers/postgres.js';
import { ensureExchangeBuckets } from './lib/exchange-storage.js';
import { toExchangePinitId } from './lib/pinit-identity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Tests / local override: EXCHANGE_FORCE_SQLITE=1 or omit EXCHANGE_DATABASE_URL
const forceSqlite = String(process.env.EXCHANGE_FORCE_SQLITE || '').trim() === '1';
const databaseUrl = forceSqlite ? '' : String(process.env.EXCHANGE_DATABASE_URL || '').trim();
export const dbDriver = databaseUrl ? 'postgres' : 'sqlite';

/** @type {import('sqlite3').Database | ReturnType<typeof createPostgresDatabase>} */
let db;

if (dbDriver === 'postgres') {
  db = createPostgresDatabase(databaseUrl);
} else {
  const dbPath = process.env.EXCHANGE_DB_PATH || join(__dirname, 'exchange.db');
  db = new sqlite3.Database(dbPath);
  db.driver = 'sqlite';
}

export default db;

export function initDatabase() {
  if (dbDriver === 'postgres') {
    return initPostgresDatabase();
  }
  return initSqliteDatabase();
}

async function initPostgresDatabase() {
  await initPostgresSchema(db);
  await seedInitialDataAsync();
  await dedupeMarketplaceListings();
  await normalizeListingIdentities();
  try {
    const buckets = await ensureExchangeBuckets();
    if (!buckets.ok) {
      console.warn('[exchange] Storage buckets:', buckets.reason || JSON.stringify(buckets.results));
    } else {
      console.log('[exchange] Storage buckets ready: exchange-previews, exchange-deliveries');
    }
  } catch (e) {
    console.warn('[exchange] Storage bucket ensure skipped:', e.message);
  }
  console.log('[exchange] Database driver: postgres (schema exchange)');
}

function initSqliteDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          pinit_id TEXT PRIMARY KEY,
          exchange_id TEXT UNIQUE,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          role TEXT DEFAULT 'creator',
          kyc_status TEXT DEFAULT 'verified',
          biometric_verified INTEGER DEFAULT 1,
          seller_plan TEXT DEFAULT 'pro',
          bio TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS hub_assets (
          asset_id TEXT PRIMARY KEY,
          pinit_id TEXT NOT NULL,
          title TEXT NOT NULL,
          file_type TEXT NOT NULL,
          vertical TEXT NOT NULL,
          preview_url TEXT,
          vault_encrypted INTEGER DEFAULT 1,
          dna_record_id TEXT NOT NULL,
          human_percent INTEGER NOT NULL,
          ai_percent INTEGER NOT NULL,
          badge_tier TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS listings (
          listing_id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL,
          pinit_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          vertical TEXT NOT NULL,
          tags TEXT,
          price_personal REAL DEFAULT 49,
          price_commercial REAL DEFAULT 149,
          price_exclusive REAL DEFAULT 899,
          price_enterprise REAL DEFAULT 2499,
          ai_training_opt_out INTEGER DEFAULT 1,
          status TEXT DEFAULT 'live',
          badge_tier TEXT NOT NULL,
          human_percent INTEGER NOT NULL,
          ai_percent INTEGER NOT NULL,
          dna_hash TEXT NOT NULL,
          views INTEGER DEFAULT 142,
          saves INTEGER DEFAULT 18,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS orders_sealed (
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
          price_paid REAL NOT NULL,
          platform_fee REAL NOT NULL,
          creator_net REAL NOT NULL,
          dna_hash_summary TEXT NOT NULL,
          license_terms_version TEXT DEFAULT 'v2.1-provenance',
          status TEXT DEFAULT 'sealed',
          sealed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS requirements (
          req_id TEXT PRIMARY KEY,
          buyer_name TEXT NOT NULL,
          buyer_org TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          vertical TEXT NOT NULL,
          budget REAL NOT NULL,
          deadline TEXT NOT NULL,
          proposals_count INTEGER DEFAULT 0,
          status TEXT DEFAULT 'open',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS tracking_jobs (
          job_id TEXT PRIMARY KEY,
          seal_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          seller_pinit_id TEXT NOT NULL,
          status TEXT DEFAULT 'active_monitoring',
          matches_found INTEGER DEFAULT 0,
          last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Database schema init error:', err);
          return reject(err);
        }
        db.run(`ALTER TABLE listings ADD COLUMN tagline TEXT`, () => {
          db.run(`ALTER TABLE orders_sealed ADD COLUMN delivery_url TEXT`, () => {
            db.run(`ALTER TABLE orders_sealed ADD COLUMN delivery_token TEXT`, () => {
              db.run(`
                CREATE TABLE IF NOT EXISTS cart_items (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  buyer_key TEXT NOT NULL,
                  listing_id TEXT NOT NULL,
                  license_tier TEXT DEFAULT 'commercial',
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE(buyer_key, listing_id, license_tier)
                )
              `, () => {
                db.run(`
                  CREATE TABLE IF NOT EXISTS wishlist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    buyer_key TEXT NOT NULL,
                    listing_id TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(buyer_key, listing_id)
                  )
                `, () => {
                  db.run(`
                    CREATE TABLE IF NOT EXISTS reviews (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      listing_id TEXT NOT NULL,
                      buyer_pinit_id TEXT,
                      buyer_name TEXT NOT NULL,
                      rating INTEGER NOT NULL,
                      comment TEXT,
                      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                  `, () => {
                    db.run(`
                      CREATE TABLE IF NOT EXISTS coupons (
                        code TEXT PRIMARY KEY,
                        seller_pinit_id TEXT NOT NULL,
                        percent_off REAL NOT NULL,
                        active INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                      )
                    `, () => {
                      db.run(`ALTER TABLE orders_sealed ADD COLUMN payment_status TEXT`, () => {
                        db.run(`ALTER TABLE orders_sealed ADD COLUMN razorpay_order_id TEXT`, () => {
                          db.run(`ALTER TABLE orders_sealed ADD COLUMN razorpay_payment_id TEXT`, () => {
                            db.run(`ALTER TABLE orders_sealed ADD COLUMN payment_intent_id TEXT`, () => {
                              db.run(`
                                CREATE TABLE IF NOT EXISTS payment_intents (
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
                                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                )
                              `, () => {
                                applyTrustHardeningSchema()
                                  .then(() => seedInitialDataAsync())
                                  .then(() => dedupeMarketplaceListings())
                                  .then(() => normalizeListingIdentities())
                                  .then(() => {
                                    console.log('[exchange] Database driver: sqlite');
                                    resolve();
                                  })
                                  .catch(reject);
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

function applyTrustHardeningSchema() {
  // SQLite/Postgres column hardening — non-fatal if the column already exists.
  const alters = [
    `ALTER TABLE orders_sealed ADD COLUMN license_status TEXT DEFAULT 'active'`,
    `ALTER TABLE orders_sealed ADD COLUMN license_expires_at TEXT`,
    `ALTER TABLE orders_sealed ADD COLUMN delivery_status TEXT DEFAULT 'active'`,
    `ALTER TABLE orders_sealed ADD COLUMN delivery_issued_at TEXT`,
    `ALTER TABLE orders_sealed ADD COLUMN delivery_expires_at TEXT`,
    `ALTER TABLE listings ADD COLUMN protection_error TEXT`,
    `ALTER TABLE listings ADD COLUMN protection_attempts INTEGER DEFAULT 0`,
    `ALTER TABLE hub_assets ADD COLUMN protection_status TEXT DEFAULT 'protected'`,
    `ALTER TABLE requirements ADD COLUMN buyer_pinit_id TEXT`,
  ];

  const creates = [
    `CREATE TABLE IF NOT EXISTS asset_commerce_locks (
      asset_id TEXT PRIMARY KEY,
      lock_type TEXT NOT NULL,
      listing_id TEXT,
      order_id TEXT,
      seal_id TEXT,
      locked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS hub_bridge_events (
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      seal_id TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS portfolio_profiles (
      pinit_id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      visibility TEXT DEFAULT 'private',
      headline TEXT,
      about TEXT,
      location TEXT,
      cover_url TEXT,
      photo_url TEXT,
      skills TEXT,
      experience TEXT,
      certifications TEXT,
      awards TEXT,
      clients TEXT,
      services TEXT,
      available_for TEXT,
      featured_listing_ids TEXT,
      project_groups TEXT,
      section_visibility TEXT,
      contact_email TEXT,
      contact_note TEXT,
      published_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS seller_earnings (
      id TEXT PRIMARY KEY,
      seller_pinit_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      seal_id TEXT NOT NULL,
      gross_amount REAL NOT NULL,
      platform_fee REAL NOT NULL,
      net_amount REAL NOT NULL,
      status TEXT DEFAULT 'accrued',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_listings_asset ON listings(asset_id)`,
    `CREATE INDEX IF NOT EXISTS idx_listings_seller_status ON listings(pinit_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders_sealed(buyer_pinit_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_asset ON orders_sealed(asset_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_license_status ON orders_sealed(license_status)`,
    `CREATE INDEX IF NOT EXISTS idx_bridge_events_status ON hub_bridge_events(status, next_retry_at)`,
  ];

  return new Promise((resolve) => {
    const runNext = (list, i, done) => {
      if (i >= list.length) return done();
      db.run(list[i], () => runNext(list, i + 1, done));
    };
    runNext(alters, 0, () => {
      runNext(creates, 0, () => {
        db.run(`UPDATE listings SET status = 'published' WHERE status = 'live'`, () => resolve());
      });
    });
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

/** Rewrite older prefix forms (PINIT-M58CDMZU) to PINIT-EX-{code}. */
async function normalizeListingIdentities() {
  try {
    const listings = await allAsync('SELECT listing_id, pinit_id FROM listings');
    for (const row of listings || []) {
      const next = toExchangePinitId(row.pinit_id);
      if (next && next !== row.pinit_id) {
        await runAsync('UPDATE listings SET pinit_id = ? WHERE listing_id = ?', [next, row.listing_id]);
      }
    }
    const assets = await allAsync('SELECT asset_id, pinit_id FROM hub_assets');
    for (const row of assets || []) {
      const next = toExchangePinitId(row.pinit_id);
      if (next && next !== row.pinit_id) {
        await runAsync('UPDATE hub_assets SET pinit_id = ? WHERE asset_id = ?', [next, row.asset_id]);
      }
    }
  } catch (err) {
    console.warn('[exchange] Identity normalize skipped:', err.message);
  }
}

/** One listing per Hub asset. Hide original seed catalog from the live marketplace. */
async function dedupeMarketplaceListings() {
  try {
    await runAsync(
      `UPDATE listings SET status = 'archived'
       WHERE listing_id IN ('L-101','L-102','L-103','L-104','L-105')
         AND status IN ('live','published')`,
    );
    await runAsync(
      `UPDATE listings SET status = 'archived'
       WHERE status IN ('live','published')
         AND (asset_id LIKE 'HA-%' OR pinit_id IN ('PINIT-90481234','PINIT-33109284'))`,
    );

    const live = await allAsync(
      `SELECT listing_id, asset_id, pinit_id, title, created_at
       FROM listings
       WHERE status IN ('live','published')
       ORDER BY created_at DESC`,
    );
    const seenAsset = new Set();
    const seenTitle = new Set();
    for (const row of live || []) {
      const assetKey = String(row.asset_id || '').trim();
      const titleKey = `${String(row.pinit_id || '').trim()}::${String(row.title || '').trim().toLowerCase()}`;
      const dup = (assetKey && seenAsset.has(assetKey)) || seenTitle.has(titleKey);
      if (dup) {
        await runAsync(`UPDATE listings SET status = 'archived' WHERE listing_id = ?`, [row.listing_id]);
        continue;
      }
      if (assetKey) seenAsset.add(assetKey);
      seenTitle.add(titleKey);
    }
  } catch (err) {
    console.warn('[exchange] Listing dedupe skipped:', err.message);
  }
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function seedInitialDataAsync() {
  // Do not insert demo catalog. Marketplace inventory comes from Hub listings only.
  return;
  const row = await getAsync('SELECT COUNT(*) as count FROM users');
  const count = Number(row?.count ?? row?.COUNT ?? 0);
  if (count > 0) return;

  await runAsync(`
    INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan, bio)
    VALUES ('PINIT-90481234', 'PX-772091', 'Elena Rostova', 'elena.rostova@pinit.io', 'creator', 'verified', 1, 'enterprise_pro', 'Award-winning architectural photographer and digital artist creating high-provenance visual assets.')
  `);
  await runAsync(`
    INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan, bio)
    VALUES ('PINIT-33109284', 'PX-441802', 'Marcus Vance', 'marcus.vance@studio.io', 'creator', 'verified', 1, 'pro', 'Cinematographer & 3D Environment Designer specializing in verified virtual production.')
  `);

  const hubAssets = [
    ['HA-9001', 'PINIT-90481234', 'Cybernetic Neo-Tokyo Architecture', 'image', 'images', 'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=800&q=80', 1, 'DNA-9001-A', 95, 5, 'Gold'],
    ['HA-9002', 'PINIT-90481234', 'Nordic Fjord Drone Survey 8K', 'video', 'video', 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80', 1, 'DNA-9002-B', 98, 2, 'Gold'],
    ['HA-9003', 'PINIT-90481234', 'Quantum Computing Core UI Component System', 'ui_ux', 'ui_ux', 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=800&q=80', 1, 'DNA-9003-C', 75, 25, 'Silver'],
    ['HA-9004', 'PINIT-33109284', 'Biomechanical Sculptural Asset 3D', '3d', '3d', 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80', 1, 'DNA-9004-D', 88, 12, 'Silver'],
    ['HA-9005', 'PINIT-33109284', 'Synthwave Soundscapes Audio Suite', 'audio', 'audio', 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=800&q=80', 1, 'DNA-9005-E', 55, 45, 'Bronze'],
  ];
  for (const asset of hubAssets) {
    await runAsync(
      `INSERT INTO hub_assets (asset_id, pinit_id, title, file_type, vertical, preview_url, vault_encrypted, dna_record_id, human_percent, ai_percent, badge_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      asset
    );
  }

  const listings = [
    ['L-101', 'HA-9001', 'PINIT-90481234', 'Cybernetic Neo-Tokyo Architecture', 'Hyper-detailed futuristic cityscape photographed under blue twilight, protected with Pinit HUB file DNA and vault encryption.', 'images', 'cyberpunk,architecture,tokyo,night', 79, 249, 1299, 3499, 1, 'live', 'Gold', 95, 5, '0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d', 342, 45],
    ['L-102', 'HA-9002', 'PINIT-90481234', 'Nordic Fjord Drone Survey 8K', 'Raw 8K aerial footage of Nordic fjords. Protected in Pinit HUB with file DNA and authenticity verification.', 'video', 'drone,fjord,nature,8k', 129, 399, 1899, 4999, 1, 'live', 'Gold', 98, 2, '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d', 289, 38],
    ['L-103', 'HA-9003', 'PINIT-90481234', 'Quantum Computing Core UI Component System', 'Modern glassmorphic dashboard component framework designed for Web3 & enterprise AI consoles.', 'ui_ux', 'ui,react,dashboard,design-system', 59, 189, 899, 2299, 1, 'live', 'Silver', 75, 25, '0x7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c', 512, 84],
    ['L-104', 'HA-9004', 'PINIT-33109284', 'Biomechanical Sculptural Asset 3D', 'High-poly 3D mesh with procedural PBR textures. Biomechanic organic form for game engines & VFX.', '3d', '3d,blender,mesh,biomechanic', 89, 279, 1499, 3899, 1, 'live', 'Silver', 88, 12, '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f', 198, 29],
    ['L-105', 'HA-9005', 'PINIT-33109284', 'Synthwave Soundscapes Audio Suite', 'Lossless WAV stems for ambient electronic music soundtrack, AI-assisted rhythm generation with human analog synths.', 'audio', 'synthwave,music,audio,stems', 49, 149, 699, 1799, 1, 'live', 'Bronze', 55, 45, '0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', 167, 19],
  ];
  for (const item of listings) {
    await runAsync(
      `INSERT INTO listings (listing_id, asset_id, pinit_id, title, description, vertical, tags, price_personal, price_commercial, price_exclusive, price_enterprise, ai_training_opt_out, status, badge_tier, human_percent, ai_percent, dna_hash, views, saves)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item
    );
  }

  const sales = [
    ['SEAL-880192', 'ORD-40192', 'L-101', 'HA-9001', 'PINIT-90481234', 'PX-772091', 'PINIT-BUYER-001', 'Aether Dynamics Corp', 'licensing@aether.com', 'Aether Dynamics', 'commercial', 249.0, 37.35, 211.65, '0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d', 'v2.1-provenance', 'sealed', '2026-08-01 14:30:00'],
    ['SEAL-880193', 'ORD-40193', 'L-103', 'HA-9003', 'PINIT-90481234', 'PX-772091', 'PINIT-BUYER-002', 'Veritas Media Group', 'content@veritas.org', 'Veritas Media', 'personal', 59.0, 8.85, 50.15, '0x7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c', 'v2.1-provenance', 'sealed', '2026-08-04 09:15:00'],
  ];
  for (const sale of sales) {
    await runAsync(
      `INSERT INTO orders_sealed (seal_id, order_id, listing_id, asset_id, seller_pinit_id, seller_exchange_id, buyer_pinit_id, buyer_name, buyer_email, buyer_org, license_tier, price_paid, platform_fee, creator_net, dna_hash_summary, license_terms_version, status, sealed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sale
    );
  }

  const requirements = [
    ['REQ-301', 'Nexus Autonomous Systems', 'Nexus Auto', 'Looking for High-Resolution LiDAR Point Cloud Datasets for Autonomous Driving', 'Need verified real-world sensor point clouds for machine vision benchmarking. Human capture preferred.', 'concepts', 5000.0, '2026-08-20', 4, 'open'],
    ['REQ-302', 'Vanguard Film Studio', 'Vanguard Pictures', 'Cinematic 8K Atmospheric Desert Timelapse Stems', 'Looking for 8K RED or ARRI drone timelapses of desert dunes during blue hour and golden hour.', 'video', 3200.0, '2026-08-15', 7, 'open'],
    ['REQ-303', 'Apex Gaming Infrastructure', 'Apex Games', 'PBR Metallic Surface Texture Packs with File DNA', 'Need 50+ seamless metallic PBR texture maps with verified Pinit HUB file DNA protection.', '3d', 1800.0, '2026-08-25', 2, 'open'],
  ];
  for (const req of requirements) {
    await runAsync(
      `INSERT INTO requirements (req_id, buyer_name, buyer_org, title, description, vertical, budget, deadline, proposals_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req
    );
  }

  await runAsync(`
    INSERT INTO tracking_jobs (job_id, seal_id, asset_id, seller_pinit_id, status, matches_found, last_checked)
    VALUES ('TRACK-501', 'SEAL-880192', 'HA-9001', 'PINIT-90481234', 'active_monitoring', 0, '2026-08-06 12:00:00')
  `);

  if (dbDriver === 'postgres') {
    await runAsync(`UPDATE listings SET status = 'published' WHERE status = 'live'`);
  }
}
