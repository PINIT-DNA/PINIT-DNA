import crypto from 'crypto';
import { ImageInput } from '../../types/dna.types';
import { EvolutionLayerResult } from '../../types/dna.types';

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
      const left  = hashes[i];
      const right = hashes[i + 1] ?? left; // duplicate last if odd
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
    try {
      const originEntry: MutationEntry = {
        version: 1,
        hash:    sha256Hash,
        ts:      new Date().toISOString(),
        type:    'ORIGIN',
      };

      const mutationLog: MutationEntry[] = [originEntry];

      const leaves = mutationLog.map(m =>
        crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex')
      );
      const merkleRoot = buildMerkleRoot(leaves);

      return {
        layer: 10,
        name: 'evolution',
        success: true,
        processingMs: Date.now() - start,
        data: { merkleRoot, mutationLog, version: 1 },
      };
    } catch (err: any) {
      return {
        layer: 10,
        name: 'evolution',
        success: false,
        processingMs: Date.now() - start,
        error: err.message,
        data: { merkleRoot: null, mutationLog: [], version: 1 },
      };
    }
  }
}
