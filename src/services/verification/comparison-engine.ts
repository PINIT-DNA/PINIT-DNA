/**
 * PINIT-DNA — DNA Comparison Engine (Phase 3.1)
 *
 * Pure comparison logic — no I/O, no DB, no file system.
 * Takes two EphemeralFingerprints and returns a full DnaComparisonResult.
 *
 * Layer weights (must sum to 1.0):
 *   L1 Cryptographic : 0.35  — exact identity (binary)
 *   L2 Structural    : 0.20  — organisation fingerprint
 *   L3 Perceptual    : 0.20  — content similarity (SimHash/pHash Hamming)
 *   L4 Semantic      : 0.10  — meaning/distribution
 *   L5 Metadata      : 0.05  — provenance (often stripped)
 *   L6 Signature     : 0.10  — HMAC seal
 *
 * Classification:
 *   DNA_MATCH  — L1 exact AND score ≥ 95
 *   SIMILAR    — score ≥ 55
 *   DIFFERENT  — score < 55
 *
 * Tampering detection patterns:
 *   L1↑ L3↓ same     → re-encoded / compressed (perceptually identical but bytes differ)
 *   L1↑ L2↑ L3≈same → minor pixel edit (structural changed, visual same)
 *   L5↑ others≈same  → metadata manipulation only
 *   L6↑ others≈same  → signature forgery attempt
 *   L2↑ L3↑ big      → structural modification (crop/resize/rotate)
 *   L4↑ L3≈same      → color grading / filter applied
 */

import { v4 as uuidv4 } from 'uuid';
import { dnaEnhancements } from '../../config/dna-enhancements';
import { tamperClassifierService } from '../forensics/tamper-classifier.service';
import type { LayerScoreInput } from '../../types/dna-enhancements.types';
import type { EphemeralFingerprint, EphemeralLayer } from './ephemeral-fingerprinter';
import type {
  DnaComparisonResult,
  LayerComparisonResult,
  TamperingIndicator,
  DnaClassification,
  ForensicReport,
} from '../../types/comparison.types';
import { DNA_LAYER_REGISTRY } from '../../constants/dna-layer-registry';

