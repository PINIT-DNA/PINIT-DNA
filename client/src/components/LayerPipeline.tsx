import { motion } from 'framer-motion';
import { LayerCard } from './LayerCard';
import type { LayerState } from '../types';

const LAYERS = [
  {
    number: 1,
    icon: '🔐',
    label: 'Cryptographic Fingerprint',
    description: 'SHA-256 + BLAKE3 of raw bytes — exact identity, tamper-proof',
  },
  {
    number: 2,
    icon: '🏗️',
    label: 'Structural Fingerprint',
    description: 'File organisation: edges/pages/rows/entries/slides/boxes',
  },
  {
    number: 3,
    icon: '👁️',
    label: 'Perceptual Hash',
    description: 'SimHash / DCT pHash — detects near-duplicate content',
  },
  {
    number: 4,
    icon: '🎨',
    label: 'Semantic Analysis',
    description: 'Content meaning: word freq / color dist / type distribution',
  },
  {
    number: 5,
    icon: '🏷️',
    label: 'Metadata Provenance',
    description: 'Author, dates, encoding, codec, EXIF / ID3 / OPC tags',
  },
  {
    number: 6,
    icon: '🔏',
    label: 'HMAC Signature Seal',
    description: 'HMAC-SHA256 of all layers — proves origin + integrity',
  },
  {
    number: 7,
    icon: '🧠',
    label: 'Behavioral DNA',
    description: 'Upload timing, user agent, session — captures upload behaviour',
  },
  {
    number: 8,
    icon: '🔗',
    label: 'Relationship DNA',
    description: 'Graph of duplicate/related files — detects re-uploads across owners',
  },
  {
    number: 9,
    icon: '🌐',
    label: 'Origin DNA',
    description: 'IP, geo-location, device, timestamp — proves where a file came from',
  },
  {
    number: 10,
    icon: '🧬',
    label: 'Evolution DNA',
    description: 'Merkle-tree mutation log — tracks every version of the file over time',
  },
  {
    number: 11,
    icon: '🤖',
    label: 'AI Deepfake Detection',
    description: 'Pixel noise analysis — detects AI-generated or manipulated files',
  },
  {
    number: 12,
    icon: '🔲',
    label: 'DCT Watermark',
    description: 'Invisible frequency-domain watermark — survives screenshots + re-encoding',
  },
  {
    number: 13,
    icon: '⚖️',
    label: 'Legal Chain of Custody',
    description: 'Court-admissible evidence chain — timestamps, hashes, DMCA-ready proof',
  },
  {
    number: 14,
    icon: '🔑',
    label: 'Zero-Knowledge Proof',
    description: 'Prove file ownership without revealing contents — for confidential docs',
  },
  {
    number: 15,
    icon: '👤',
    label: 'Biometric Identity Bind',
    description: 'Binds uploader face biometric hash to file — proves the exact person',
  },
];

interface Props {
  layerStates: LayerState[];
  completedCount: number;
}

export function LayerPipeline({ layerStates, completedCount }: Props) {
  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400 font-medium">DNA Generation Pipeline</p>
        <span className="mono text-xs text-dna-400">{completedCount}/{layerStates.length} layers</span>
      </div>

      {/* Progress track */}
      <div className="w-full bg-bg-border rounded-full h-1.5 mb-5">
        <motion.div
          className="h-1.5 rounded-full bg-gradient-to-r from-dna-600 to-dna-400"
          initial={{ width: '0%' }}
          animate={{ width: `${(completedCount / layerStates.length) * 100}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      {/* Layer cards */}
      <div className="space-y-2">
        {LAYERS.map((layer, idx) => (
          <LayerCard
            key={layer.number}
            number={layer.number}
            icon={layer.icon}
            label={layer.label}
            description={layer.description}
            status={layerStates[idx]?.status ?? 'pending'}
            processingMs={layerStates[idx]?.processingMs}
          />
        ))}
      </div>
    </div>
  );
}
