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
import { ComparisonEngine }       from './comparison-engine';
import type { FileInput }         from '../universal-file-router';
import type { DnaComparisonResult } from '../../types/comparison.types';

export class DnaComparisonService {
  private readonly fingerprinter = new EphemeralFingerprinter();
  private readonly engine        = new ComparisonEngine();

  /**
   * Compare two files layer-by-layer and return a forensic analysis report.
   *
   * @param fileA  First file (treated as the "original" in the report)
   * @param fileB  Second file (treated as the "comparison" in the report)
   */
  async compare(
    fileA: FileInput,
    fileB: FileInput
  ): Promise<DnaComparisonResult> {
    const start = Date.now();

    logger.info('DNA comparison started', {
      fileA: fileA.originalName,
      fileB: fileB.originalName,
    });

    // ── Generate fingerprints for both files in PARALLEL ──────────────────────
    // Each runs its own engine with a temp DB record that is cleaned up
    const [fpA, fpB] = await Promise.all([
      this.fingerprinter.fingerprint(fileA),
      this.fingerprinter.fingerprint(fileB),
    ]);

    logger.info('Ephemeral fingerprints ready', {
      fileA: { name: fpA.filename, type: fpA.fileType, layers: fpA.layers.length },
      fileB: { name: fpB.filename, type: fpB.fileType, layers: fpB.layers.length },
    });

    // ── Run comparison engine ─────────────────────────────────────────────────
    const processingMs = Date.now() - start;
    const result = this.engine.compare(fpA, fpB, processingMs);

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
