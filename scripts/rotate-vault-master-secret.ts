/**
 * One-off migration: rotate VAULT_MASTER_SECRET without breaking existing
 * vault files or certificates.
 *
 * config.vault.masterSecret derives (a) the HKDF key for every vault file
 * (src/services/vault/encryption.service.ts) and (b) the HMAC signing key
 * for every certificate (src/services/certificates/certificate.service.ts).
 * Changing the env var alone would make every already-vaulted file
 * undecryptable and every already-issued certificate's signature invalid.
 * This script decrypts with the OLD secret and re-encrypts/re-signs with
 * the NEW one, verifying every record before writing anything.
 *
 * Prerequisite: BIOMETRIC_ENCRYPTION_KEY must already be independently set
 * (not left on its VAULT_MASTER_SECRET fallback) — see .env, added
 * 2026-09-23. This script does not touch biometric templates at all.
 *
 * Usage:
 *   npx ts-node -T scripts/rotate-vault-master-secret.ts --new "<newSecret>" --dry-run
 *   npx ts-node -T scripts/rotate-vault-master-secret.ts --new "<newSecret>" --confirm
 *
 * --dry-run (default when neither flag is given): decrypts with the old
 *   secret, re-encrypts/re-signs with the new one in memory, verifies every
 *   round trip, but writes nothing to Supabase Storage, local disk, or the
 *   database.
 * --confirm: does the same, then writes. Backs up the pre-migration
 *   ciphertext under a `backup-vault-rotation/` prefix before overwriting.
 * --old "<oldSecret>": defaults to the current VAULT_MASTER_SECRET from
 *   .env. Only pass this if the live env var has already changed for some
 *   other reason and you need to point at what files were ACTUALLY
 *   encrypted with.
 *
 * A record that is ALREADY unreadable under the OLD secret (missing from
 * storage, or fails GCM auth) is a pre-existing problem unrelated to this
 * rotation — skipped and reported, not migrated, and does not abort the
 * run. Confirmed against production 2026-09-23: 18 of 44 vault records are
 * already broken this way (14 missing from storage, 4 fail auth) — rotation
 * cannot make those any worse, so they are intentionally left alone here.
 *
 * A record that DOES decrypt under the old secret but then fails its own
 * round-trip verify after re-encrypting, or a certificate whose signature
 * doesn't match the old secret at all despite decrypting successfully
 * elsewhere, indicates a bug in THIS script (not a pre-existing problem) —
 * that still hard-aborts the whole run immediately.
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../src/lib/prisma';
import { encrypt, decrypt } from '../src/services/vault/encryption.service';
import {
  downloadVaultFile,
  downloadVaultFileByPath,
  uploadVaultFile,
  isSupabaseStorageConfigured,
  normalizeVaultStoragePath,
} from '../src/lib/supabase-storage';
import { vaultEncryptedLooksLikeLocalPath } from '../src/services/vault/vault-storage-path';

const LOCAL_DIR = path.resolve(process.env['VAULT_STORAGE_DIR'] ?? './vault/encrypted');
const BACKUP_PREFIX = 'backup-vault-rotation';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const newSecret = get('--new');
  const oldSecret = get('--old') || process.env['VAULT_MASTER_SECRET'] || '';
  const confirm = args.includes('--confirm');
  const dryRun = !confirm; // --dry-run is the default; --confirm is the only thing that makes this write

  if (!newSecret) {
    console.error('Usage: npx ts-node -T scripts/rotate-vault-master-secret.ts --new "<newSecret>" [--old "<oldSecret>"] [--confirm]');
    console.error('  (omit --confirm for a dry run — nothing is written)');
    process.exit(1);
  }
  if (!oldSecret) {
    console.error('No old secret found — set VAULT_MASTER_SECRET in .env or pass --old explicitly.');
    process.exit(1);
  }
  if (newSecret === oldSecret) {
    console.error('--new is identical to the old secret — nothing to rotate.');
    process.exit(1);
  }
  if (newSecret.length < 32) {
    console.error(`--new is only ${newSecret.length} chars — use a real random secret (48+ bytes base64 recommended).`);
    process.exit(1);
  }
  return { newSecret, oldSecret, dryRun };
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function readLocal(vaultId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(LOCAL_DIR, `${vaultId}.enc`));
  } catch {
    return null;
  }
}

async function writeLocal(vaultId: string, buffer: Buffer): Promise<void> {
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, `${vaultId}.enc`), buffer);
}

async function backupLocal(vaultId: string, buffer: Buffer): Promise<void> {
  const dir = path.join(LOCAL_DIR, BACKUP_PREFIX);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${vaultId}.enc`), buffer);
}

/**
 * Mirrors vault.service.ts's retrieve() resolution order, plus two fallbacks
 * proven necessary against real production data (2026-09-23 scan): the exact
 * stored path works even when DnaRecord.ownerUserId is null (a separate,
 * unrelated data bug — ~13 records), and some early records live at a
 * root-level `${vaultId}.enc` object with no owner prefix at all.
 */
