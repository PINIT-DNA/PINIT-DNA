/**
 * PINIT-DNA — Vault Scheduler Service (Phase 5)
 *
 * Runs scheduled tasks:
 *   1. Daily vault integrity check (every 24 hours at 02:00)
 *   2. Temp file cleanup (every hour)
 *   3. Expired certificate detection (daily at 03:00)
 *   4. Share link expiry warnings + auto-expire (daily at 04:00)
 *
 * Uses node-cron. Does NOT touch DNA or encryption logic.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cron = require('node-cron') as typeof import('node-cron');
import fs    from 'fs/promises';
import path  from 'path';
import { prisma }       from '../../lib/prisma';
import { logger }       from '../../lib/logger';
import { auditService } from '../audit/audit.service';
import { config }       from '../../config';
import { isMonitoringCrawlerEnabled } from '../crawler/monitoring.service';

export class VaultSchedulerService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tasks: any[] = [];

  /**
   * Start all scheduled tasks.
   * Call once at application startup.
   */
  start(): void {
    logger.info('Vault scheduler starting');

    // ── Daily integrity check at 02:00 ────────────────────────────────────
    this.tasks.push(
      cron.schedule('0 2 * * *', () => {
        this.runIntegrityCheck().catch(err =>
          logger.error('Scheduled integrity check failed', { error: String(err) })
        );
      }, { timezone: 'Asia/Kolkata' })
    );

    // ── Hourly temp file cleanup ──────────────────────────────────────────
    this.tasks.push(
      cron.schedule('0 * * * *', () => {
        this.cleanupTempFiles().catch(err =>
          logger.error('Temp file cleanup failed', { error: String(err) })
        );
      })
    );

    // ── Daily certificate expiry check at 03:00 ───────────────────────────
    this.tasks.push(
      cron.schedule('0 3 * * *', () => {
        this.checkCertificateExpiry().catch(err =>
          logger.error('Certificate expiry check failed', { error: String(err) })
        );
      }, { timezone: 'Asia/Kolkata' })
    );

    // ── Share link expiry at 04:00 ────────────────────────────────────────
    this.tasks.push(
      cron.schedule('0 4 * * *', () => {
        this.checkShareLinkExpiry().catch(err =>
          logger.error('Share link expiry check failed', { error: String(err) })
        );
      }, { timezone: 'Asia/Kolkata' })
    );

    // ── Crawler: run due monitoring checks every hour (opt-in) ───────────────
    if (isMonitoringCrawlerEnabled()) {
      this.tasks.push(
        cron.schedule('0 * * * *', () => {
          import('../crawler/monitoring.service')
            .then(m => m.monitoringService.runDueChecks())
            .catch(err => logger.error('Monitoring check failed', { error: String(err) }));
        })
      );
      logger.info('Vault scheduler started — 5 tasks active (+ monitoring crawler enabled)');
    } else {
      logger.info('Vault scheduler started — 4 tasks active (monitoring crawler disabled)');
    }
  }

  stop(): void {
    this.tasks.forEach(t => t.stop());
    this.tasks = [];
    logger.info('Vault scheduler stopped');
  }

  // ─── Integrity Check ──────────────────────────────────────────────────────

  async runIntegrityCheck(): Promise<void> {
    const start = Date.now();
    logger.info('Scheduled integrity check started');

    const records = await prisma.vaultRecord.findMany({
      select: {
        id: true,
        encryptedFilePath: true,
        encryptedSizeBytes: true,
        originalFileName: true,
        dnaRecord: { select: { ownerUserId: true } },
      },
    });

    let healthy = 0; let missing = 0; let mismatch = 0;

    for (const r of records) {
      const ownerUserId = r.dnaRecord?.ownerUserId;
      try {
        const stat = await fs.stat(r.encryptedFilePath);
        if (Math.abs(stat.size - r.encryptedSizeBytes) <= 32) {
          healthy++;
        } else {
          mismatch++;
          logger.warn('Vault file size mismatch detected', { vaultId: r.id, filename: r.originalFileName });
          if (ownerUserId) {
            import('../platform-events/extended-events').then(({ emitVaultIntegrityIssue }) => {
              emitVaultIntegrityIssue({
                ownerUserId,
                vaultId: r.id,
                filename: r.originalFileName,
                issue: 'mismatch',
              });
            }).catch(() => {});
          }
        }
      } catch {
        missing++;
        logger.error('Vault file MISSING from disk', { vaultId: r.id, filename: r.originalFileName });
        if (ownerUserId) {
          import('../platform-events/extended-events').then(({ emitVaultIntegrityIssue }) => {
            emitVaultIntegrityIssue({
              ownerUserId,
              vaultId: r.id,
              filename: r.originalFileName,
              issue: 'missing',
            });
          }).catch(() => {});
        }
      }
    }

    const durationMs = Date.now() - start;
    const status = missing > 0 ? 'CRITICAL' : mismatch > 0 ? 'WARNING' : 'HEALTHY';

    await auditService.log({
      eventType: 'INTEGRITY_CHECK_RUN',
      detail: { total: records.length, healthy, missing, mismatch, status, durationMs, scheduled: true },
    });

    logger.info('Scheduled integrity check complete', { total: records.length, healthy, missing, mismatch, status });
  }

  // ─── Temp File Cleanup ────────────────────────────────────────────────────

  async cleanupTempFiles(): Promise<void> {
    const tempDir  = config.upload.tempDir;
    const maxAgeMs = 60 * 60 * 1000; // 1 hour

    try {
      const files = await fs.readdir(tempDir).catch(() => [] as string[]);
      let removed = 0;

      for (const file of files) {
        if (!file.startsWith('dna_')) continue;
        const filePath = path.join(tempDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (Date.now() - stat.mtimeMs > maxAgeMs) {
            await fs.unlink(filePath);
            removed++;
          }
        } catch { /* skip locked files */ }
      }

      if (removed > 0) {
        logger.info('Temp file cleanup complete', { removed, tempDir });
      }
    } catch (err) {
      logger.warn('Temp file cleanup error', { error: String(err) });
    }
  }

  // ─── Certificate Expiry ───────────────────────────────────────────────────

  async checkCertificateExpiry(): Promise<void> {
    const now = new Date();
    const expired = await prisma.certificate.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
    });

    for (const cert of expired) {
      await prisma.certificate.update({
        where: { id: cert.id },
        data:  { status: 'EXPIRED' },
      });
      logger.info('Certificate marked as EXPIRED', { certificateId: cert.certificateId });
      if (cert.ownerUserId) {
        import('../platform-events/extended-events').then(({ emitCertificateExpired }) => {
          emitCertificateExpired({
            ownerUserId: cert.ownerUserId!,
            certificateId: cert.certificateId,
            dnaRecordId: cert.dnaRecordId,
          });
        }).catch(() => {});
      }
    }

    if (expired.length > 0) {
      logger.info('Certificate expiry check complete', { expired: expired.length });
    }
  }

  // ─── Share Link Expiry ────────────────────────────────────────────────────

  async checkShareLinkExpiry(): Promise<void> {
    const now = new Date();
    const warnBefore = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const expiringSoon = await prisma.shareLink.findMany({
      where: {
        isActive: true,
        expiresAt: { gt: now, lte: warnBefore },
        ownerUserId: { not: null },
      },
      select: { id: true, token: true, filename: true, ownerUserId: true },
    });

    for (const link of expiringSoon) {
      import('../platform-events/extended-events').then(({ emitLinkExpired }) => {
        emitLinkExpired({
          ownerUserId: link.ownerUserId!,
          shareLinkId: link.id,
          token: link.token,
          filename: link.filename ?? 'File',
          warning: true,
        });
      }).catch(() => {});
    }

    const expired = await prisma.shareLink.findMany({
      where: {
        isActive: true,
        expiresAt: { lte: now },
        ownerUserId: { not: null },
      },
      select: { id: true, token: true, filename: true, ownerUserId: true },
    });

    for (const link of expired) {
      await prisma.shareLink.update({
        where: { id: link.id },
        data: { isActive: false },
      });
      import('../platform-events/extended-events').then(({ emitLinkExpired }) => {
        emitLinkExpired({
          ownerUserId: link.ownerUserId!,
          shareLinkId: link.id,
          token: link.token,
          filename: link.filename ?? 'File',
          warning: false,
        });
      }).catch(() => {});
    }

    if (expiringSoon.length > 0 || expired.length > 0) {
      logger.info('Share link expiry check complete', {
        expiringSoon: expiringSoon.length,
        expired: expired.length,
      });
    }
  }
}

export const vaultScheduler = new VaultSchedulerService();
