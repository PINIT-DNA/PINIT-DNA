/**
 * Standardized DNA layer result — docs/architecture/03_DNA_SPECIFICATION.md
 * Every investigation emits exactly 15 layers. Never undefined/null/missing.
 */
import type { ChannelState } from './acceptance.types';
import { DNA_ALGORITHM_VERSION } from './acceptance.types';

export { DNA_ALGORITHM_VERSION };

export const DNA_LAYER_COUNT = 15 as const;

/** Frozen 15-layer-v1 slot definitions */
export const DNA_LAYER_REGISTRY_V1: ReadonlyArray<{ id: number; name: string; role: string }> = [
  { id: 1, name: 'Cryptographic', role: 'File / content hashes' },
  { id: 2, name: 'Embedded Identity', role: 'Watermark, identity token, manifest' },
  { id: 3, name: 'Metadata', role: 'EXIF, container, PDF info' },
  { id: 4, name: 'Media Fingerprint', role: 'pHash / structure / keyframes / text structure' },
  { id: 5, name: 'AI Fingerprint', role: 'Embeddings / semantic (when available)' },
  { id: 6, name: 'Visual / Audio / Text Features', role: 'ORB, audio, OCR features' },
  { id: 7, name: 'Vector Embedding', role: 'Vault vector similarity' },
  { id: 8, name: 'Certificate', role: 'Binding and validity' },
  { id: 9, name: 'Vault Mapping', role: 'Authoritative vault lock' },
  { id: 10, name: 'Timeline', role: 'Registration and custody events' },
  { id: 11, name: 'Similarity', role: 'Aggregate media similarity' },
  { id: 12, name: 'Owner Verification', role: 'Owner bind to vault' },
  { id: 13, name: 'Tamper Analysis', role: 'Tamper matrix' },
  { id: 14, name: 'Recovery Evidence', role: 'How identity was recovered' },
  { id: 15, name: 'Final Verdict', role: 'Set only by Acceptance Engine' },
] as const;

/**
 * Standardized layer result — always fully populated.
 */
export interface StandardizedDnaLayer {
  /** Layer id 1–15 */
  id: number;
  name: string;
  status: ChannelState;
  /** 0–100; 0 when FAIL or SKIPPED */
  score: number;
  reason: string;
  evidence: Record<string, unknown>;
  /** Milliseconds spent producing this slot (mapping is near-zero) */
  duration: number;
}

export interface StandardizedDnaBundle {
  dnaAlgorithmVersion: typeof DNA_ALGORITHM_VERSION;
  layerCount: typeof DNA_LAYER_COUNT;
  layers: StandardizedDnaLayer[];
}
