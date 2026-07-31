/**
 * PINIT-DNA — DNA Comparison Service (Phase 3.1 + Milestone E)
 *
 * Orchestrates layer-by-layer DNA comparison.
 *
 * Milestone C: vault side prefers sealed enterpriseDnaPackage (SSoT).
 * Milestone E: when COMPARISON_V2 is on and a stored package exists, run the
 * Enterprise Comparison Engine (stored package vs probe package). Legacy
 * ComparisonEngine still produces overallConfidenceScore so Acceptance /
 * final confidence calculation is unchanged.
 */

import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { EphemeralFingerprinter } from './ephemeral-fingerprinter';
import { StoredDnaFingerprinter } from './stored-dna-fingerprinter.service';
import { ComparisonEngine } from './comparison-engine';
import {
  enterpriseComparisonEngine,
  isComparisonV2Enabled,
  packageFromEphemeralFingerprint,
} from './enterprise-comparison-engine.service';
import { parseEnterpriseDnaPackage } from '../dna/enterprise-dna-package.service';
import { resolveInvestigationVaultDnaSource } from '../forensics/investigation-stored-dna-source.service';
import type { FileInput } from '../universal-file-router';
import type { DnaComparisonResult } from '../../types/comparison.types';
import type { EphemeralFingerprint } from './ephemeral-fingerprinter';
import type { EnterpriseDnaPackage } from '../../types/enterprise-dna-package.types';

export interface DnaCompareOptions {
  /** Use vault registry DNA for file A (original) — correct for investigation & auto-compare */
  vaultDnaRecordId?: string;
  /**
   * Legacy investigation path: fingerprint decrypted vault bytes.
   * Ignored when a valid enterpriseDnaPackage is available (Milestone C SSoT).
   */
  preferLiveVaultFingerprint?: boolean;
  /**
   * Pre-resolved vault fingerprint (enterprise package). When set, skips reload.
   */
  vaultFingerprintOverride?: EphemeralFingerprint;
}

export class DnaComparisonService {
  private readonly fingerprinter = new EphemeralFingerprinter();
  private readonly storedFp = new StoredDnaFingerprinter();
  private readonly engine = new ComparisonEngine();

  /**
   * Compare two files layer-by-layer and return a forensic analysis report.
   *
   * Vault side (file A) resolution order when vaultDnaRecordId is set:
   * 1. vaultFingerprintOverride (caller already resolved enterprise package)
   * 2. Valid enterpriseDnaPackage → stored fingerprints (SSoT)
   * 3. preferLiveVaultFingerprint → live vault bytes (legacy fallback)
   * 4. StoredDnaFingerprinter registry tables (legacy fallback)
   */
  async compare(
    fileA: FileInput,
    fileB: FileInput,
    options?: DnaCompareOptions,
  ): Promise<DnaComparisonResult> {
    const start = Date.now();

    let fpA: EphemeralFingerprint;
    let vaultSource: 'enterprise_package' | 'vault-bytes' | 'vault-registry' | 'ephemeral' = 'ephemeral';
    let vaultCompare = false;
    let storedPackage: EnterpriseDnaPackage | null = null;

    if (options?.vaultFingerprintOverride) {
      fpA = options.vaultFingerprintOverride;
      vaultSource = 'enterprise_package';
      vaultCompare = true;
      if (options.vaultDnaRecordId) {
        storedPackage = await this.loadStoredPackage(options.vaultDnaRecordId);
      }
    } else if (options?.vaultDnaRecordId) {
      const resolved = await resolveInvestigationVaultDnaSource(options.vaultDnaRecordId);
      if (resolved.mode === 'enterprise_package' && resolved.fingerprint) {
        fpA = resolved.fingerprint;
        vaultSource = 'enterprise_package';
        vaultCompare = true;
        storedPackage = await this.loadStoredPackage(options.vaultDnaRecordId);
      } else {
        const liveVault = !!options?.preferLiveVaultFingerprint && !!fileA.buffer?.length;
        if (liveVault) {
          logger.info('[InvestigationDNA] fallback regeneration used', {
            dnaRecordId: options.vaultDnaRecordId.slice(0, 8),
            reason: resolved.reason,
          });
          fpA = await this.fingerprinter.fingerprint(fileA);
          vaultSource = 'vault-bytes';
          vaultCompare = false;
        } else {
          logger.info('[InvestigationDNA] fallback regeneration used', {
            dnaRecordId: options.vaultDnaRecordId.slice(0, 8),
            reason: resolved.reason,
            path: 'vault-registry',
          });
          fpA = await this.storedFp.fromDnaRecord(options.vaultDnaRecordId);
          vaultSource = 'vault-registry';
          vaultCompare = true;
        }
      }
    } else {
      fpA = await this.fingerprinter.fingerprint(fileA);
      vaultSource = 'ephemeral';
    }

    logger.info('DNA comparison started', {
      fileA: fileA.originalName,
      fileB: fileB.originalName,
      vaultCompare,
      vaultSource,
      comparisonV2: isComparisonV2Enabled(),
    });

    const fpB = await this.fingerprinter.fingerprint(fileB);

    logger.info('Fingerprints ready', {
      fileA: {
        name: fpA.filename,
        type: fpA.fileType,
        layers: fpA.layers.length,
        source: vaultSource,
      },
      fileB: { name: fpB.filename, type: fpB.fileType, layers: fpB.layers.length },
    });

    const processingMs = Date.now() - start;

    // Legacy engine retains overallConfidenceScore / classification for Acceptance.
    const result = this.engine.compare(fpA, fpB, processingMs, {
      vaultCompare: vaultCompare && vaultSource !== 'vault-bytes',
    });

    // Milestone E — enterprise package vs probe package (no vault regen).
    if (isComparisonV2Enabled()) {
      try {
        if (storedPackage) {
          result.enterpriseComparison = enterpriseComparisonEngine.compareStoredVsEphemeral(
            storedPackage,
            fpB,
          );
        } else if (vaultSource === 'enterprise_package' || vaultSource === 'vault-registry') {
          // Package missing: still compare package-shaped views from fingerprints (probe vs stored FP).
          result.enterpriseComparison = enterpriseComparisonEngine.comparePackages(
            packageFromEphemeralFingerprint(fpA, `stored:${fpA.filename}`),
            packageFromEphemeralFingerprint(fpB, `probe:${fpB.filename}`),
          );
        }
      } catch (error) {
        logger.warn('[EnterpriseCompare] V2 path failed; legacy result retained', {
          error: String(error),
        });
      }
    }

    logger.info('DNA comparison complete', {
      comparisonId: result.comparisonId,
      classification: result.classification,
      confidence: result.overallConfidenceScore,
      tampering: result.tamperingDetected,
      changedLayers: result.changedLayers,
      processingMs: result.processingMs,
      vaultSource,
      enterpriseDomains: result.enterpriseComparison?.domains,
    });

    return result;
  }

  private async loadStoredPackage(dnaRecordId: string): Promise<EnterpriseDnaPackage | null> {
    const record = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { universalFingerprints: true },
    });
    return parseEnterpriseDnaPackage(record?.universalFingerprints) ?? null;
  }
}
