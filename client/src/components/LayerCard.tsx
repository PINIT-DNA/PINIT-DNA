import { motion, AnimatePresence } from 'framer-motion';
import type { LayerStatus } from '../types';

interface Props {
  number: number;
  icon: string;
  label: string;
  description: string;
  status: LayerStatus;
  processingMs?: number;
}

const statusConfig = {
  pending:    { dot: 'bg-gray-600',         text: 'text-gray-500',      label: 'Pending'    },
  processing: { dot: 'bg-yellow-400 animate-pulse', text: 'text-yellow-400', label: 'Processing' },
  complete:   { dot: 'bg-layer-complete',   text: 'text-layer-complete', label: 'Complete'   },
  failed:     { dot: 'bg-layer-failed',     text: 'text-layer-failed',   label: 'Failed'     },
};

export function LayerCard({ number, icon, label, description, status, processingMs }: Props) {
  const cfg = statusConfig[status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: number * 0.08 }}
      className={`
        relative flex items-center gap-4 rounded-xl border px-5 py-4
        transition-all duration-300
        ${status === 'complete'
          ? 'border-layer-complete/30 bg-layer-complete/5'
          : status === 'processing'
          ? 'border-yellow-500/30 bg-yellow-500/5 glow-purple'
          : status === 'failed'
          ? 'border-layer-failed/30 bg-layer-failed/5'
          : 'border-bg-border bg-bg-card'
        }
      `}
    >
      {/* Layer number */}
      <div
        className={`
          w-8 h-8 rounded-lg flex items-center justify-center shrink-0
          mono text-xs font-bold
          ${status === 'complete'
            ? 'bg-layer-complete text-white'
            : status === 'processing'
            ? 'bg-yellow-400 text-black'
            : 'bg-bg-border text-gray-500'
          }
        `}
      >
        {status === 'complete' ? '✓' : `L${number}`}
      </div>

      {/* Icon */}
      <span className="text-xl shrink-0">{icon}</span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm text-white">{label}</p>
          <span className={`mono text-xs ${cfg.text}`}>{cfg.label}</span>
        </div>
        <p className="text-xs text-gray-500 truncate">{description}</p>
      </div>

      {/* Status / timing */}
      <div className="shrink-0 flex items-center gap-2">
        <AnimatePresence mode="wait">
          {status === 'processing' && (
            <motion.div
              key="spinner"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"
            />
          )}
          {status === 'complete' && processingMs !== undefined && (
            <motion.span
              key="time"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mono text-xs text-layer-complete"
            >
              {processingMs}ms
            </motion.span>
          )}
          {status === 'failed' && (
            <motion.span
              key="fail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-layer-failed text-lg"
            >
              ✗
            </motion.span>
          )}
        </AnimatePresence>
        <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      </div>
    </motion.div>
  );
}
