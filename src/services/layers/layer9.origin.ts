import crypto from 'crypto';
import { ImageInput } from '../../types/dna.types';
import { OriginLayerResult } from '../../types/dna.types';

export class OriginLayer {
  async generate(
    image: ImageInput,
    dnaRecordId: string,
    ctx?: { ip?: string; userAgent?: string; country?: string; city?: string }
  ): Promise<OriginLayerResult> {
    const start = Date.now();
    try {
      const originBundle = {
        dnaRecordId,
        ip:        ctx?.ip       ?? 'unknown',
        userAgent: ctx?.userAgent ?? 'unknown',
        country:   ctx?.country  ?? 'unknown',
        city:      ctx?.city     ?? 'unknown',
        filename:  image.originalName,
        mimeType:  image.mimeType,
        sizeBytes: image.sizeBytes,
        timestamp: new Date().toISOString(),
      };

      const bundleHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(originBundle))
        .digest('hex');

      return {
        layer: 9,
        name: 'origin',
        success: true,
        processingMs: Date.now() - start,
        data: { originBundle, bundleHash },
      };
    } catch (err: any) {
      return {
        layer: 9,
        name: 'origin',
        success: false,
        processingMs: Date.now() - start,
        error: err.message,
        data: { originBundle: {}, bundleHash: '' },
      };
    }
  }
}
