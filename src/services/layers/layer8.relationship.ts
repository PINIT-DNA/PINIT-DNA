/**
 * Layer 8 — Relationship.
 *
 * Not a content-matching layer in its own right — the comparison engine
 * (comparison-engine.ts) marks it `skipped` in every compare mode, never
 * scored. graphHash is a re-hash of relatedIds/L1+L3 data, not independent
 * signal.
 *
 * relatedIds IS real: it queries for other DnaRecords sharing this exact
 * SHA-256 at generation time. But that is the identical exact-hash check
 * Layer 1 and the live duplicate-check pipeline already do independently,
 * at detection time — this is a redundant audit snapshot, not something
 * detection reads. Its real value is as a reference record (which other
 * records exist with this hash), not as additional catching power.
 */

import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { ImageInput } from '../../types/dna.types';
import { RelationshipLayerResult } from '../../types/dna.types';
import {
  computeFamilyId,
  isDnaDeterministicModeEnabled,
} from '../dna/deterministic-identity';
import {
  logIdentityLayerCompleted,
  logIdentityLayerStarted,
} from '../dna/identity-generation-logger';

export class RelationshipLayer {
  async generate(
    _image: ImageInput,
    dnaRecordId: string,
    sha256Hash: string,
    perceptualPrimary?: string,
  ): Promise<RelationshipLayerResult> {
    const start = Date.now();
    const deterministic = isDnaDeterministicModeEnabled();
    logIdentityLayerStarted(8, 'relationship', { deterministic });

    try {
      const relatedIds: string[] = [];
      const relationTypes: string[] = [];

      const duplicates = await prisma.dnaRecord.findMany({
        where: { sha256Hash, id: { not: dnaRecordId } },
        select: { id: true },
        take: 10,
      });

      for (const d of duplicates) {
        relatedIds.push(d.id);
        relationTypes.push('DUPLICATE');
      }

      const graphHash = deterministic
        ? computeFamilyId(sha256Hash, perceptualPrimary ?? '')
        : relatedIds.length > 0
          ? crypto.createHash('sha256').update([...relatedIds].sort().join(',')).digest('hex')
          : crypto.createHash('sha256').update(`isolated:${dnaRecordId}`).digest('hex');

      const result: RelationshipLayerResult = {
        layer: 8,
        name: 'relationship',
        success: true,
        processingMs: Date.now() - start,
        data: { graphHash, relatedIds, relationTypes },
      };

      logIdentityLayerCompleted({
        layer: 8,
        name: 'relationship',
        durationMs: result.processingMs,
        fingerprintLength: graphHash.length,
        success: true,
        deterministic,
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logIdentityLayerCompleted({
        layer: 8,
        name: 'relationship',
        durationMs: Date.now() - start,
        fingerprintLength: 0,
        success: false,
        deterministic,
      });
      return {
        layer: 8,
        name: 'relationship',
        success: false,
        processingMs: Date.now() - start,
        error: message,
        data: { graphHash: null, relatedIds: [], relationTypes: [] },
      };
    }
  }
}
