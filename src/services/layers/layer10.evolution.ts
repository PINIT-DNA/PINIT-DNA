/**
 * Layer 10 — Evolution / Derivation lineage head.
 *
 * Milestone B Step 1: when DNA_DETERMINISTIC_MODE is ON, merkle leaf excludes
 * wall-clock (EDS L10). mutationLog may still record ORIGIN for audit UI.
 */

import crypto from 'crypto';
import { ImageInput } from '../../types/dna.types';
import { EvolutionLayerResult } from '../../types/dna.types';
import {
  computeLineageMerkleHead,
  isDnaDeterministicModeEnabled,
} from '../dna/deterministic-identity';
import {
  logIdentityLayerCompleted,
  logIdentityLayerStarted,
} from '../dna/identity-generation-logger';

interface MutationEntry {
  version: number;
  hash: string;
  ts: string;
  type: 'ORIGIN' | 'UPLOAD' | 'MODIFIED' | 'DERIVED';
}

function buildMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return crypto.createHash('sha256').update('empty').digest('hex');
  if (leaves.length === 1) return leaves[0];

  const hashes = [...leaves];
  while (hashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = hashes[i + 1] ?? left;
      next.push(crypto.createHash('sha256').update(left + right).digest('hex'));
    }
    hashes.splice(0, hashes.length, ...next);
  }
  return hashes[0];
}

export class EvolutionLayer {
  async generate(
    _image: ImageInput,
    _dnaRecordId: string,
    sha256Hash: string
  ): Promise<EvolutionLayerResult> {
    const start = Date.now();
    const deterministic = isDnaDeterministicModeEnabled();
    logIdentityLayerStarted(10, 'evolution', { deterministic });

    try {
      const originEntry: MutationEntry = {
        version: 1,
        hash: sha256Hash,
        // Meta only — excluded from merkle when deterministic
        ts: new Date().toISOString(),
        type: 'ORIGIN',
      };
      const mutationLog: MutationEntry[] = [originEntry];

      const merkleRoot = deterministic
        ? computeLineageMerkleHead(sha256Hash, 'ORIGIN')
        : buildMerkleRoot(
            mutationLog.map((m) =>
              crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex'),
            ),
          );

      const result: EvolutionLayerResult = {
        layer: 10,
        name: 'evolution',
        success: true,
        processingMs: Date.now() - start,
        data: { merkleRoot, mutationLog, version: 1 },
      };

      logIdentityLayerCompleted({
        layer: 10,
        name: 'evolution',
        durationMs: result.processingMs,
        fingerprintLength: (merkleRoot ?? '').length,
        success: true,
        deterministic,
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logIdentityLayerCompleted({
        layer: 10,
        name: 'evolution',
        durationMs: Date.now() - start,
        fingerprintLength: 0,
        success: false,
        deterministic,
      });
      return {
        layer: 10,
        name: 'evolution',
        success: false,
        processingMs: Date.now() - start,
        error: message,
        data: { merkleRoot: null, mutationLog: [], version: 1 },
      };
    }
  }
}
