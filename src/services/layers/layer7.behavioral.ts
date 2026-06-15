import crypto from 'crypto';
import { ImageInput } from '../../types/dna.types';
import { BehavioralLayerResult } from '../../types/dna.types';

export class BehavioralLayer {
  async generate(
    image: ImageInput,
    dnaRecordId: string,
    uploadStartMs: number,
    userAgent?: string,
    sessionToken?: string
  ): Promise<BehavioralLayerResult> {
    const start = Date.now();
    try {
      const uploadMs = Date.now() - uploadStartMs;

      // Bundle behavioral signals
      const bundle = {
        dnaRecordId,
        filename:     image.originalName,
        sizeBytes:    image.sizeBytes,
        mimeType:     image.mimeType,
        uploadMs,
        userAgent:    userAgent ?? 'unknown',
        sessionToken: sessionToken ?? 'unknown',
        ts:           new Date().toISOString(),
      };

      const behaviorHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(bundle))
        .digest('hex');

      // Hashed session token so raw value is never stored
      const hashedSession = sessionToken
        ? crypto.createHash('sha256').update(sessionToken).digest('hex').slice(0, 16)
        : undefined;

      return {
        layer: 7,
        name: 'behavioral',
        success: true,
        processingMs: Date.now() - start,
        data: {
          behaviorHash,
          uploadMs,
          sessionToken: hashedSession,
          userAgent: userAgent ?? null,
        },
      };
    } catch (err: any) {
      return {
        layer: 7,
        name: 'behavioral',
        success: false,
        processingMs: Date.now() - start,
        error: err.message,
        data: { behaviorHash: '', uploadMs: 0, sessionToken: undefined, userAgent: null },
      };
    }
  }
}
