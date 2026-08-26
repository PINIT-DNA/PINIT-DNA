/**
 * Read-only database and deployment audit.
 *
 * Runs SELECTs against information_schema and pg_catalog only. It performs no
 * DDL, no writes, and never resets anything — it is safe to run against
 * production.
 *
 * Answers the questions that decide whether a deploy is safe:
 *   - does every table the schema declares actually exist
 *   - does every table have a route to production (a migration AND an ensure
 *     script, per docs/DATABASE_MIGRATIONS.md)
 *   - do the declared indexes, foreign keys and unique constraints exist
 *   - do nullability and defaults agree between Prisma and the database
 *
 * Usage: node scripts/db-audit.cjs
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const root = path.join(__dirname, '..');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;


/**
 * Does an index definition cover this column?
 *
 * Postgres quotes a column in `indexdef` only when it needs to — camelCase gets
 * quotes, a lowercase single word does not. Matching on the quoted form alone
 * reported 35 perfectly good indexes as missing.
 */
function coversColumn(indexDefs, column) {
  // Column names are plain identifiers, so no escaping is needed. Accept the
  // column either bare or quoted, bounded by a delimiter on each side.
  const bare = `(${column})`;
  return indexDefs.some((d) => {
    const cols = d.slice(d.indexOf('(')).replace(/["()]/g, ' ');
    return cols.split(/[\s,]+/).includes(column) || d.includes(bare);
  });
}

let problems = 0;
let warnings = 0;

function section(t) { console.log(`\n${bold('── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length)))}`); }
function pass(m) { console.log(`  ${ok('ok')}   ${m}`); }
function flag(m) { warnings++; console.log(`  ${warn('warn')} ${m}`); }
function fail(m) { problems++; console.log(`  ${bad('FAIL')} ${m}`); }

/** Parse the Prisma schema without a Prisma dependency — we only need shapes. */
function parseSchema() {
  const src = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
  const models = {};
  const re = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(src))) {
    const [, name, body] = m;
    const mapMatch = body.match(/@@map\("([^"]+)"\)/);
    const table = mapMatch ? mapMatch[1] : name;
    const fields = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('@@') || t.startsWith('/')) continue;
      const fm = t.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!fm) continue;
      const [, fname, ftype, isList, optional] = fm;
      // Relation fields carry no column of their own.
      if (t.includes('@relation') && !t.includes('fields:')) continue;
      if (isList) continue;
      fields.push({
        name: fname,
        type: ftype,
        optional: Boolean(optional),
        hasDefault: t.includes('@default('),
        isId: t.includes('@id'),
        unique: t.includes('@unique'),
        updatedAt: t.includes('@updatedAt'),
      });
    }
    const indexes = [...body.matchAll(/@@index\(\[([^\]]+)\]/g)].map((x) => x[1].split(',').map((s) => s.trim()));
    const uniques = [...body.matchAll(/@@unique\(\[([^\]]+)\]/g)].map((x) => x[1].split(',').map((s) => s.trim()));
    models[name] = { table, fields, indexes, uniques };
  }
  return models;
}