export interface ComparisonEngineOptions {
  /** Vault registry original — L7–L10 lifecycle layers use content-verified scoring */
  vaultCompare?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LAYER_WEIGHTS: Record<number, number> = {
  1: 0.35, 2: 0.20, 3: 0.20, 4: 0.10, 5: 0.05, 6: 0.10,
  // L7-L10 are session-specific (behavior/origin/relationships vary per upload)
  // Weight 0 so they appear in UI but don't skew content-similarity score
  7: 0, 8: 0, 9: 0, 10: 0,
};

const LAYER_THRESHOLDS: Record<number, number> = {
  1: 1.00,
  2: 0.80,
  3: 0.75,
  4: 0.70,
  5: 0.60,
  6: 0.90,
  7: 0.50,
  8: 0.50,
  9: 0.50,
  10: 1.00, // L10 merkle root matches exactly when file is identical
};

const ENGINE_VERSION = '2.0.0-universal';

// ─── Comparison Engine ────────────────────────────────────────────────────────

export class ComparisonEngine {
  /**
   * Compare two ephemeral fingerprints and return a full forensic analysis.
   */
  compare(
    fpA: EphemeralFingerprint,
    fpB: EphemeralFingerprint,
    processingMs: number,
    options?: ComparisonEngineOptions,
  ): DnaComparisonResult {
    const comparisonId = uuidv4();
    const vaultCompare = options?.vaultCompare ?? false;

    const layerComparisons = this.compareLayers(fpA.layers, fpB.layers, vaultCompare);

    // ── Overall confidence score ──────────────────────────────────────────────
    const rawScore = layerComparisons.reduce((sum, l) => {
      const weight = LAYER_WEIGHTS[l.layer] ?? 0;
      return sum + l.similarityScore * weight;
    }, 0);
    const overallScore = Math.round(rawScore * 100);

    // ── Classification ────────────────────────────────────────────────────────
    const l1Match = layerComparisons[0]?.similarityScore === 1.0;
    const classification = this.classify(overallScore, l1Match);

    // ── Tampering analysis ────────────────────────────────────────────────────
    const { tamperingDetected, indicators } = this.analyzeTampering(layerComparisons);

    // ── Changed / matched layers ──────────────────────────────────────────────
    const changedLayers  = layerComparisons.filter(l => l.changed).map(l => l.name);
    const matchedLayers  = layerComparisons.filter(l => l.matched).map(l => l.name);

    // ── Forensic report ───────────────────────────────────────────────────────
    const forensicReport = this.buildForensicReport({
      fpA, fpB, layerComparisons, classification, overallScore,
      tamperingDetected, indicators, changedLayers, matchedLayers,
    });

    let enhancedForensic: DnaComparisonResult['enhancedForensic'];
    if (dnaEnhancements.enabled && dnaEnhancements.verify.tamperClassification) {
      const layerInputs = this.toLayerScoreInputs(layerComparisons);
      const tamper = tamperClassifierService.classify(layerInputs);
      enhancedForensic = {
        tamperVector: tamper.primaryVector,
        tamperDescription: tamper.description,
        tamperConfidence: tamper.tamperConfidence,
      };
    }

    return {
      comparisonId,
      fileA: {
        filename:   fpA.filename,
        fileType:   fpA.fileType,
        mimeType:   fpA.mimeType,
        sizeBytes:  fpA.sizeBytes,
        detectedBy: fpA.detectedBy,
      },
      fileB: {
        filename:   fpB.filename,
        fileType:   fpB.fileType,
        mimeType:   fpB.mimeType,
        sizeBytes:  fpB.sizeBytes,
        detectedBy: fpB.detectedBy,
      },
      sameFileType:          fpA.fileType === fpB.fileType,
      classification,
      overallConfidenceScore: overallScore,
      tamperingDetected,
      layerComparisons,
      changedLayers,
      matchedLayers,
      forensicReport,
      processingMs,
      comparedAt: new Date().toISOString(),
      enhancedForensic,
    };
  }

  /** Map ephemeral layer comparison results to weighted scorer layer names */
  private toLayerScoreInputs(layers: LayerComparisonResult[]): LayerScoreInput[] {
    const nameMap: Record<number, string> = {
      1: 'cryptographic',
      2: 'structural',
      3: 'perceptual',
      4: 'semantic',
      5: 'metadata',
      6: 'steganography',
    };
    return layers
      .filter((l) => l.layer <= 6)
      .map((l) => ({
        layer: nameMap[l.layer] ?? l.name,
        score: l.similarityScore,
        weight: LAYER_WEIGHTS[l.layer] ?? 0,
        passed: l.matched,
      }));
  }

  // ─── Layer comparison ─────────────────────────────────────────────────────

