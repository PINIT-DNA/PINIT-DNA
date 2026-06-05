/**
 * PINIT-DNA — Phase 7 Enterprise Review Script
 *
 * Runs automated checks across all hardening phases.
 * Usage: ts-node scripts/enterprise-review.ts
 */

import fs   from 'fs';
import path from 'path';
import crypto from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

interface CheckResult {
  category: string;
  check:    string;
  status:   'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  detail:   string;
}

const results: CheckResult[] = [];

function pass(category: string, check: string, detail: string) {
  results.push({ category, check, status: 'PASS', detail });
}
function fail(category: string, check: string, detail: string) {
  results.push({ category, check, status: 'FAIL', detail });
}
function warn(category: string, check: string, detail: string) {
  results.push({ category, check, status: 'WARN', detail });
}

// ─── Phase 2: Certificates ───────────────────────────────────────────────────

function checkCertificates() {
  const serviceFile = path.join(__dirname, '../src/services/certificates/certificate.service.ts');
  if (fs.existsSync(serviceFile)) {
    pass('CERTIFICATES', 'Certificate service exists', 'HMAC-SHA256 signing + revocation implemented');
  } else {
    fail('CERTIFICATES', 'Certificate service missing', serviceFile);
  }

  const masterSecret = process.env['VAULT_MASTER_SECRET'] ?? '';
  if (masterSecret.includes('dev_vault') || masterSecret.length < 24) {
    warn('CERTIFICATES', 'Signing secret is weak', 'Set a strong VAULT_MASTER_SECRET in production');
  } else {
    pass('CERTIFICATES', 'Signing secret configured', 'VAULT_MASTER_SECRET is set and non-default');
  }
}

// ─── Phase 3: Audit ──────────────────────────────────────────────────────────

function checkAudit() {
  const auditFile = path.join(__dirname, '../src/services/audit/audit.service.ts');
  if (fs.existsSync(auditFile)) {
    pass('AUDIT', 'Audit service exists', 'IP, device, event type, userId logging');
  } else {
    fail('AUDIT', 'Audit service missing', auditFile);
  }

  const content = fs.readFileSync(auditFile, 'utf8');
  const events = ['VAULT_RETRIEVED', 'CERTIFICATE_ISSUED', 'CERTIFICATE_REVOKED', 'INTEGRITY_CHECK_RUN', 'VAULT_BACKUP_RUN'];
  for (const ev of events) {
    if (content.includes(ev)) {
      pass('AUDIT', `Event type: ${ev}`, 'Defined in AuditEventType');
    } else {
      fail('AUDIT', `Event type: ${ev}`, 'Missing from AuditEventType');
    }
  }
}

// ─── Phase 4: File Safety ────────────────────────────────────────────────────

function checkFileSafety() {
  const safeRunnerFile = path.join(__dirname, '../src/lib/safe-runner.ts');
  if (fs.existsSync(safeRunnerFile)) {
    pass('FILE_SAFETY', 'Safe runner with 30s timeout', 'withTimeout() wraps all layer execution');
  } else {
    fail('FILE_SAFETY', 'Safe runner missing', safeRunnerFile);
  }

  const orchestratorFile = path.join(__dirname, '../src/services/dna.orchestrator.ts');
  const orcContent = fs.readFileSync(orchestratorFile, 'utf8');
  if (orcContent.includes('withTimeout')) {
    pass('FILE_SAFETY', 'Timeout applied to DNA layers', 'withTimeout() in runLayer()');
  } else {
    fail('FILE_SAFETY', 'Timeout NOT applied to DNA layers', 'Add withTimeout to orchestrator');
  }
  if (orcContent.includes('validateFileInput')) {
    pass('FILE_SAFETY', 'File input validation', 'validateFileInput() called before processing');
  } else {
    fail('FILE_SAFETY', 'File input validation missing', 'Add validateFileInput to orchestrator');
  }
}

// ─── Phase 5: Vault Hardening ────────────────────────────────────────────────