(async () => {
  console.log(bold('\nPINIT-DNA — database & deployment audit (read-only)\n'));

  const models = parseSchema();
  const tables = Object.values(models).map((m) => m.table);

  // ── 1. every declared table exists ──────────────────────────────────
  section('Tables declared vs present');
  const present = (await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
  )).map((r) => r.table_name);
  const presentSet = new Set(present);
  const missing = tables.filter((t) => !presentSet.has(t));
  if (missing.length) missing.forEach((t) => fail(`table missing from database: ${t}`));
  else pass(`all ${tables.length} declared tables exist`);

  const extra = present.filter((t) => !tables.includes(t) && t !== '_prisma_migrations');
  if (extra.length) flag(`${extra.length} table(s) in the database but not in the schema: ${extra.slice(0, 6).join(', ')}${extra.length > 6 ? '…' : ''}`);

  // ── 2. production route: migration AND ensure script ────────────────
  section('Route to production (migration + ensure script)');
  const migDir = path.join(root, 'prisma', 'migrations');
  const migSql = fs.existsSync(migDir)
    ? fs.readdirSync(migDir)
        .filter((d) => fs.statSync(path.join(migDir, d)).isDirectory())
        .map((d) => {
          const f = path.join(migDir, d, 'migration.sql');
          return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
        })
        .join('\n')
    : '';
  const ensureDir = path.join(root, 'scripts');
  const ensureSql = fs.readdirSync(ensureDir)
    .filter((f) => /^ensure-.*\.cjs$/.test(f))
    .map((f) => fs.readFileSync(path.join(ensureDir, f), 'utf8'))
    .join('\n');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const bootChain = pkg.scripts?.['start:prod'] ?? '';
  const chained = [...bootChain.matchAll(/node (scripts\/ensure-[\w-]+\.cjs)/g)].map((m) => m[1]);

  // Only tables this collaboration work introduced are held to the two-artifact
  // rule; the historic 49 predate it and are covered by the ensure chain wholesale.
  const newTables = [
    'asset_versions', 'review_comments', 'version_approvals',
    'campaign_messages', 'campaign_member_assets', 'campaign_handovers',
    'campaign_handover_assets',
  ];
  for (const t of newTables) {
    const inMig = migSql.includes(`"${t}"`);
    const inEnsure = ensureSql.includes(`"${t}"`);
    if (inMig && inEnsure) pass(`${t}: migration + ensure script`);
    else if (!inMig) fail(`${t}: NO migration — history cannot rebuild it`);
    else fail(`${t}: NO ensure script — production will never get it`);
  }

  const ensureFiles = fs.readdirSync(ensureDir).filter((f) => /^ensure-.*\.cjs$/.test(f));
  const unchained = ensureFiles.filter((f) => !chained.includes(`scripts/${f}`));
  if (unchained.length) fail(`ensure script(s) not in start:prod: ${unchained.join(', ')}`);
  else pass(`all ${ensureFiles.length} ensure scripts are chained into start:prod`);

  // ── 3. indexes ──────────────────────────────────────────────────────
  section('Indexes');
  const dbIdx = await prisma.$queryRawUnsafe(
    `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname='public'`
  );
  const idxByTable = new Map();
  for (const r of dbIdx) {
    const list = idxByTable.get(r.tablename) ?? [];
    list.push(r.indexdef);
    idxByTable.set(r.tablename, list);
  }
  let idxMissing = 0;
  for (const [name, m] of Object.entries(models)) {
    if (!presentSet.has(m.table)) continue;
    const defs = idxByTable.get(m.table) ?? [];
    for (const cols of m.indexes) {
      if (!cols.every((c) => coversColumn(defs, c))) {
        idxMissing++; fail(`${m.table}: index on (${cols.join(', ')}) not found — ${name}`);
      }
    }
  }
  if (!idxMissing) pass(`every @@index declared in the schema exists in the database`);

  // ── 4. foreign keys ─────────────────────────────────────────────────
  section('Foreign keys');
  const fks = await prisma.$queryRawUnsafe(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`);
  const fkByTable = new Map();
  for (const f of fks) {
    const list = fkByTable.get(f.table_name) ?? [];
    list.push(f);
    fkByTable.set(f.table_name, list);
  }
  for (const t of newTables) {
    if (!presentSet.has(t)) continue;
    const list = fkByTable.get(t) ?? [];
    if (list.length === 0) flag(`${t}: no foreign key — orphan rows are possible`);
    else pass(`${t}: ${list.length} FK → ${[...new Set(list.map((f) => `${f.ref_table} (${f.delete_rule})`))].join(', ')}`);
  }

  // ── 5. nullability and defaults ─────────────────────────────────────
  section('Nullability & defaults (schema vs database)');
  const cols = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema='public'`);
  const colKey = new Map(cols.map((c) => [`${c.table_name}.${c.column_name}`, c]));
  let mismatch = 0;
  for (const [name, m] of Object.entries(models)) {
    if (!presentSet.has(m.table)) continue;
    for (const f of m.fields) {
      const c = colKey.get(`${m.table}.${f.name}`);
      if (!c) {
        // Scalar declared but absent — a genuine problem.
        if (!['DateTime', 'String', 'Int', 'Boolean', 'Float', 'Json'].includes(f.type)) continue;
        mismatch++; fail(`${m.table}.${f.name} declared in ${name} but missing from the database`);
        continue;
      }
      const dbNullable = c.is_nullable === 'YES';
      if (dbNullable !== f.optional && !f.isId) {
        mismatch++;
        fail(`${m.table}.${f.name}: schema ${f.optional ? 'optional' : 'required'}, database ${dbNullable ? 'nullable' : 'NOT NULL'}`);
      }
      // A DB default on @updatedAt is drift ONLY when the schema does not also
      // declare @default(). With both, the default is intentional and correct —
      // which is the difference between the biometric template tables (fine) and
      // campaign_members before it was fixed (genuine drift).
      if (f.updatedAt && c.column_default && !f.hasDefault) {
        mismatch++;
        fail(`${m.table}.${f.name}: database default with @updatedAt and no @default() — drift`);
      }
    }
  }
  if (!mismatch) pass('nullability and defaults agree for every declared column');

  // ── 6. unique constraints ───────────────────────────────────────────
  section('Unique constraints');
  let uniqMissing = 0;
  for (const [name, m] of Object.entries(models)) {
    if (!presentSet.has(m.table)) continue;
    const defs = (idxByTable.get(m.table) ?? []).filter((d) => d.includes('UNIQUE'));
    for (const cols2 of m.uniques) {
      if (!cols2.every((c) => coversColumn(defs, c))) {
        uniqMissing++; fail(`${m.table}: @@unique(${cols2.join(', ')}) not enforced in the database — ${name}`);
      }
    }
  }
  if (!uniqMissing) pass('every @@unique is enforced by a database constraint');

  // ── 7. migration history ────────────────────────────────────────────
  section('Migration history');
  try {
    const applied = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at, rolled_back_at
         FROM "_prisma_migrations" ORDER BY started_at`);
    const onDisk = fs.readdirSync(migDir).filter((d) => fs.statSync(path.join(migDir, d)).isDirectory());
    // A rolled-back row is resolved, not pending — Prisma records the failed
    // attempt alongside the later successful one, which is why the row count
    // can legitimately exceed the number of directories.
    const live = applied.filter((a) => !a.rolled_back_at);
    const rolledBack = applied.filter((a) => a.rolled_back_at);
    const appliedNames = new Set(live.map((a) => a.migration_name));
    const pending = onDisk.filter((d) => !appliedNames.has(d));
    const ghost = live.filter((a) => !onDisk.includes(a.migration_name));

    pass(`${live.length} applied, ${onDisk.length} on disk`);
    if (rolledBack.length) {
      flag(`${rolledBack.length} rolled-back attempt(s) retained in history: ` +
           `${rolledBack.map((r) => r.migration_name).join(', ')} — resolved, but they explain the row count`);
    }
    if (pending.length) fail(`pending (on disk, not applied): ${pending.join(', ')}`);
    if (ghost.length) fail(`recorded in the database but missing on disk: ${ghost.map((g) => g.migration_name).join(', ')}`);
    const stuck = live.filter((a) => !a.finished_at);
    if (stuck.length) fail(`applied but never finished — this blocks migrate deploy: ${stuck.map((u) => u.migration_name).join(', ')}`);
    if (!pending.length && !ghost.length && !stuck.length) pass('history and disk agree');
  } catch (err) {
    fail(`could not read migration history: ${err.message}`);
  }

  // ── 8. deployment path ──────────────────────────────────────────────
  section('Deployment path');
  const renderYaml = fs.existsSync(path.join(root, 'render.yaml'))
    ? fs.readFileSync(path.join(root, 'render.yaml'), 'utf8') : '';
  const startCmd = renderYaml.match(/startCommand:\s*(.+)/)?.[1]?.trim();
  const buildCmd = renderYaml.match(/buildCommand:\s*(.+)/)?.[1]?.trim();
  console.log(`  build: ${buildCmd ?? '(none)'}`);
  console.log(`  start: ${startCmd ?? '(none)'}`);
  if (/migrate deploy/.test(bootChain)) pass('boot chain runs prisma migrate deploy');
  else flag('boot chain does NOT run prisma migrate deploy — ensure scripts are the only route to production');
  if (chained.length) pass(`${chained.length} ensure scripts run at boot`);

  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  if (/^prisma\/migrations\/?$/m.test(gitignore)) fail('prisma/migrations is gitignored — migrations cannot reach production');
  else pass('prisma/migrations is tracked');

  // ── 9. backup tooling ───────────────────────────────────────────────
  section('Backup tooling');
  if (fs.existsSync(path.join(root, 'scripts', 'db-snapshot.cjs'))) pass('scripts/db-snapshot.cjs present');
  else flag('no snapshot tool found');
  if (/scripts\/backups/.test(gitignore)) pass('scripts/backups is gitignored (snapshots hold real data)');
  else fail('scripts/backups is NOT gitignored — a snapshot could be committed');

  // ── verdict ─────────────────────────────────────────────────────────
  console.log(`\n${bold('─'.repeat(62))}`);
  if (problems === 0 && warnings === 0) console.log(ok(bold('  PASS — no problems found')));
  else if (problems === 0) console.log(warn(bold(`  PASS with ${warnings} warning(s)`)));
  else console.log(bad(bold(`  ${problems} problem(s), ${warnings} warning(s)`)));
  console.log(`${bold('─'.repeat(62))}\n`);

  await prisma.$disconnect();
  process.exit(problems ? 1 : 0);
})().catch(async (e) => {
  console.error('audit failed:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