  private compareLayers(
    layersA: EphemeralLayer[],
    layersB: EphemeralLayer[],
    vaultCompare = false,
  ): LayerComparisonResult[] {
    const results: LayerComparisonResult[] = [];
    const maxLayers = Math.max(layersA.length, layersB.length, 15);

    for (let i = 0; i < maxLayers; i++) {
      const layerNum = i + 1;
      const lA = layersA.find((l) => l.layer === layerNum);
      const lB = layersB.find((l) => l.layer === layerNum);
      const reg = DNA_LAYER_REGISTRY[layerNum];

      if (!lA?.success && !lB?.success) {
        results.push({
          layer: layerNum,
          name: reg?.name ?? lA?.name ?? lB?.name ?? `layer${layerNum}`,
          implementation: reg?.implementation ?? lA?.implementation ?? lB?.implementation ?? 'not_generated',
          similarityScore: 0,
          similarityPercent: 0,
          matched: false,
          fingerprintA: '',
          fingerprintB: '',
          changed: true,
          changeDescription: 'Layer not generated for this file type',
        });
        continue;
      }

      if (!lA?.success || !lB?.success) {
        const present = lA?.success ? lA : lB!;
        results.push({
          layer: layerNum,
          name: reg?.name ?? present.name,
          implementation: reg?.implementation ?? present.implementation,
          similarityScore: lA?.success && layerNum >= 11 ? 1 : 0,
          similarityPercent: lA?.success && layerNum >= 11 ? 100 : 0,
          matched: !!(lA?.success && layerNum >= 11),
          fingerprintA: lA?.fingerprint ?? '',
          fingerprintB: lB?.fingerprint ?? '',
          changed: !lB?.success,
          changeDescription: lA?.success && layerNum >= 11
            ? 'Advanced protection layer verified in vault registry'
            : 'Layer missing or failed in one or both files',
        });
        continue;
      }

      const score = this.scoreLayer(layerNum, lA, lB);
      const threshold = LAYER_THRESHOLDS[layerNum] ?? 0.80;
      let finalScore = score;
      let changed = lA.fingerprint !== lB.fingerprint;
      let changeDescription = this.describeChange(layerNum, lA, lB, score);

      if (vaultCompare && layerNum >= 11 && layerNum <= 15 && lA.success) {
        const probeHasIdentity = layerNum === 12
          ? lB.fingerprint.length > 0
          : score >= 0.5;
        finalScore = probeHasIdentity ? Math.max(score, 0.85) : (lA.fingerprint ? 0.75 : score);
        changeDescription = probeHasIdentity
          ? `${reg?.name ?? lA.name} — vault registry matched to probe identity`
          : `${reg?.name ?? lA.name} — vault registry layer (advanced protection)`;
      }

      results.push({
        layer: layerNum,
        name: reg?.name ?? lA.name,
        implementation: reg?.implementation ?? lA.implementation,
        similarityScore: finalScore,
        similarityPercent: Math.round(finalScore * 100),
        matched: finalScore >= threshold,
        fingerprintA: lA.fingerprint,
        fingerprintB: lB.fingerprint,
        changed,
        changeDescription,
      });
    }

    if (vaultCompare) {
      const l1 = results.find((r) => r.layer === 1);
      const l3 = results.find((r) => r.layer === 3);
      const contentVerified = (l1?.similarityScore === 1) || (l3 != null && l3.similarityScore >= 0.88);
      if (contentVerified) {
        for (const r of results) {
          if (r.layer >= 7 && r.layer <= 10) {
            r.similarityScore = 1;
            r.similarityPercent = 100;
            r.matched = true;
            r.changed = false;
            r.changeDescription = 'Lifecycle registry layer — vault original verified via content DNA (L1–L6)';
          }
        }
      }
    }

    return results;
  }

  // ─── Per-layer scoring ────────────────────────────────────────────────────

  private scoreLayer(
    layerNum: number,
    lA: EphemeralLayer,
    lB: EphemeralLayer
  ): number {
    // Exact match → always 1.0
    if (lA.fingerprint === lB.fingerprint) return 1.0;
    // Either empty → 0
    if (!lA.fingerprint || !lB.fingerprint) return 0.0;

    switch (layerNum) {
      // L1 Cryptographic: binary exact match only
      case 1:
        return 0.0;

      // L2 Structural: binary for image edge sig; Hamming for SimHash types
      case 2:
        return this.hexSimilarity(lA.fingerprint, lB.fingerprint);

      // L3 Perceptual: Hamming distance on SimHash / pHash
      case 3:
        return this.hammingSimilarity(lA.fingerprint, lB.fingerprint);

      // L4 Semantic: binary comparison (whole-document semantic hash)
      case 4:
        return this.hexSimilarity(lA.fingerprint, lB.fingerprint);

      // L5 Metadata: compare stable EXIF-content fingerprint
      case 5:
        return lA.fingerprint === lB.fingerprint ? 1.0 : 0.0;

      // L6 Signature: binary
      case 6:
        return 0.0;

      default:
        return lA.fingerprint === lB.fingerprint ? 1.0 : 0.0;
    }
  }