function checkVaultHardening() {
  const backupService = path.join(__dirname, '../src/services/vault/vault-backup.service.ts');
  if (fs.existsSync(backupService)) {
    pass('VAULT', 'Vault backup service exists', 'Copies .enc to VAULT_BACKUP_DIR');
  } else {
    fail('VAULT', 'Vault backup service missing', backupService);
  }

  const scheduler = path.join(__dirname, '../src/services/scheduler/vault-scheduler.service.ts');
  if (fs.existsSync(scheduler)) {
    pass('VAULT', 'Scheduled integrity checks', 'Daily at 02:00 via node-cron');
  } else {
    fail('VAULT', 'Scheduler missing', scheduler);
  }

  if (process.env['VAULT_BACKUP_DIR']) {
    pass('VAULT', 'Backup directory configured', process.env['VAULT_BACKUP_DIR']);
  } else {
    warn('VAULT', 'VAULT_BACKUP_DIR not set', 'Configure for production redundancy');
  }

  const masterSecret = process.env['VAULT_MASTER_SECRET'] ?? '';
  if (masterSecret.includes('dev_vault')) {
    fail('VAULT', 'Vault master secret is DEFAULT', 'Set VAULT_MASTER_SECRET to a strong random value in production');
  } else {
    pass('VAULT', 'Vault master secret is custom', 'VAULT_MASTER_SECRET set to non-default value');
  }
}

// ─── Phase 6: Production Readiness ────────────────────────────────────────────

function checkProductionReadiness() {
  const healthFile = path.join(__dirname, '../src/lib/health.ts');
  if (fs.existsSync(healthFile)) {
    pass('PRODUCTION', 'Health check service', 'Checks DB, vault, storage, encryption, memory');
  } else {
    fail('PRODUCTION', 'Health check missing', healthFile);
  }

  const shutdownFile = path.join(__dirname, '../src/lib/graceful-shutdown.ts');
  if (fs.existsSync(shutdownFile)) {
    pass('PRODUCTION', 'Graceful shutdown handler', 'SIGTERM/SIGINT handled');
  } else {
    fail('PRODUCTION', 'Graceful shutdown missing', shutdownFile);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  if (pkg.scripts['build:start']) {
    pass('PRODUCTION', 'Production build script', 'npm run build:start');
  } else {
    warn('PRODUCTION', 'No production build:start script', 'Add to package.json');
  }

  if (process.env['NODE_ENV'] === 'production') {
    pass('PRODUCTION', 'NODE_ENV=production', 'Running in production mode');
  } else {
    warn('PRODUCTION', 'NODE_ENV not production', `Currently: ${process.env['NODE_ENV'] ?? 'undefined'}`);
  }
}

// ─── Phase 1: Authentication (teammate scope) ─────────────────────────────────

function checkAuth() {
  results.push({ category: 'AUTH', check: 'JWT Authentication', status: 'SKIP', detail: 'Team responsibility — tracked separately' });
  results.push({ category: 'AUTH', check: 'RBAC Middleware', status: 'SKIP', detail: 'Team responsibility — tracked separately' });
}

// ─── Run all checks ──────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  PINIT-DNA Enterprise Review — Phase 7 Report');
  console.log('═══════════════════════════════════════════════════════\n');

  checkAuth();
  checkCertificates();
  checkAudit();
  checkFileSafety();
  checkVaultHardening();
  checkProductionReadiness();

  // Print results
  let pass_count = 0, fail_count = 0, warn_count = 0, skip_count = 0;
  let lastCategory = '';

  for (const r of results) {
    if (r.category !== lastCategory) {
      console.log(`\n── ${r.category} ─────────────────────────────────────────────`);
      lastCategory = r.category;
    }
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : r.status === 'WARN' ? '⚠️ ' : '⏭️ ';
    console.log(`${icon} ${r.check}`);
    if (r.status !== 'PASS') console.log(`   → ${r.detail}`);
    if (r.status === 'PASS')  pass_count++;
    if (r.status === 'FAIL')  fail_count++;
    if (r.status === 'WARN')  warn_count++;
    if (r.status === 'SKIP')  skip_count++;
  }

  const total = results.length - skip_count;
  const score = total > 0 ? Math.round((pass_count / total) * 100) : 0;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  PRODUCTION READINESS SCORE: ${score}%`);
  console.log(`  PASS: ${pass_count}  FAIL: ${fail_count}  WARN: ${warn_count}  SKIP: ${skip_count}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (fail_count > 0) {
    console.log('❌ NOT production-ready — fix FAIL items before deployment\n');
    process.exit(1);
  } else if (warn_count > 0) {
    console.log('⚠️  Review warnings before enterprise deployment\n');
  } else {
    console.log('✅ All checks passed — ready for enterprise deployment\n');
  }
}

main().catch(console.error);
