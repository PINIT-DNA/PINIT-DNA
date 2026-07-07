import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const Header = () => null;
import { UploadZone } from './components/UploadZone';
import { EncryptionStep } from './components/EncryptionStep';
import { VaultStep } from './components/VaultStep';
import { SuccessPanel } from './components/SuccessPanel';

import { generateDna } from './services/api';
import type { AppStage, DnaSession, EncryptionResult, VaultStoreResponse } from './types';

export default function App() {
  const [stage, setStage] = useState<AppStage | 'vaulting'>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [session, setSession] = useState<DnaSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<{
    existingRecordId?: string;
    existingFilename?: string;
    matchType?: string;
    riskLevel?: string;
    ownerShortId?: string;
  } | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!selectedFile) return;
    setError(null);
    setStage('processing');

    try {
      const result = await generateDna(selectedFile);

      setSession({
        dnaRecordId:      result.dnaRecordId,
        filename:         selectedFile.name,
        fileSizeBytes:    selectedFile.size,
        mimeType:         selectedFile.type,
        fileType:         result.fileType  ?? 'FILE',
        engineVersion:    result.engineVersion ?? '2.0.0-universal',
        status:           result.status,
        successfulLayers: result.summary.successfulLayers,
        totalLayers:      result.summary.totalLayers,
        totalProcessingMs: result.summary.totalProcessingMs,
        generatedAt:      result.generatedAt,
      });

      setTimeout(() => setStage('encrypting'), 400);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = err as any;
      if (anyErr?.isDuplicate) {
        setDuplicateInfo({
          existingRecordId: anyErr.existingRecordId,
          existingFilename: anyErr.existingFilename,
          matchType:        anyErr.matchType,
          riskLevel:        anyErr.riskLevel,
          ownerShortId:     anyErr.ownerShortId,
        });
        setError(anyErr.message);
      } else {
        setDuplicateInfo(null);
        setError(err instanceof Error ? err.message : 'Failed');
      }
      setStage('idle');
    }
  }, [selectedFile]);

  const handleEncryptionComplete = useCallback((enc: EncryptionResult) => {
    setSession((prev) => (prev ? { ...prev, encryption: enc } : prev));
    setTimeout(() => setStage('vaulting'), 400);
  }, []);

  const handleVaultComplete = useCallback((vault: VaultStoreResponse) => {
    setSession((prev) => (prev ? { ...prev, vault } : prev));
    setTimeout(() => setStage('success'), 400);
  }, []);

  const handleVaultError = useCallback(() => {
    setTimeout(() => setStage('success'), 400);
  }, []);

  const handleReset = () => {
    setStage('idle');
    setSelectedFile(null);
    setSession(null);
    setError(null);
    setDuplicateInfo(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg-base">
      <Header />

      <main className="flex-1 max-w-5xl mx-auto w-full px-0 sm:px-4 py-4 sm:py-8">
        <AnimatePresence mode="wait">
          {stage === 'idle' && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-5 flex justify-center"
                >
                  <button
                    type="button"
                    onClick={() => { setError(null); setDuplicateInfo(null); }}
                    className="btn btn-secondary"
                  >
                    {duplicateInfo ? 'Different File' : 'Retry'}
                  </button>
                </motion.div>
              )}
              <UploadZone
                selectedFile={selectedFile}
                onFileSelected={setSelectedFile}
                onGenerate={handleGenerate}
              />
            </motion.div>
          )}

          {(stage === 'processing' || stage === 'encrypting' || stage === 'vaulting') && (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center min-h-[320px]"
            >
              <div className="w-12 h-12 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
              {stage === 'encrypting' && session && (
                <div className="sr-only" aria-hidden>
                  <EncryptionStep dnaRecordId={session.dnaRecordId} onComplete={handleEncryptionComplete} />
                </div>
              )}
              {stage === 'vaulting' && session && selectedFile && (
                <div className="sr-only" aria-hidden>
                  <VaultStep
                    file={selectedFile}
                    dnaRecordId={session.dnaRecordId}
                    onComplete={handleVaultComplete}
                    onError={handleVaultError}
                  />
                </div>
              )}
            </motion.div>
          )}

          {stage === 'success' && session && (
            <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <SuccessPanel session={session} onReset={handleReset} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
