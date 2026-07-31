/**
 * Local feature matching — ORB/AKAZE via Python OpenCV when available;
 * Node fallback uses structural edge signatures + multi-scale perceptual hashes.
 */
import { logger } from '../../lib/logger';
import { aiService } from '../ai/ai-embeddings.service';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import { StructuralLayer } from '../layers/layer2.structural';

export interface LocalFeatureMatchResult {
  similarity: number;
  method: string;
  keypointMatches?: number;
}

export class LocalFeatureMatchService {
  private readonly perceptual = new PerceptualLayer();
  private readonly structural = new StructuralLayer();

  async compare(probe: Buffer, reference: Buffer): Promise<LocalFeatureMatchResult> {
    const cv = await aiService.compareImages(probe, reference);
    if (cv && cv.similarity > 0) {
      return {
        similarity: cv.similarity,
        method: cv.method,
        keypointMatches: cv.keypointMatches,
      };
    }

    return this.fallbackCompare(probe, reference);
  }

  private async fallbackCompare(probe: Buffer, reference: Buffer): Promise<LocalFeatureMatchResult> {
    try {
      const [probeP, refP] = await Promise.all([
        this.perceptual.computeFingerprints(probe),
        this.perceptual.computeFingerprints(reference),
      ]);
      const pSim = this.perceptual.verify(probeP, refP);

      const probeStruct = await this.structural.generate({
        filePath: '',
        buffer: probe,
        originalName: 'probe',
        mimeType: 'image/jpeg',
        sizeBytes: probe.length,
      });
      const refStruct = await this.structural.generate({
        filePath: '',
        buffer: reference,
        originalName: 'ref',
        mimeType: 'image/jpeg',
        sizeBytes: reference.length,
      });
      const sSim = probeStruct.success && refStruct.success
        ? this.structural.verify(probeStruct.data, { edgeSignature64: refStruct.data.edgeSignature64 })
        : 0;

      const similarity = Math.max(0, Math.min(1, pSim * 0.65 + sSim * 0.35));
      return {
        similarity,
        method: 'node_structural_perceptual_proxy',
      };
    } catch (e) {
      logger.debug('Local feature fallback failed', { error: String(e) });
      return { similarity: 0, method: 'unavailable' };
    }
  }
}

export const localFeatureMatchService = new LocalFeatureMatchService();
