import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import type { DnaSession } from '../types';

interface Props {
  session: DnaSession;
  onReset: () => void;
}

export function SuccessPanel({ onReset }: Props) {
  return (
    <div className="max-w-md mx-auto w-full flex justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
        <button type="button" onClick={onReset} className="btn btn-primary px-8 py-4">
          <Plus size={18} />
          <span>New</span>
        </button>
      </motion.div>
    </div>
  );
}