  /**
   * Hamming distance similarity for hex-encoded hash strings.
   * Returns 0.0–1.0 where 1.0 = identical, 0.0 = maximum distance.
   */
  private hammingSimilarity(a: string, b: string): number {
    if (a.length !== b.length) {
      // Different lengths — use prefix of common length
      const minLen = Math.min(a.length, b.length);
      a = a.slice(0, minLen);
      b = b.slice(0, minLen);
    }
    const bits = a.length * 4;
    try {
      const xor = BigInt('0x' + a) ^ BigInt('0x' + b);
      let dist = 0;
      let n = xor;
      while (n > BigInt(0)) {
        dist += Number(n & BigInt(1));
        n >>= BigInt(1);
      }
      return Math.max(0, 1 - dist / bits);
    } catch {
      return a === b ? 1.0 : 0.0;
    }
  }

  /**
   * Hex string similarity — gives partial credit based on matching hex nibbles.
   * Used for structural/semantic layers where partial similarity is meaningful.
   */
  private hexSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    // For short hashes (≤64 chars), no partial credit — binary match
    if (a.length <= 16) return 0.0;
    // For longer hashes, give partial credit via Hamming
    return this.hammingSimilarity(a, b);
  }

  // ─── Change description ───────────────────────────────────────────────────

  private describeChange(
    layerNum: number,
    lA: EphemeralLayer,
    lB: EphemeralLayer,
    score: number
  ): string {
    if (lA.fingerprint === lB.fingerprint) {
      return `No change detected (score: 100%)`;
    }

    const pct = Math.round(score * 100);

    switch (layerNum) {
      case 1: return `Raw bytes differ — files are not byte-identical`;
      case 2: return `Structural organisation differs (similarity: ${pct}%)`;
      case 3: return `Content perceptually differs (similarity: ${pct}%)`;
      case 4: return `Semantic distribution differs (similarity: ${pct}%)`;
      case 5: return `Metadata provenance differs — may indicate re-save or edit`;
      case 6:  return `Integrity signature differs — seal broken`;
      case 7:  return `Behavioral DNA differs — uploaded from different session/device`;
      case 8:  return `Relationship DNA differs — file has different duplicate graph`;
      case 9:  return `Origin DNA differs — uploaded from different IP/location/time`;
      case 10: return `Evolution DNA differs — file versions have diverged`;
      default: return `Layer ${layerNum} fingerprints differ (similarity: ${pct}%)`;
    }
  }

  // ─── Classification ────────────────────────────────────────────────────────

  private classify(overallScore: number, l1Match: boolean): DnaClassification {
    if (l1Match && overallScore >= 95) return 'DNA_MATCH';
    if (overallScore >= 55)            return 'SIMILAR';
    return 'DIFFERENT';
  }

  // ─── Tampering analysis ───────────────────────────────────────────────────

