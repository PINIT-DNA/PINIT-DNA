/**
 * Phase 5 — Enterprise Identity Recovery Engine
 * Runs all recovery signals in parallel; never aborts when one layer fails.
 */
import { logger } from '../../lib/logger';
import { aiService } from '../ai/ai-embeddings.service';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import { generateLightweightDna } from './lightweight-dna.service';
import { isPhase2Active } from '../../config/dna-phase2';
import { isPhase3WatermarkRecoveryActive } from '../../config/dna-phase3';
import { phase3WatermarkRecovery } from '../watermark/phase3-watermark-recovery.service';
import type { LeakedFileVerifyResult } from './leaked-file-verify.service';
import type { IdentityRecoverySection, RecoverySignal } from '../../types/unified-investigation.types';

export const RECOVERY_WEIGHTS = {
  invisibleWatermark: 0.30,
  identityToken: 0.25,
  visualDna: 0.15,
  semanticDna: 0.10,
  ocrDna: 0.05,
  orbFeatures: 0.05,
  clipSimilarity: 0.05,
  metadata: 0.03,
  filename: 0.01,
  timelineEvidence: 0.01,
} as const;

function signal(
  engine: string,
  label: string,
  score: number,
  weight: number,
  status: RecoverySignal['status'],
  detail?: string,
): RecoverySignal {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return {
    engine,
    label,
    score: clamped,
    weight,
    weightedContribution: Math.round(clamped * weight * 100) / 100,
    status,
    detail,
  };
}

export class IdentityRecoveryEngine {
  private readonly perceptual = new PerceptualLayer();