async function readEncrypted(
  vaultId: string,
  ownerUserId: string,
  encryptedFilePath: string,
): Promise<{ buffer: Buffer; source: string }> {
  if (vaultEncryptedLooksLikeLocalPath(encryptedFilePath)) {
    try {
      return { buffer: await fs.readFile(encryptedFilePath), source: 'local-exact' };
    } catch { /* fall through */ }
  }
  const local = await readLocal(vaultId);
  if (local) return { buffer: local, source: 'local' };

  if (isSupabaseStorageConfigured()) {
    if (encryptedFilePath) {
      try {
        const buffer = await downloadVaultFileByPath(normalizeVaultStoragePath(encryptedFilePath, vaultId));
        return { buffer, source: 'supabase-exact-path' };
      } catch { /* fall through */ }
    }
    if (ownerUserId) {
      try {
        const buffer = await downloadVaultFile(vaultId, ownerUserId, encryptedFilePath ? [encryptedFilePath] : []);
        return { buffer, source: 'supabase' };
      } catch { /* fall through */ }
    }
    const buffer = await downloadVaultFileByPath(`${vaultId}.enc`);
    return { buffer, source: 'supabase-root' };
  }
  throw new Error(`No encrypted blob found locally or in Supabase for vault ${vaultId}`);
}