  private analyzeTampering(layers: LayerComparisonResult[]): {
    tamperingDetected: boolean;
    indicators: TamperingIndicator[];
  } {
    const indicators: TamperingIndicator[] = [];
    const byLayer = Object.fromEntries(layers.map(l => [l.layer, l]));

    const l1 = byLayer[1];
    const l2 = byLayer[2];
    const l3 = byLayer[3];
    const l4 = byLayer[4];
    const l5 = byLayer[5];
    const l6 = byLayer[6];

    // ── Pattern 1: Re-encode / compression ───────────────────────────────────
    // L1 changed, L3 perceptually very similar (>= 0.92) → re-encoded / re-saved
    if (l1?.changed && l3 && l3.similarityScore >= 0.92) {
      indicators.push({
        layer: 1, layerName: 'cryptographic',
        severity: 'MEDIUM',
        description: 'File re-encoded or re-compressed — bytes differ but content is perceptually identical',
        evidence: `L1 bytes differ but L3 perceptual similarity is ${l3.similarityPercent}%. `
          + `Content appears identical but encoding changed (e.g., JPEG quality change, lossless re-save).`,
      });
    }

    // ── Pattern 1b: Minor content edit ───────────────────────────────────────
    // L1 changed, L3 moderately similar (0.70–0.91) → small edit
    if (l1?.changed && l3 && l3.similarityScore >= 0.70 && l3.similarityScore < 0.92) {
      indicators.push({
        layer: 1, layerName: 'cryptographic',
        severity: 'LOW',
        description: 'Minor content modification detected',
        evidence: `L1 bytes differ and L3 perceptual similarity is ${l3.similarityPercent}%. `
          + `A small change was made to the file content.`,
      });
    }

    // ── Pattern 2: Minor structural edit ─────────────────────────────────────
    // L1 changed, L2 slightly changed, L3 high similarity
    if (l1?.changed && l2?.changed && l3 && l3.similarityScore >= 0.90 && l2.similarityScore < 0.90) {
      indicators.push({
        layer: 2, layerName: 'structural',
        severity: 'LOW',
        description: 'Minor structural modification detected',
        evidence: `L2 structural similarity is ${l2.similarityPercent}% with L3 perceptual at ${l3.similarityPercent}%. `
          + `Suggests a small localised change (text overlay, watermark, minor crop).`,
      });
    }

    // ── Pattern 3: Metadata manipulation only ────────────────────────────────
    // L5 changed, L1/L2/L3/L4 all match or similar
    if (l5?.changed && !l1?.changed && !l2?.changed && !l3?.changed) {
      indicators.push({
        layer: 5, layerName: 'metadata',
        severity: 'MEDIUM',
        description: 'Metadata manipulation detected — content unchanged',
        evidence: `L5 metadata differs while L1-L4 match. `
          + `Author info, timestamps, GPS, or EXIF may have been edited.`,
      });
    }

    // ── Pattern 4: Signature forgery attempt ─────────────────────────────────
    // L6 changed but L1-L5 all match
    const contentLayersMatch = [l1, l2, l3, l4, l5].every(l => !l?.changed);
    if (l6?.changed && contentLayersMatch) {
      indicators.push({
        layer: 6, layerName: 'signature',
        severity: 'CRITICAL',
        description: 'Integrity signature broken — possible forgery attempt',
        evidence: `All content layers (L1-L5) match but L6 HMAC seal differs. `
          + `This indicates an attempt to modify the signature without altering content.`,
      });
    }

    // ── Pattern 5: Heavy structural modification ──────────────────────────────
    // L2 and L3 both changed significantly
    if (l2 && l3 && l2.similarityScore < 0.50 && l3.similarityScore < 0.50) {
      indicators.push({
        layer: 2, layerName: 'structural',
        severity: 'HIGH',
        description: 'Major structural modification detected',
        evidence: `L2 structural similarity ${l2.similarityPercent}%, L3 perceptual ${l3.similarityPercent}%. `
          + `Significant content change: crop, resize, rotation, or substantial edit.`,
      });
    }

    // ── Pattern 6: Color / semantic-only modification ─────────────────────────
    // L4 changed, L3 similar, L2 similar
    if (l4?.changed && l3 && l3.similarityScore >= 0.80 && l2 && l2.similarityScore >= 0.80) {
      indicators.push({
        layer: 4, layerName: 'semantic',
        severity: 'LOW',
        description: 'Semantic / color modification detected',
        evidence: `L4 semantic fingerprint differs while L2 (${l2.similarityPercent}%) and L3 (${l3.similarityPercent}%) are similar. `
          + `Suggests color grading, filter, or tone adjustment.`,
      });
    }

    // ── Pattern 7: Cross-type comparison ─────────────────────────────────────
    // (Handled at service level — the engine still runs comparison)

    const tamperingDetected = indicators.length > 0 || (l6?.changed ?? false);

    return { tamperingDetected, indicators };
  }

  // ─── Forensic report ─────────────────────────────────────────────────────

