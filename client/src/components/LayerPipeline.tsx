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
    <div className="card py-8 px-6">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
        <div className="w-full max-w-xs h-2 bg-bg-border rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-dna-600 to-dna-400"
            initial={{ width: '0%' }}
            animate={{ width: `${Math.max(pct, 8)}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      </div>
    </div>
  );
}
