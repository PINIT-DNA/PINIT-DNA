/**
 * Phase 1 Hub portfolio tables.
 * ADDITIVE AND IDEMPOTENT. Safe on every boot.
 * Paired with prisma/migrations/20260905120000_hub_portfolio.
 * Does not drop or rewrite Exchange portfolio_profiles.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-portfolio]', ...a);

function statementsFrom(sql) {
  const parts = [];
  let buf = '';
  let inDo = false;
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!inDo && trimmed.startsWith('--')) continue;
    if (/^DO\s+\$\$/i.test(trimmed)) inDo = true;
    buf += `${line}\n`;
    if (inDo && /END\s+\$\$;/.test(trimmed)) {
      parts.push(buf.trim());
      buf = '';
      inDo = false;
    } else if (!inDo && /;\s*$/.test(trimmed)) {
      parts.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean);
}

(async () => {
  try {
    const file = path.join(__dirname, '..', 'prisma', 'migrations', '20260905120000_hub_portfolio', 'migration.sql');
    const sql = fs.readFileSync(file, 'utf8');
    for (const stmt of statementsFrom(sql)) {
      await prisma.$executeRawUnsafe(stmt);
    }
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "portfolios"`);
    log(`ok — Hub portfolios ready (${n} row${n === 1 ? '' : 's'})`);
  } catch (err) {
    log('WARNING — could not ensure Hub portfolios:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