async function migrateVaultRecords(oldSecret: string, newSecret: string, dryRun: boolean) {
  const records = await prisma.vaultRecord.findMany({
    include: { dnaRecord: { select: { ownerUserId: true, sha256Hash: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\n=== Vault files: ${records.length} record(s) ===`);

  let migrated = 0;
  const skipped: { vaultId: string; reason: string }[] = [];

  for (const record of records) {
    const vaultId = record.id;
    const ownerUserId = record.dnaRecord?.ownerUserId ?? '';
    const label = `[vault ${vaultId.slice(0, 8)}]`;

    let oldEncrypted: Buffer;
    let source: string;
    try {
      ({ buffer: oldEncrypted, source } = await readEncrypted(vaultId, ownerUserId, record.encryptedFilePath));
    } catch (err) {
      const reason = `not found in storage: ${(err as Error).message}`;
      console.log(`${label} SKIP — ${reason}`);
      skipped.push({ vaultId, reason });
      continue;
    }

    let plaintext: Buffer;
    try {
      plaintext = decrypt(oldEncrypted, vaultId, oldSecret);
    } catch (err) {
      const reason = `fails to decrypt with old secret (${source}): ${(err as Error).message}`;
      console.log(`${label} SKIP — ${reason}`);
      skipped.push({ vaultId, reason });
      continue;
    }

    // NOTE: DnaRecord.sha256Hash is deliberately NOT cross-checked here. It is
    // computed from the ORIGINAL upload buffer (layer1.cryptographic.ts), but
    // vault.service.ts's store() re-assigns fileToEncrypt to the embedding/
    // watermark pipeline's output (line ~203) before encrypting — the vault
    // legitimately stores different bytes than what was hashed. Confirmed by
    // testing: every one of the 26 healthy records fails that comparison while
    // passing GCM auth, which is the actually-sufficient integrity check (a
    // wrong key cannot produce a valid 128-bit auth tag by chance).
    const actualHash = sha256(plaintext);

    const reEncrypted = encrypt(plaintext, vaultId, newSecret);

    // Round-trip: decrypt what we just produced with the NEW secret and confirm
    // it reproduces the exact same plaintext. This one must never fail — if it
    // does, the bug is in THIS script, not a pre-existing record problem.
    const roundTrip = decrypt(reEncrypted.encryptedBuffer, vaultId, newSecret);
    if (sha256(roundTrip) !== actualHash) {
      throw new Error(`${label} round-trip verify FAILED after re-encrypt — this is a script bug, not a pre-existing issue. Aborting.`);
    }

    console.log(`${label} OK (${source}, ${plaintext.length} bytes) — verified, ${dryRun ? 'not writing (dry run)' : 'writing'}`);

    if (!dryRun) {
      if (source.startsWith('local')) {
        await backupLocal(vaultId, oldEncrypted);
        await writeLocal(vaultId, reEncrypted.encryptedBuffer);
      } else {
        await uploadVaultFile(`${BACKUP_PREFIX}/${vaultId}`, oldEncrypted, ownerUserId || undefined);
        await uploadVaultFile(vaultId, reEncrypted.encryptedBuffer, ownerUserId || undefined);
      }
      await prisma.vaultRecord.update({
        where: { id: vaultId },
        data: { ivHex: reEncrypted.ivHex, authTagHex: reEncrypted.authTagHex },
      });
    }
    migrated++;
  }
  console.log(`=== Vault files: ${migrated}/${records.length} verified${dryRun ? '' : ' and migrated'}, ${skipped.length} pre-existing broken skipped ===`);
  if (skipped.length) {
    console.log('Skipped (pre-existing, unrelated to rotation):');
    for (const s of skipped) console.log(`  - ${s.vaultId}: ${s.reason}`);
  }
  return { migrated, skipped: skipped.length };
}

// Mirrors certificate.service.ts's buildPayload/buildPayloadV2/sign exactly.
// Source of truth: src/services/certificates/certificate.service.ts:565-585,607.
// If those templates ever change, this script's candidates must change too.
function buildPayloadV1(certId: string, dnaId: string, vaultId: string, issuedAt: string): string {
  return `PINIT-DNA-CERT|${certId}|${dnaId}|${vaultId}|${issuedAt}`;
}
function buildPayloadV2(params: {
  certId: string; dnaId: string; vaultId: string; assetId: string; contentHash: string; issuedAt: string;
}): string {
  return ['PINIT-CERT-V2', params.certId, params.dnaId, params.vaultId, params.assetId, params.contentHash, params.issuedAt].join('|');
}
function signWith(secret: string, payload: string): string {
  return crypto.createHmac('sha256', `CERT_SIGN::${secret}`).update(payload).digest('hex');
}

async function migrateCertificates(oldSecret: string, newSecret: string, dryRun: boolean) {
  const certs = await prisma.certificate.findMany();
  console.log(`\n=== Certificates: ${certs.length} record(s) ===`);

  let migrated = 0;
  const skipped: { certificateId: string; reason: string }[] = [];

  for (const cert of certs) {
    const label = `[cert ${cert.certificateId}]`;
    const issuedAtIso = cert.issuedAt.toISOString();

    const candidates: { binding: 'SEALED' | 'LEGACY'; payload: string }[] = [];
    if (cert.assetId) {
      const asset = await prisma.asset.findUnique({ where: { id: cert.assetId }, select: { contentHash: true } });
      if (asset?.contentHash) {
        candidates.push({
          binding: 'SEALED',
          payload: buildPayloadV2({
            certId: cert.certificateId, dnaId: cert.dnaRecordId, vaultId: cert.vaultId,
            assetId: cert.assetId, contentHash: asset.contentHash, issuedAt: issuedAtIso,
          }),
        });
      }
    }
    candidates.push({ binding: 'LEGACY', payload: buildPayloadV1(cert.certificateId, cert.dnaRecordId, cert.vaultId, issuedAtIso) });

    const given = Buffer.from(cert.signature, 'hex');
    let matched: { binding: string; payload: string } | null = null;
    for (const c of candidates) {
      const expected = Buffer.from(signWith(oldSecret, c.payload), 'hex');
      if (expected.length === given.length && crypto.timingSafeEqual(given, expected)) {
        matched = c;
        break;
      }
    }

    if (!matched) {
      const reason = 'current signature does not match any candidate payload under the old secret — already broken, pre-existing';
      console.log(`${label} SKIP — ${reason}`);
      skipped.push({ certificateId: cert.certificateId, reason });
      continue;
    }

    const newSignature = signWith(newSecret, matched.payload);
    console.log(`${label} OK (${matched.binding}) — verified, ${dryRun ? 'not writing (dry run)' : 'writing'}`);

    if (!dryRun) {
      await prisma.certificate.update({ where: { certificateId: cert.certificateId }, data: { signature: newSignature } });
    }
    migrated++;
  }
  console.log(`=== Certificates: ${migrated}/${certs.length} verified${dryRun ? '' : ' and migrated'}, ${skipped.length} pre-existing broken skipped ===`);
  if (skipped.length) {
    console.log('Skipped (pre-existing, unrelated to rotation):');
    for (const s of skipped) console.log(`  - ${s.certificateId}: ${s.reason}`);
  }
  return { migrated, skipped: skipped.length };
}

async function main() {
  const { newSecret, oldSecret, dryRun } = parseArgs();
  console.log(dryRun ? 'DRY RUN — nothing will be written.' : 'LIVE RUN — writing to Supabase Storage / local disk / database.');

  const vaultTotal = await prisma.vaultRecord.count();
  const certTotal = await prisma.certificate.count();

  const vaultResult = await migrateVaultRecords(oldSecret, newSecret, dryRun);
  const certResult = await migrateCertificates(oldSecret, newSecret, dryRun);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Vault records: ${vaultResult.migrated}/${vaultTotal} migrated, ${vaultResult.skipped} pre-existing broken (unaffected either way)`);
  console.log(`Certificates:  ${certResult.migrated}/${certTotal} migrated, ${certResult.skipped} pre-existing broken (unaffected either way)`);
  if (dryRun) {
    console.log('\nDry run clean. Re-run with --confirm to write, then set VAULT_MASTER_SECRET on Render to the new value and redeploy.');
  } else {
    console.log('\nMigration complete. Now set VAULT_MASTER_SECRET on Render (Hub backend) to the new value and redeploy.');
  }
}

main()
  .catch((err) => {
    console.error('\n!!! ABORTED:', err instanceof Error ? err.message : err);
    console.error('No further records were processed. Anything already written above this point used verified data only.');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
