/**
 * PINIT-DNA — DNA Comparison Service (Phase 3.1)
 *
 * Orchestrates the full layer-by-layer DNA comparison flow:
 *
 *   FileA + FileB
 *       ↓
 *   EphemeralFingerprinter  (generates fingerprints in parallel, no DB persistence)
 *       ↓
 *   ComparisonEngine        (pure scoring, tampering detection, forensic report)
 *       ↓
 *   DnaComparisonResult
 *
 * Does NOT touch: DNA generation, encryption, vault storage, or retrieval.
 */

import { logger }                 from '../../lib/logger';
import { EphemeralFingerprinter } from './ephemeral-fingerprinter';
import { StoredDnaFingerprinter } from './stored-dna-fingerprinter.service';
import { ComparisonEngine }       from './comparison-engine';
import type { FileInput }         from '../universal-file-router';
import type { DnaComparisonResult } from '../../types/comparison.types';

export interface DnaCompareOptions {
  /** Use vault registry DNA for file A (original) — correct for investigation & auto-compare */
  vaultDnaRecordId?: string;
}

export class DnaComparisonService {
  private readonly fingerprinter = new EphemeralFingerprinter();
  private readonly storedFp      = new StoredDnaFingerprinter();
  private readonly engine        = new ComparisonEngine();

  /**
   * Compare two files layer-by-layer and return a forensic analysis report.
   *
   * @param fileA  First file (treated as the "original" in the report)
   * @param fileB  Second file (treated as the "comparison" in the report)
   * @param options  When vaultDnaRecordId is set, file A layers come from vault registry (L1–L15)
   */
  async compare(
    fileA: FileInput,
    fileB: FileInput,
    options?: DnaCompareOptions,
  ): Promise<DnaComparisonResult> {
    const start = Date.now();
    const vaultCompare = !!options?.vaultDnaRecordId;

    logger.info('DNA comparison started', {
      fileA: fileA.originalName,
      fileB: fileB.originalName,
      vaultCompare,
    });

    const [fpA, fpB] = await Promise.all([
      options?.vaultDnaRecordId
        ? this.storedFp.fromDnaRecord(options.vaultDnaRecordId)
        : this.fingerprinter.fingerprint(fileA),
      this.fingerprinter.fingerprint(fileB),
    ]);

    logger.info('Fingerprints ready', {
      fileA: { name: fpA.filename, type: fpA.fileType, layers: fpA.layers.length, source: vaultCompare ? 'vault-registry' : 'ephemeral' },
      fileB: { name: fpB.filename, type: fpB.fileType, layers: fpB.layers.length },
    });

    const processingMs = Date.now() - start;
    const result = this.engine.compare(fpA, fpB, processingMs, { vaultCompare });

    logger.info('DNA comparison complete', {
      comparisonId:    result.comparisonId,
      classification:  result.classification,
      confidence:      result.overallConfidenceScore,
      tampering:       result.tamperingDetected,
      changedLayers:   result.changedLayers,
      processingMs:    result.processingMs,
    });

    return result;
  }
}
