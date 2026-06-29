import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { EncryptionResult } from '../types';

interface Props {
  dnaRecordId: string;
  onComplete: (result: EncryptionResult) => void;
}

const STAGES_MS = [900, 1200, 600];

export function EncryptionStep({ dnaRecordId, onComplete }: Props) {
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
      className="card border-yellow-500/30 bg-yellow-500/5 py-8 px-6 text-center space-y-4"
    >
      <div className="text-3xl">🔒</div>
      <div>
        <p className="text-white font-semibold">Securing your file</p>
        <p className="text-xs text-gray-500 mt-1 mono truncate max-w-[240px] mx-auto">{dnaRecordId}</p>
      </div>
      <div className="w-full max-w-xs mx-auto h-2 bg-bg-border rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-yellow-400 rounded-full"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
    </motion.div>
  );
}
