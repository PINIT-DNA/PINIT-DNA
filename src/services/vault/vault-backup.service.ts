/**
 * PINIT-DNA — Vault Backup Service (Phase 5)
 *
 * After every encryption, copies the .enc file to a secondary backup location.
 * Backup path configured via VAULT_BACKUP_DIR env var.
 * Does NOT touch encryption logic — only copies the already-encrypted file.
 */

import fs   from 'fs/promises';
import path from 'path';
import { logger } from '../../lib/logger';
import { auditService } from '../audit/audit.service';

export class VaultBackupService {
  private readonly backupDir: string | null;

  constructor() {
    this.backupDir = process.env['VAULT_BACKUP_DIR'] ?? null;
  }

  get enabled(): boolean {
    return !!this.backupDir;
  }

  /**
   * Copy an encrypted file to the backup directory.
   * Called after primary vault write succeeds.
   * Non-fatal — backup failure does not block the main flow.
   */
  async backup(encryptedFilePath: string, vaultId: string): Promise<void> {
    if (!this.backupDir) {
      logger.debug('Vault backup skipped — VAULT_BACKUP_DIR not configured');
      return;
    }

    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      const filename   = path.basename(encryptedFilePath);
      const backupPath = path.join(this.backupDir, filename);
      await fs.copyFile(encryptedFilePath, backupPath);

      logger.info('Vault file backed up', { vaultId, backupPath });

      await auditService.log({
        eventType: 'VAULT_BACKUP_RUN', vaultId,
        detail: { primaryPath: encryptedFilePath, backupPath, status: 'SUCCESS' },
      });
    } catch (err) {
      // Non-fatal — log and continue
      logger.error('Vault backup failed (non-fatal)', { vaultId, error: String(err) });
      await auditService.log({
        eventType: 'VAULT_BACKUP_RUN', vaultId,
        detail: { status: 'FAILED', error: String(err) },
      });
    }
  }

  /**
   * Verify backup exists and matches primary file size.
   */
  async verifyBackup(encryptedFilePath: string): Promise<{ exists: boolean; sizeMatch: boolean }> {
    if (!this.backupDir) return { exists: false, sizeMatch: false };

    try {
      const filename   = path.basename(encryptedFilePath);
      const backupPath = path.join(this.backupDir, filename);
      const [primary, backup] = await Promise.all([
        fs.stat(encryptedFilePath).catch(() => null),
        fs.stat(backupPath).catch(() => null),
      ]);

      return {
        exists:    !!backup,
        sizeMatch: !!(primary && backup && primary.size === backup.size),
      };
    } catch {
      return { exists: false, sizeMatch: false };
    }
  }
}

export const vaultBackupService = new VaultBackupService();
