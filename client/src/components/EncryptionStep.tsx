import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { EncryptionResult } from '../types';

interface Props {
  dnaRecordId: string;
  onComplete: (result: EncryptionResult) => void;
}

export function EncryptionStep({ onComplete }: Props) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(100);
    onComplete({
      algorithm: 'AES-256-GCM',
      keyLength: 256,
      encryptedAt: new Date().toISOString(),
    });
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
