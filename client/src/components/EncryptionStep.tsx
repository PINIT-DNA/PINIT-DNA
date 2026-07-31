import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { EncryptionResult } from '../types';

interface Props {
  dnaRecordId: string;
  onComplete: (result: EncryptionResult) => void;
}

const STAGES_MS = [900, 1200, 600];

export function EncryptionStep({ onComplete }: Props) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let i = 0;
    const advance = () => {
      if (i >= STAGES_MS.length) {
        onComplete({
          algorithm: 'AES-256-GCM',
          keyLength: 256,
          encryptedAt: new Date().toISOString(),
        });
        return;
      }
      setProgress(Math.round(((i + 1) / STAGES_MS.length) * 100));
      i++;
      setTimeout(advance, STAGES_MS[i - 1]);
    };
    setTimeout(advance, STAGES_MS[0]);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card py-8 px-6"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
        <div className="w-full max-w-xs h-2 bg-bg-border rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-yellow-400 rounded-full"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>
    </motion.div>
  );
}
