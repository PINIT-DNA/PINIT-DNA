import { motion } from 'framer-motion';
import type { LayerState } from '../types';

interface Props {
  layerStates: LayerState[];
  completedCount: number;
}

export function LayerPipeline({ layerStates, completedCount }: Props) {
  const total = layerStates.length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  return (
    <div className="card py-8 px-6 text-center space-y-5">
      <div className="w-12 h-12 mx-auto border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
      <div>
        <p className="text-sm font-semibold text-white">Processing your file</p>
        <p className="text-xs text-gray-500 mt-1">This usually takes a few seconds</p>
      </div>
      <div className="max-w-xs mx-auto space-y-2">
        <div className="w-full bg-bg-border rounded-full h-2 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-dna-600 to-dna-400"
            initial={{ width: '0%' }}
            animate={{ width: `${Math.max(pct, 8)}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
        <p className="mono text-xs text-gray-500">{pct}%</p>
      </div>
    </div>
  );
}
