/**
 * Deletes non-admin Hub accounts and their owned rows, plus Exchange accounts
 * that are not those admins. ADMIN and SUPER_ADMIN accounts are kept.
 *
 * Preview:  node scripts/cleanup-test-users.cjs
 * Execute:  node scripts/cleanup-test-users.cjs --execute
 *
 * Does not change schema, buckets, configuration, or admin accounts.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const EXECUTE = process.argv.includes('--execute');
const INCLUDE_ADMINS = process.argv.includes('--including-super-admins');
const PROTECT_ROLES = ['ADMIN', 'SUPER_ADMIN'];

function hostOf(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || ''}${u.pathname}`;
  } catch {
    return 'unparsed';
  }
}

function readEnvValue(file, key) {
  if (!fs.existsSync(file)) return '';
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function codeOf(shortId) {
  const parts = String(shortId || '').trim().toUpperCase().split('-').filter(Boolean);
  return parts[parts.length - 1] || '';
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

function withIds(sql, ids) {
  const params = [];
  const next = sql.replace(/\$1::text\[\]/g, () => {
    params.push(ids);
    return `$${params.length}::text[]`;
  });
  return { sql: next, params };
}

async function runStep(tx, label, sql, ids, must) {
  const bound = withIds(sql, ids);
  if (!must) await tx.$executeRawUnsafe('SAVEPOINT cleanup_step');
  try {
    const n = Number(await tx.$executeRawUnsafe(bound.sql, ...bound.params)) || 0;
    if (!must) await tx.$executeRawUnsafe('RELEASE SAVEPOINT cleanup_step');
    return { label, n };
  } catch (err) {
    if (must) throw err;
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT cleanup_step');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT cleanup_step');
    const detail = err?.meta?.message || err?.message || 'unknown error';
    console.log(`  skip ${label}: ${String(detail).split('\n')[0]}`);
    return { label, n: 0 };
  }
}

async function keepSnapshot() {
  return prisma.$queryRawUnsafe(`
    SELECT u.id, u."shortId", u.role::text AS role,
           (SELECT COUNT(*)::int FROM dna_records d WHERE d."ownerUserId" = u.id) AS dna,
           (SELECT COUNT(*)::int FROM assets a WHERE a."ownerUserId" = u.id) AS assets,
           (SELECT COUNT(*)::int FROM share_links s WHERE s."ownerUserId" = u.id) AS shares
      FROM users u
     WHERE u.role::text = ANY ($1::text[])
     ORDER BY u."shortId"
  `, PROTECT_ROLES);
}

async function storagePaths(ids) {
  return prisma.$queryRawUnsafe(`
    SELECT v."encryptedFilePath" AS path
      FROM vault_records v
      JOIN dna_records d ON d.id = v."dnaRecordId"
     WHERE d."ownerUserId" = ANY ($1::text[])
    UNION
    SELECT "storagePath" FROM government_id_records WHERE "userId" = ANY ($1::text[])
  `, ids);
}

async function removeStorage(userIds, paths) {
  const url = process.env.SUPABASE_URL || '';
  const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    console.log('STORAGE skipped: Supabase key is not set');
    return [];
  }
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const bucket = supabase.storage.from('vault-files');
  const targets = new Set(paths.filter(Boolean));
  for (const id of userIds) {
    for (const prefix of [id, `government-id/${id}`]) {
      const listed = await bucket.list(prefix, { limit: 1000 });
      if (listed.error) {
        console.log(`  list ${prefix}: ${listed.error.message}`);
        continue;
      }
      for (const entry of listed.data || []) {
        if (!entry?.name || entry.name.includes('..')) continue;
        targets.add(`${prefix}/${entry.name}`);
      }
    }
  }
  const owned = [...targets].filter((p) => userIds.some((id) => p.startsWith(`${id}/`) || p.startsWith(`government-id/${id}/`)));
  if (!owned.length) return [];
  const removed = [];
  for (let i = 0; i < owned.length; i += 50) {
    const batch = owned.slice(i, i + 50);
    const result = await bucket.remove(batch);
    if (result.error) throw new Error(`Storage delete failed: ${result.error.message}`);
    removed.push(...batch);
  }
  return removed;
}

async function cleanExchange(protectCodes) {
  const exchangeUrl = readEnvValue(path.join(__dirname, '..', 'exchange', '.env'), 'EXCHANGE_DATABASE_URL')
    || process.env.EXCHANGE_DATABASE_URL
    || '';
  if (!exchangeUrl) {
    console.log('EXCHANGE skipped: no EXCHANGE_DATABASE_URL');
    return { deletedUsers: [], counts: {} };
  }
  console.log('EXCHANGE', hostOf(exchangeUrl));
  const pg = require(path.join(__dirname, '..', 'exchange', 'node_modules', 'pg'));
  const client = new pg.Client({
    connectionString: exchangeUrl,
    ssl: exchangeUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query('SET search_path TO exchange, public');
    const users = await client.query(`SELECT pinit_id, role, name, email FROM users ORDER BY pinit_id`);
    const drop = users.rows.filter((row) => !protectCodes.has(codeOf(row.pinit_id)));
    const keep = users.rows.filter((row) => protectCodes.has(codeOf(row.pinit_id)));
    console.log('EXCHANGE KEEP', keep.map((r) => r.pinit_id).join(', ') || '(none)');
    console.log('EXCHANGE DELETE', drop.map((r) => `${r.pinit_id} ${r.role} ${r.email || ''}`).join(' | ') || '(none)');
    if (!EXECUTE || !drop.length) return { deletedUsers: drop.map((r) => r.pinit_id), counts: {} };

    const variants = drop.flatMap((row) => {
      const code = codeOf(row.pinit_id);
      return [`PINIT-EX-${code}`, `PINIT-${code}`, `PINIT-USER-${code}`, `PINIT-ORG-${code}`, row.pinit_id];
    });
    const columns = await client.query(`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'exchange'
         AND column_name IN ('pinit_id', 'buyer_pinit_id', 'seller_pinit_id', 'buyer_key', 'creator_pinit_id')
       ORDER BY table_name, column_name
    `);
    const counts = {};
    await client.query('BEGIN');
    try {
      const tables = [...new Set(columns.rows.map((r) => r.table_name))].filter((t) => t !== 'users');
      for (const table of tables) {
        const cols = columns.rows.filter((r) => r.table_name === table).map((r) => r.column_name);
        const where = cols.map((col) => `"${col}" = ANY ($1::text[])`).join(' OR ');
        const result = await client.query(`DELETE FROM "${table}" WHERE ${where}`, [variants]);
        if (result.rowCount) counts[table] = result.rowCount;
      }
      const usersDeleted = await client.query(`DELETE FROM users WHERE pinit_id = ANY ($1::text[])`, [variants]);
      counts.users = usersDeleted.rowCount;
      const bridges = await client.query(`
        DELETE FROM hub_bridge_events e
         WHERE NOT (
           (COALESCE(e.listing_id, '') <> '' AND EXISTS (SELECT 1 FROM listings l WHERE l.listing_id = e.listing_id))
           OR (COALESCE(e.order_id, '') <> '' AND EXISTS (SELECT 1 FROM orders_sealed o WHERE o.order_id = e.order_id OR o.seal_id = e.order_id))
           OR (COALESCE(e.asset_id, '') <> '' AND EXISTS (SELECT 1 FROM hub_assets a WHERE a.asset_id = e.asset_id))
         )
      `);
      if (bridges.rowCount) counts.hub_bridge_events = bridges.rowCount;
      const kept = await client.query(
        `SELECT pinit_id FROM users WHERE pinit_id = ANY ($1::text[])`,
        [keep.map((r) => r.pinit_id)],
      );
      if (keep.length && kept.rowCount !== keep.length) {
        throw new Error('Protected Exchange account was removed. Rolling back.');
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return { deletedUsers: drop.map((r) => r.pinit_id), counts };
  } finally {
    await client.end();
  }
}

async function main() {
  console.log(EXECUTE ? 'EXECUTE' : 'PREVIEW ONLY');
  console.log('HUB', hostOf(process.env.DIRECT_URL || process.env.DATABASE_URL || ''));

  const users = await prisma.$queryRawUnsafe(`
    SELECT id, "shortId", email, role::text AS role, "fullName"
      FROM users
     ORDER BY role, "shortId"
  `);
  const keep = INCLUDE_ADMINS ? [] : users.filter((u) => PROTECT_ROLES.includes(u.role));
  const drop = INCLUDE_ADMINS ? users : users.filter((u) => !PROTECT_ROLES.includes(u.role));
  if (!INCLUDE_ADMINS && !keep.length) throw new Error('No ADMIN or SUPER_ADMIN account exists. Cleanup stopped.');
  if (!INCLUDE_ADMINS && drop.some((u) => PROTECT_ROLES.includes(u.role))) {
    throw new Error('Protected role entered the delete list.');
  }

  console.log('\nKEEP');
  for (const u of keep) console.log(`  ${u.role} ${u.shortId} ${u.email || '(no email)'} ${u.fullName}`);
  console.log('DELETE');
  for (const u of drop) console.log(`  ${u.role} ${u.shortId} ${u.email || '(no email)'} ${u.fullName} ${u.id}`);

  const ids = drop.map((u) => u.id);
  const before = await keepSnapshot();
  console.log('PROTECTED COUNTS BEFORE', JSON.stringify(before));
  const paths = ids.length ? (await storagePaths(ids)).map((r) => r.path) : [];
  console.log('STORAGE OBJECTS', paths.length);
  for (const p of paths) console.log(`  ${p}`);

  const protectCodes = new Set(keep.map((u) => codeOf(u.shortId)));
  if (!EXECUTE) {
    await cleanExchange(protectCodes);
    console.log('\nPreview only. Re-run with --execute to delete.');
    return;
  }
  if (!ids.length) {
    console.log('No Hub test users.');
  } else {
    const deleted = await prisma.$transaction(async (tx) => {
      const steps = [];
      steps.push(await runStep(tx, 'government_id_records', `DELETE FROM government_id_records WHERE "userId" = ANY ($1::text[])`, ids, true));
      steps.push(await runStep(tx, 'identity_verification_runs', `DELETE FROM identity_verification_runs WHERE "userId" = ANY ($1::text[])`, ids, false));
      steps.push(await runStep(tx, 'identity_document_fingerprints', `DELETE FROM identity_document_fingerprints WHERE "userId" = ANY ($1::text[])`, ids, false));
      steps.push(await runStep(tx, 'audit_events', `DELETE FROM audit_events WHERE "userId" = ANY ($1::text[]) OR "dnaRecordId" IN (SELECT id FROM dna_records WHERE "ownerUserId" = ANY ($1::text[]))`, ids, false));
      steps.push(await runStep(tx, 'feature_entitlements', `DELETE FROM feature_entitlements WHERE "userId" = ANY ($1::text[])`, ids, false));
      steps.push(await runStep(tx, 'layer_score_observations', `DELETE FROM layer_score_observations WHERE "dnaRecordId" IN (SELECT id FROM dna_records WHERE "ownerUserId" = ANY ($1::text[]))`, ids, false));
      steps.push(await runStep(tx, 'forensic_provenance_events', `DELETE FROM forensic_provenance_events WHERE "dnaRecordId" IN (SELECT id FROM dna_records WHERE "ownerUserId" = ANY ($1::text[]))`, ids, false));
      steps.push(await runStep(tx, 'evidence_records', `DELETE FROM evidence_records WHERE "ownerUserId" = ANY ($1::text[])`, ids, false));
      steps.push(await runStep(tx, 'investigation_probe_thumbnails', `DELETE FROM investigation_probe_thumbnails WHERE "ownerUserId" = ANY ($1::text[])`, ids, false));
      steps.push(await runStep(tx, 'client_reports', `DELETE FROM client_reports WHERE "generatedByUserId" = ANY ($1::text[]) OR "organizationId" IN (SELECT id FROM organizations WHERE "ownerUserId" = ANY ($1::text[]))`, ids, false));
      steps.push(await runStep(tx, 'incidents', `DELETE FROM incidents WHERE "openedByUserId" = ANY ($1::text[]) OR "assignedToUserId" = ANY ($1::text[]) OR "dnaRecordId" IN (SELECT id FROM dna_records WHERE "ownerUserId" = ANY ($1::text[])) OR "shareLinkId" IN (SELECT id FROM share_links WHERE "ownerUserId" = ANY ($1::text[]))`, ids, false));
      const unlink = withIds(`UPDATE share_links SET "parentLinkId" = NULL WHERE "parentLinkId" IN (SELECT id FROM share_links WHERE "ownerUserId" = ANY ($1::text[]))`, ids);
      await tx.$executeRawUnsafe(unlink.sql, ...unlink.params);
      steps.push(await runStep(tx, 'share_links', `DELETE FROM share_links WHERE "ownerUserId" = ANY ($1::text[])`, ids, true));
      steps.push(await runStep(tx, 'certificates', `DELETE FROM certificates WHERE "ownerUserId" = ANY ($1::text[])`, ids, true));
      steps.push(await runStep(tx, 'security_events', `DELETE FROM security_events WHERE "userId" = ANY ($1::text[])`, ids, true));
      steps.push(await runStep(tx, 'dna_records', `DELETE FROM dna_records WHERE "ownerUserId" = ANY ($1::text[])`, ids, true));
      const userDelete = INCLUDE_ADMINS
        ? await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = ANY ($1::text[])`, ids)
        : await tx.$executeRawUnsafe(
          `DELETE FROM users WHERE id = ANY ($1::text[]) AND role::text <> ALL ($2::text[])`,
          ids,
          PROTECT_ROLES,
        );
      steps.push({ label: 'users', n: Number(userDelete) || 0 });

      const still = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM users WHERE id = ANY ($1::text[])`, ids);
      if (still[0].n !== 0) throw new Error('Selected users are still present inside the transaction.');
      if (!INCLUDE_ADMINS) {
        const protectedLeft = await tx.$queryRawUnsafe(
          `SELECT id, "shortId" FROM users WHERE role::text = ANY ($1::text[]) ORDER BY "shortId"`,
          PROTECT_ROLES,
        );
        const beforeIds = before.map((u) => u.id).sort().join();
        const afterIds = protectedLeft.map((u) => u.id).sort().join();
        if (beforeIds !== afterIds) throw new Error('Protected Hub accounts changed. Rolling back.');
      }
      return steps;
    }, { timeout: 180000, maxWait: 20000 });

    for (const step of deleted) {
      if (step.n) console.log(`  deleted ${step.label}: ${step.n}`);
    }
  }

  if (!INCLUDE_ADMINS) {
    const after = await keepSnapshot();
    console.log('PROTECTED COUNTS AFTER', JSON.stringify(after));
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Protected account data changed after cleanup.');
    }
  }
  const left = await prisma.$queryRawUnsafe(`SELECT role::text AS role, COUNT(*)::int AS n FROM users GROUP BY role ORDER BY role`);
  console.log('USERS NOW', JSON.stringify(left));

  const removed = await removeStorage(ids, paths);
  console.log('STORAGE DELETED', removed.length);
  for (const p of removed) console.log(`  ${p}`);

  const exchange = await cleanExchange(protectCodes);
  console.log('EXCHANGE DELETED USERS', exchange.deletedUsers.join(', ') || '(none)');
  console.log('EXCHANGE COUNTS', JSON.stringify(exchange.counts));
}

main()
  .catch((err) => {
    console.error('CLEANUP FAILED', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