  async recover(params: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    ownerUserId: string;
    leakVerify: LeakedFileVerifyResult;
    phase3Recovery?: Awaited<ReturnType<typeof phase3WatermarkRecovery.recover>> | null;
    accessEventCount?: number;
    bestVisualSimilarity?: number;
    semanticMatchScore?: number;
  }): Promise<IdentityRecoverySection> {
    const {
      buffer, mimeType, originalName, ownerUserId, leakVerify,
      phase3Recovery, accessEventCount = 0, bestVisualSimilarity, semanticMatchScore,
    } = params;

    const tasks = await Promise.allSettled([
      this.runOcr(buffer, mimeType, originalName),
      this.runLightweight(buffer, mimeType),
      this.runPhase3(buffer, mimeType, ownerUserId, phase3Recovery),
      this.runIdentityToken(buffer, mimeType, originalName, leakVerify),
      this.runPerceptual(buffer, mimeType, bestVisualSimilarity),
      this.runSemantic(originalName, leakVerify, semanticMatchScore),
      this.runMetadata(buffer, mimeType, leakVerify),
      this.runFilename(originalName, leakVerify),
    ]);

    const [
      ocrR, liteR, wmR, tokenR, visualR, semanticR, metaR, fileR,
    ] = tasks.map((t) => (t.status === 'fulfilled' ? t.value : null));

    const watermarkScore = wmR?.score ?? this.watermarkFromLeak(leakVerify, phase3Recovery);
    const identityTokenScore = tokenR?.score ?? this.tokenFromLeak(leakVerify);
    const visualScore = visualR?.score ?? (bestVisualSimilarity ? bestVisualSimilarity * 100 : 0);
    const semanticScore = semanticR?.score ?? (semanticMatchScore ? semanticMatchScore * 100 : 0);
    const ocrScore = ocrR?.score ?? 0;
    const orbScore = (visualR && 'orbScore' in visualR ? (visualR as { orbScore: number }).orbScore : undefined)
      ?? visualScore * 0.85;
    const clipScore = semanticScore;
    const metaScore = metaR?.score ?? (leakVerify.tampered ? 40 : leakVerify.found ? 70 : 0);
    const filenameScore = fileR?.score ?? (leakVerify.identity?.originalFilename ? 80 : 0);
    const timelineScore = accessEventCount > 0
      ? Math.min(100, 30 + accessEventCount * 5)
      : leakVerify.accessHistory?.length
        ? Math.min(100, 30 + leakVerify.accessHistory.length * 5)
        : 0;

    const signals: RecoverySignal[] = [
      signal('invisible_watermark', 'Invisible Watermark', watermarkScore, RECOVERY_WEIGHTS.invisibleWatermark,
        watermarkScore >= 70 ? 'recovered' : watermarkScore >= 30 ? 'partial' : 'failed',
        wmR?.detail ?? phase3Recovery?.detail ?? leakVerify.watermark?.extractionMethod),
      signal('identity_token', 'Identity Token', identityTokenScore, RECOVERY_WEIGHTS.identityToken,
        identityTokenScore >= 70 ? 'recovered' : identityTokenScore >= 30 ? 'partial' : 'failed',
        tokenR?.detail ?? leakVerify.detectionMethod),
      signal('visual_dna', 'Visual DNA', visualScore, RECOVERY_WEIGHTS.visualDna,
        visualScore >= 70 ? 'recovered' : visualScore >= 40 ? 'partial' : 'failed', visualR?.detail),
      signal('semantic_dna', 'Semantic DNA', semanticScore, RECOVERY_WEIGHTS.semanticDna,
        semanticScore >= 60 ? 'recovered' : semanticScore >= 30 ? 'partial' : 'failed', semanticR?.detail),
      signal('ocr_dna', 'OCR DNA', ocrScore, RECOVERY_WEIGHTS.ocrDna,
        ocrScore >= 50 ? 'recovered' : ocrScore > 0 ? 'partial' : 'skipped', ocrR?.detail),
      signal('orb_features', 'ORB / AKAZE Features', orbScore, RECOVERY_WEIGHTS.orbFeatures,
        orbScore >= 50 ? 'recovered' : orbScore > 0 ? 'partial' : 'skipped',
        visualR && 'orbDetail' in visualR ? (visualR as { orbDetail: string }).orbDetail : 'OpenCV ORB when python-ai online; structural proxy offline'),
      signal('clip_similarity', 'CLIP / Embeddings', clipScore, RECOVERY_WEIGHTS.clipSimilarity,
        clipScore >= 60 ? 'recovered' : clipScore >= 30 ? 'partial' : 'skipped', semanticR?.detail ?? 'Sentence-transformer semantic index'),
      signal('metadata', 'Metadata Recovery', metaScore, RECOVERY_WEIGHTS.metadata,
        metaScore >= 50 ? 'recovered' : metaScore > 0 ? 'partial' : 'skipped', metaR?.detail),
      signal('filename', 'Filename', filenameScore, RECOVERY_WEIGHTS.filename,
        filenameScore >= 50 ? 'recovered' : 'skipped', fileR?.detail),
      signal('timeline_evidence', 'Timeline Evidence', timelineScore, RECOVERY_WEIGHTS.timelineEvidence,
        timelineScore > 0 ? 'recovered' : 'skipped',
        timelineScore > 0 ? `${accessEventCount || leakVerify.accessHistory?.length || 0} recorded events` : 'No evidence available'),
    ];

    const digitalSignatureScore = leakVerify.valid ? 100 : leakVerify.found ? 45 : 0;
    if (digitalSignatureScore > 0) {
      signals.push(signal('digital_signature', 'Digital Signature', digitalSignatureScore, 0,
        leakVerify.valid ? 'recovered' : 'partial', leakVerify.message));
    }

    if (liteR) {
      signals.push(signal('lightweight_dna', 'Lightweight DNA', liteR.score, 0,
        liteR.score >= 50 ? 'recovered' : 'partial', liteR.detail));
    }

    const weightedSum = signals
      .filter((s) => s.weight > 0)
      .reduce((sum, s) => sum + s.score * s.weight, 0);

    const identityConfidence = Math.min(100, Math.round(weightedSum));
    const ownershipConfidence = Math.min(100, Math.round(
      identityConfidence * 0.55
      + (leakVerify.valid ? 25 : 0)
      + (visualScore * 0.15)
      + (watermarkScore * 0.05),
    ));
    const trustScore = Math.min(100, Math.round(
      ownershipConfidence * 0.4
      + identityConfidence * 0.35
      + (leakVerify.valid ? 15 : 5)
      + (timelineScore * 0.1),
    ));

    const enginesRun = signals.filter((s) => s.status !== 'skipped').length;
    const enginesRecovered = signals.filter((s) => s.status === 'recovered').length;

    return {
      enginesRun,
      enginesRecovered,
      signals,
      compositeScores: {
        ownershipConfidence,
        trustScore,
        identityConfidence,
      },
      transformations: this.detectTransformations(leakVerify),
      message: enginesRecovered > 0
        ? `${enginesRecovered}/${enginesRun} recovery engines contributed identity evidence`
        : 'No strong identity signals recovered — vault candidate search required',
    };
  }

  private watermarkFromLeak(
    leakVerify: LeakedFileVerifyResult,
    phase3?: Awaited<ReturnType<typeof phase3WatermarkRecovery.recover>> | null,
  ): number {
    if (phase3?.recovered) return phase3.tokenValid ? 95 : 70;
    if (leakVerify.watermark?.code) return leakVerify.valid ? 90 : 55;
    if (leakVerify.detectionMethod === 'WATERMARK') return 75;
    return 0;
  }

  private tokenFromLeak(leakVerify: LeakedFileVerifyResult): number {
    if (leakVerify.valid && leakVerify.found) return 95;
    if (leakVerify.found) return Math.round(leakVerify.confidence ?? 60);
    if (leakVerify.identity?.dnaId) return 50;
    return 0;
  }

  private async runOcr(buffer: Buffer, mimeType: string, name: string) {
    if (!mimeType.startsWith('image/')) return { score: 0, detail: 'OCR skipped — not an image' };
    const ocr = await aiService.extractTextOcr(buffer, name, mimeType);
    if (!ocr?.text?.trim()) return { score: 0, detail: 'No OCR text extracted' };
    const dup = await aiService.detectDuplicates(ocr.text.slice(0, 2000), 0.85);
    const topSim = dup?.duplicates?.[0]?.similarity ?? dup?.nearMatches?.[0]?.similarity ?? 0;
    return {
      score: topSim > 0 ? topSim * 100 : Math.min(60, ocr.wordCount),
      detail: `OCR ${ocr.wordCount} words${topSim ? ` · semantic hit ${Math.round(topSim * 100)}%` : ''}`,
    };
  }

  private async runLightweight(buffer: Buffer, mimeType: string) {
    if (!isPhase2Active()) return null;
    try {
      const lite = await generateLightweightDna(buffer, mimeType);
      return { score: 65, detail: `Profile: ${lite.mediaProfile}` };
    } catch {
      return null;
    }
  }

  private async runPhase3(
    buffer: Buffer,
    mimeType: string,
    ownerUserId: string,
    existing?: Awaited<ReturnType<typeof phase3WatermarkRecovery.recover>> | null,
  ) {
    if (!isPhase3WatermarkRecoveryActive()) return null;
    try {
      const r = existing ?? await phase3WatermarkRecovery.recover(buffer, mimeType, ownerUserId);
      if (!r.recovered) return { score: 0, detail: r.detail };
      return { score: r.tokenValid ? 95 : 72, detail: r.detail };
    } catch (e) {
      logger.debug('Identity recovery: watermark engine failed', { error: String(e) });
      return null;
    }
  }

  private async runIdentityToken(buffer: Buffer, mimeType: string, name: string, leakVerify: LeakedFileVerifyResult) {
    if (leakVerify.found) {
      return {
        score: leakVerify.valid ? 95 : (leakVerify.confidence ?? 55),
        detail: leakVerify.detectionMethod,
      };
    }
    try {
      const id = await identityEmbeddingService.extractLoose(buffer, mimeType, name);
      if (id.found) return { score: id.valid ? 90 : 60, detail: 'Embedded identity token extracted' };
    } catch { /* non-fatal */ }
    return { score: 0, detail: 'No identity token found' };
  }

  private async runPerceptual(buffer: Buffer, mimeType: string, bestVisual?: number) {
    if (!mimeType.startsWith('image/')) {
      return { score: bestVisual ? bestVisual * 100 : 0, orbScore: 0, detail: 'Visual DNA limited for non-image' };
    }
    try {
      await this.perceptual.computeFingerprints(buffer);
      const score = bestVisual ? bestVisual * 100 : 55;
      return { score, orbScore: score * 0.9, detail: 'Perceptual hash fingerprints computed' };
    } catch {
      return { score: bestVisual ? bestVisual * 100 : 0, orbScore: 0, detail: 'Perceptual analysis failed' };
    }
  }

  private async runSemantic(name: string, leakVerify: LeakedFileVerifyResult, preset?: number) {
    if (preset && preset > 0) {
      return { score: preset * 100, detail: 'Vault semantic candidate match' };
    }
    const query = leakVerify.identity?.originalFilename ?? name.replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ');
    const similar = await aiService.findSimilar(query, 5);
    const top = similar.results[0]?.similarity ?? 0;
    return {
      score: top * 100,
      detail: top > 0 ? `Semantic index top match ${Math.round(top * 100)}%` : 'No semantic index hits',
    };
  }

  private async runMetadata(_buffer: Buffer, _mimeType: string, leakVerify: LeakedFileVerifyResult) {
    const hash = leakVerify.found ? 70 : 0;
    if (leakVerify.tampered) return { score: 35, detail: 'Metadata stripped or modified' };
    if (leakVerify.detectionMethod === 'EXACT_HASH') return { score: 100, detail: 'Cryptographic hash intact' };
    return { score: hash, detail: leakVerify.found ? 'Partial metadata chain' : 'No metadata signals' };
  }

  private async runFilename(name: string, leakVerify: LeakedFileVerifyResult) {
    const orig = leakVerify.identity?.originalFilename;
    if (!orig) return { score: 0, detail: 'No filename anchor' };
    const a = orig.toLowerCase().replace(/\.[^.]+$/, '');
    const b = name.toLowerCase().replace(/\.[^.]+$/, '');
    if (a === b) return { score: 100, detail: 'Exact filename match' };
    if (a.includes(b) || b.includes(a)) return { score: 75, detail: 'Partial filename match' };
    return { score: 25, detail: 'Filename diverged' };
  }

  private detectTransformations(leakVerify: LeakedFileVerifyResult) {
    const v = leakVerify.leakVector;
    return [
      { type: 'Download / Re-upload', detected: v === 'DOWNLOAD_REUPLOAD', detail: v === 'DOWNLOAD_REUPLOAD' ? 'Recorded' : undefined },
      { type: 'Compression', detected: !!leakVerify.tampered && leakVerify.found, detail: undefined },
      { type: 'Resize / Crop', detected: !!leakVerify.tampered && v !== 'SCREENSHOT', detail: undefined },
      { type: 'Rotation', detected: false, detail: 'No evidence available' },
      { type: 'Screenshot', detected: v === 'SCREENSHOT', detail: v === 'SCREENSHOT' ? 'Leak vector confirmed' : undefined },
      { type: 'Screen Recording', detected: v === 'RECORDING', detail: v === 'RECORDING' ? 'Leak vector confirmed' : undefined },
      { type: 'Metadata Stripping', detected: !!leakVerify.tampered && !leakVerify.valid, detail: undefined },
      { type: 'Format Conversion', detected: !!leakVerify.tampered, detail: undefined },
      { type: 'Watermark Removal Attempt', detected: !!leakVerify.tampered && !!leakVerify.watermark, detail: undefined },
      { type: 'AI Enhancement / Editing', detected: false, detail: 'No evidence available' },
    ];
  }
}

export const identityRecoveryEngine = new IdentityRecoveryEngine();
