/**
 * Production secret safety check — run once at server startup.
 *
 * Several secrets in this codebase have hardcoded, PUBLICLY VISIBLE fallback
 * values (search this repo for "_change_in_prod" / "dev_..._secret" style
 * strings). If the real env var is unset in production, the app silently
 * uses that public fallback — meaning anyone who reads the source can forge
 * whatever that secret protects. Found and fixed for JWT_SECRET (2026-09-22):
 * it was unset in production, so every session was signed with a secret
 * visible on GitHub — a full account-takeover vector, live, for an unknown
 * period. That was caught by manual inspection, not by any automated check.
 * This function is that automated check.
 *
 * Deliberately does NOT hard-crash the process by default — a wrongly-timed
 * hard-fail here would take down a live deploy over a single missing/typo'd
 * env var, which is its own kind of outage, and at the time this was written
 * two of the secrets below (LSB_SIGNATURE_SECRET, TEP_SIGNING_SECRET) had
 * just been rotated locally but not yet confirmed set on Render. So: logs
 * loudly, every single startup, impossible to miss — but only refuses to
 * start when FAIL_ON_INSECURE_SECRETS=true is explicitly set, which should
 * only be turned on once every secret below is confirmed correct in the
 * target environment.
 *
 * VAULT_MASTER_SECRET and EXCHANGE_BRIDGE_SECRET are known to still be weak
 * in production as of this writing (see docs/Pinit-DNA-15-Layer-Status-Report.docx
 * section 4.2/4.3) — deliberately not fixed yet because VAULT_MASTER_SECRET
 * derives the key that encrypts every already-stored file, and rotating it
 * without a real migration would make them all unreadable. They still show
 * up here so the warning is loud and ongoing, not just a one-time TODO
 * someone can forget about.
 */
import { logger } from '../lib/logger';
import { config } from './index';
import { dnaVnextConfig } from './dna-vnext';

type Severity = 'critical' | 'high';

interface SecretCheck {
  envVar: string;
  insecure: boolean;
  severity: Severity;
  note: string;
}

function isProdEnv(): boolean {
  return (process.env['NODE_ENV'] || '').toLowerCase() === 'production';
}

function buildChecks(): SecretCheck[] {
  return [
    {
      envVar: 'JWT_SECRET',
      insecure: config.jwt.secret === 'dev_jwt_secret_change_in_prod_min_32_chars_long!!',
      severity: 'critical',
      note: 'Forges a login session for any account.',
    },
    {
      envVar: 'VAULT_MASTER_SECRET',
      insecure: config.vault.masterSecret === 'dev_vault_secret_change_in_prod',
      severity: 'critical',
      note: 'Derives the key that decrypts every stored file. KNOWN OPEN ISSUE — see status report 4.2, needs a migration plan before rotating.',
    },
    {
      envVar: 'LSB_SIGNATURE_SECRET',
      insecure: config.stego.signatureSecret === 'dev_secret_change_in_prod',
      severity: 'high',
      note: 'Forges Layer 6 ownership-watermark signatures and TEP export signatures.',
    },
    {
      // Chained fallback (-> JWT_SECRET), so check env-var presence directly
      // rather than the resolved value — once JWT_SECRET is real, the
      // resolved value silently looks "fine" even though this secret was
      // never independently configured.
      envVar: 'EXCHANGE_BRIDGE_SECRET',
      insecure: !process.env['EXCHANGE_BRIDGE_SECRET'],
      severity: 'high',
      note: 'Not independently set (borrowing JWT_SECRET via fallback). The Hub<->Exchange bridge code also hardcodes a separate default value as an ALWAYS-ACCEPTED credential regardless of this setting — see status report 4.3. KNOWN OPEN ISSUE, needs a coordinated code fix across both services, not just this env var.',
    },
    {
      envVar: 'SPATIAL_AUTH_SECRET',
      insecure: !process.env['SPATIAL_AUTH_SECRET'],
      severity: 'high',
      note: 'Not independently set — relying on a fallback chain.',
    },
    {
      envVar: 'DNA_VNEXT secret chain (DNA_VNEXT_SECRET / BLOCK_DNA_SECRET / SPATIAL_AUTH_SECRET / LSB_SIGNATURE_SECRET)',
      insecure: dnaVnextConfig.secret === 'dev_dna_vnext_secret',
      severity: 'high',
      note: 'Signs the DNA-B watermark payload — every link in this fallback chain is unset.',
    },
  ];
}

export function checkProductionSecretSafety(): void {
  if (!isProdEnv()) return;

  const results = buildChecks();
  const insecure = results.filter((c) => c.insecure);

  if (!insecure.length) {
    logger.info('[SecretSafety] All checked secrets are independently configured — no known public defaults in use.');
    return;
  }

  for (const c of insecure) {
    logger.error(
      `[SecretSafety] *** ${c.envVar} is INSECURE in production (${c.severity}) *** ${c.note}`,
    );
  }

  const hardFail = (process.env['FAIL_ON_INSECURE_SECRETS'] || '').toLowerCase() === 'true';
  if (hardFail) {
    const names = insecure.map((c) => c.envVar).join(', ');
    throw new Error(
      `[SecretSafety] Refusing to start: ${insecure.length} secret(s) are insecure in production (${names}). ` +
      `Set FAIL_ON_INSECURE_SECRETS=false to downgrade this to a warning instead — but fix the secrets, not the flag.`,
    );
  }
}
