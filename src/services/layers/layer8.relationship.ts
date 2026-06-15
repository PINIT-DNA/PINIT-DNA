import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { ImageInput } from '../../types/dna.types';
import { RelationshipLayerResult } from '../../types/dna.types';

export class RelationshipLayer {
  async generate(
    _image: ImageInput,
    dnaRecordId: string,
    sha256Hash: string
  ): Promise<RelationshipLayerResult> {
    const start = Date.now();
    try {
      // Find existing records with same hash (duplicates) or similar filename
      const relatedIds: string[] = [];
      const relationTypes: string[] = [];

      const duplicates = await prisma.dnaRecord.findMany({
        where: {
          sha256Hash,
          id: { not: dnaRecordId },
        },
        select: { id: true },
        take: 10,
      });

      for (const d of duplicates) {
        relatedIds.push(d.id);
        relationTypes.push('DUPLICATE');
      }

      // Compute graph hash from sorted related IDs
      const graphHash = relatedIds.length > 0
        ? crypto.createHash('sha256').update([...relatedIds].sort().join(',')).digest('hex')
        : crypto.createHash('sha256').update(`isolated:${dnaRecordId}`).digest('hex');

      return {
        layer: 8,
        name: 'relationship',
        success: true,
        processingMs: Date.now() - start,
        data: { graphHash, relatedIds, relationTypes },
      };
    } catch (err: any) {
      return {
        layer: 8,
        name: 'relationship',
        success: false,
        processingMs: Date.now() - start,
        error: err.message,
        data: { graphHash: null, relatedIds: [], relationTypes: [] },
      };
    }
  }
}