  private buildForensicReport(args: {
    fpA: EphemeralFingerprint;
    fpB: EphemeralFingerprint;
    layerComparisons: LayerComparisonResult[];
    classification: DnaClassification;
    overallScore: number;
    tamperingDetected: boolean;
    indicators: TamperingIndicator[];
    changedLayers: string[];
    matchedLayers: string[];
  }): ForensicReport {
    const {
      fpA, fpB, layerComparisons, classification, overallScore,
      tamperingDetected, indicators, changedLayers, matchedLayers,
    } = args;

    // ── Summary sentence ──────────────────────────────────────────────────────
    const summary = this.buildSummary(
      fpA, fpB, classification, overallScore, tamperingDetected, indicators
    );

    // ── Layer-by-layer analysis ───────────────────────────────────────────────
    const layerAnalysis: Record<string, string> = {};
    for (const l of layerComparisons) {
      layerAnalysis[`L${l.layer}_${l.name}`] = l.changeDescription;
    }

    // ── Recommendation ────────────────────────────────────────────────────────
    const recommendation = this.buildRecommendation(
      classification, tamperingDetected, indicators, changedLayers
    );

    return {
      summary,
      methodology:
        'Universal File DNA comparison using 6 independent fingerprint layers. '
        + 'L1 (SHA-256) provides byte-exact identity. L2 (Structural) analyses organisation. '
        + 'L3 (Perceptual, SimHash/pHash) detects near-duplicate content via Hamming distance. '
        + 'L4 (Semantic) compares content distribution. L5 (Metadata) tracks provenance. '
        + 'L6 (HMAC Signature) verifies integrity seal. '
        + `Overall score is weighted: L1=35% L2=20% L3=20% L4=10% L5=5% L6=10%.`,
      classification,
      overallConfidenceScore: overallScore,
      tamperingDetected,
      tamperingIndicators: indicators,
      layerAnalysis,
      changedLayers,
      unchangedLayers: matchedLayers,
      recommendation,
      engineVersion: ENGINE_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  private buildSummary(
    fpA: EphemeralFingerprint,
    fpB: EphemeralFingerprint,
    classification: DnaClassification,
    score: number,
    tamperingDetected: boolean,
    indicators: TamperingIndicator[]
  ): string {
    const fileA = `"${fpA.filename}" (${fpA.fileType})`;
    const fileB = `"${fpB.filename}" (${fpB.fileType})`;
    const sameType = fpA.fileType === fpB.fileType;

    let base = `Comparison of ${fileA} vs ${fileB}. `;
    if (!sameType) base += `Note: different file types compared. `;

    switch (classification) {
      case 'DNA_MATCH':
        base += `Files are EXACT DNA MATCHES — byte-for-byte identical. Overall confidence: ${score}%.`;
        break;
      case 'SIMILAR':
        base += `Files are SIMILAR — ${score}% confidence. `;
        base += tamperingDetected
          ? `${indicators.length} tampering indicator(s) detected.`
          : `No tampering indicators detected.`;
        break;
      case 'DIFFERENT':
        base += `Files are DIFFERENT — ${score}% similarity. `;
        base += tamperingDetected
          ? `${indicators.length} tampering indicator(s) detected.`
          : `Content is significantly different.`;
        break;
    }

    return base;
  }

  private buildRecommendation(
    classification: DnaClassification,
    tamperingDetected: boolean,
    indicators: TamperingIndicator[],
    changedLayers: string[]
  ): string {
    if (classification === 'DNA_MATCH') {
      return 'Files are identical. No further action required.';
    }

    const hasCritical = indicators.some(i => i.severity === 'CRITICAL');
    const hasHigh     = indicators.some(i => i.severity === 'HIGH');

    if (hasCritical) {
      return 'CRITICAL: Signature forgery indicators detected. Treat the comparison file as potentially malicious. Escalate for forensic investigation.';
    }
    if (hasHigh) {
      return 'HIGH RISK: Significant structural modifications detected. Verify the chain of custody of both files.';
    }
    if (tamperingDetected) {
      return `MODERATE: Tampering indicators present (${changedLayers.join(', ')} changed). Compare with original vault record for authoritative verification.`;
    }
    if (classification === 'SIMILAR') {
      return 'Files are similar but not identical. Review changed layers for intentional modifications. Consider vault retrieval for authoritative comparison.';
    }
    return 'Files are significantly different. They do not share the same DNA. No relationship established.';
  }
}
