import { motion } from 'framer-motion';
import type { DnaSession } from '../types';

interface Props {
  session: DnaSession;
  onReset: () => void;
}

const CHECK_ITEMS = [
  { icon: '🧬', label: 'DNA Protected',         desc: '6-layer persistent fingerprint generated' },
  { icon: '🔒', label: 'AES-256-GCM Encrypted', desc: 'DNA record encrypted with 256-bit key'     },
  { icon: '🏛️', label: 'Ready for Vault Storage', desc: 'Secure storage handoff complete'          },
];

function formatBytes(b: number) {
  return b >= 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(2)} MB`
    : `${(b / 1024).toFixed(1)} KB`;
}

export function SuccessPanel({ session, onReset }: Props) {
  return (
    <div className="max-w-2xl mx-auto w-full">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center mb-8"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
          className="text-6xl mb-4"
        >
          ✅
        </motion.div>
        <h2 className="text-3xl font-bold text-white mb-2">
          {session.fileType && session.fileType !== 'IMAGE'
            ? `${session.fileType} DNA Generated`
            : 'File DNA Generated'}
        </h2>
        <p className="text-gray-400 text-sm">
          All 6 fingerprint layers complete. DNA record secured and encrypted.
        </p>
      </motion.div>

      {/* 3 check items */}
      <div className="space-y-3 mb-6">
        {CHECK_ITEMS.map((item, idx) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 * idx + 0.2 }}
            className="flex items-center gap-4 card border-layer-complete/30 bg-layer-complete/5 glow-green"
          >
            <div className="text-2xl">{item.icon}</div>
            <div className="flex-1">
              <p className="font-semibold text-white">{item.label}</p>
              <p className="text-xs text-gray-400">{item.desc}</p>
            </div>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15 * idx + 0.4, type: 'spring', stiffness: 300 }}
              className="w-8 h-8 rounded-full bg-layer-complete flex items-center justify-center shrink-0"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </motion.div>
          </motion.div>
        ))}
      </div>

      {/* Full summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="card mb-6"
      >
        <p className="text-xs text-gray-500 mono mb-4 uppercase tracking-wider">DNA Record Summary</p>
        <div className="space-y-2">
          {[
            { label: 'DNA Record ID',     value: session.dnaRecordId,                            mono: true,  accent: 'dna'    },
            { label: 'Vault ID',          value: session.vault?.vaultId ?? '—',                  mono: true,  accent: 'purple' },
            { label: 'File',              value: session.filename,                               mono: false, accent: null     },
            { label: 'File Type',         value: session.fileType ?? 'IMAGE',                    mono: true,  accent: 'dna'    },
            { label: 'Engine',            value: session.engineVersion ?? '2.0.0-universal',      mono: true,  accent: null     },
            { label: 'Original Size',     value: formatBytes(session.fileSizeBytes),             mono: true,  accent: null     },
            { label: 'Encrypted Size',    value: session.vault ? formatBytes(session.vault.encryptedSizeBytes) : '—', mono: true, accent: null },
            { label: 'Layers Complete',   value: `${session.successfulLayers}/6`,                mono: true,  accent: 'green'  },
            { label: 'Processing Time',   value: `${session.totalProcessingMs}ms`,               mono: true,  accent: null     },
            { label: 'Encryption',        value: session.vault?.encryptionAlgorithm ?? 'AES-256-GCM', mono: true, accent: 'yellow' },
            { label: 'Key Derivation',    value: 'HKDF-SHA256',                                  mono: true,  accent: null     },
            { label: 'Generated At',      value: new Date(session.generatedAt).toLocaleString(), mono: false, accent: null     },
            { label: 'Stored At',         value: session.vault ? new Date(session.vault.storedAt).toLocaleString() : '—', mono: false, accent: null },
          ].map((row) => (
            <div key={row.label} className="flex gap-3 bg-bg-base rounded-lg px-3 py-2">
              <span className="text-xs text-gray-500 mono w-36 shrink-0">{row.label}</span>
              <span
                className={`
                  text-xs break-all
                  ${row.mono ? 'mono' : ''}
                  ${row.accent === 'dna'    ? 'text-dna-400'          : ''}
                  ${row.accent === 'yellow' ? 'text-yellow-400'        : ''}
                  ${row.accent === 'green'  ? 'text-layer-complete'    : ''}
                  ${row.accent === 'purple' ? 'text-purple-400'        : ''}
                  ${!row.accent             ? 'text-gray-300'          : ''}
                `}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9 }}
        className="flex justify-center"
      >
        <button onClick={onReset} className="btn-primary">
          <span>🧬</span>
          <span>Generate Another DNA</span>
        </button>
      </motion.div>
    </div>
  );
}
