import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

const Header = () => null;
import { UploadZone } from './components/UploadZone';
import { EncryptionStep } from './components/EncryptionStep';
import { VaultStep } from './components/VaultStep';
import { SuccessPanel } from './components/SuccessPanel';
import { GenerationProgress } from './components/GenerationProgress';

import { generateDna } from './services/api';
import type { AppStage, DnaSession, EncryptionResult, VaultStoreResponse } from './types';
import { DNA_GENERATOR_VERSION } from './config/dna-versions';
import { requestCustodyLocation, type CustodyLocation } from './lib/location-consent';

type FlowStage = AppStage | 'vaulting';

export default function App() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Business Account — protecting an asset from inside a Campaign workspace.
  const campaignId = searchParams.get('campaignId');
  const [stage, setStage] = useState<FlowStage>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [session, setSession] = useState<DnaSession | null>(null);
  const [custodyLocation, setCustodyLocation] = useState<CustodyLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<{
    existingRecordId?: string;
    existingFilename?: string;
    matchType?: string;
    riskLevel?: string;
    ownerShortId?: string;
  } | null>(null);

  // Preview URL for progress workspace thumbnail
  const previewUrl = useMemo(() => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) return null;
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Revoke blob URL on reset / unmount
  useEffect(() => {
    return () => {
      if (session?.protectedBlobUrl) URL.revokeObjectURL(session.protectedBlobUrl);
    };
  }, [session?.protectedBlobUrl]);

  // The encrypt/vault network calls each time out at 90s server-side, but a
  // stuck browser tab, a swallowed rejection, or any future regression in the
  // completion callback can still leave this screen spinning with nothing to
  // show for it — indefinitely, since there was previously no upper bound on
  // how long a user would silently wait. Guarantee a visible way out instead.
  useEffect(() => {
    setStalled(false);
    if (stage !== 'encrypting' && stage !== 'vaulting') return;
    const timer = setTimeout(() => setStalled(true), 100_000);
    return () => clearTimeout(timer);
  }, [stage]);

  const handleGenerate = useCallback(async () => {
    if (!selectedFile) return;
    setError(null);
    setStage('processing');

    try {
      // Optional custody GPS — start in parallel; never block DNA generate
      const locPromise = requestCustodyLocation();
      void locPromise.then(setCustodyLocation);

      const result = await generateDna(selectedFile);
      // Prefer GPS if it finished during generate; otherwise continue without waiting
      const loc = await Promise.race([
        locPromise,
        new Promise<CustodyLocation | null>((resolve) => setTimeout(() => resolve(null), 50)),
      ]);
      if (loc) setCustodyLocation(loc);

      setSession({
        dnaRecordId:      result.dnaRecordId,
        filename:         selectedFile.name,
        fileSizeBytes:    selectedFile.size,
        mimeType:         selectedFile.type,
        fileType:         result.fileType  ?? 'FILE',
        engineVersion:    result.engineVersion ?? DNA_GENERATOR_VERSION,
        status:           result.status,
        successfulLayers: result.summary.successfulLayers,
        totalLayers:      result.summary.totalLayers,
        totalProcessingMs: result.summary.totalProcessingMs,
        generatedAt:      result.generatedAt,
        fileAnalysis:     result.fileAnalysis ?? null,
      });

      setStage('encrypting');
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
    setStage('vaulting');
  }, []);

  const handleVaultComplete = useCallback((vault: VaultStoreResponse) => {
    setSession((prev) => (prev ? {
      ...prev,
      vault,
      fileAnalysis: vault.contentAnalysis ?? prev.fileAnalysis ?? null,
      // Download can be fetched on demand from Success — don't block protect UX.
      downloadReady: true,
    } : prev));
    setStage('success');
  }, []);

  const handleVaultError = useCallback((msg: string) => {
    if (msg.toLowerCase().includes('asset limit') || msg.toLowerCase().includes('protected asset')) {
      navigate('/upgrade?from=quota&return=/generate', { replace: true });
      return;
    }
    setError(msg);
    setStage('idle');
  }, [navigate]);

  const handleReset = () => {
    setSession((prev) => {
      if (prev?.protectedBlobUrl) URL.revokeObjectURL(prev.protectedBlobUrl);
      return null;
    });
    setStage('idle');
    setSelectedFile(null);
    setError(null);
    setDuplicateInfo(null);
    setCustodyLocation(null);
  };

  const isWorking =
    stage === 'processing'
    || stage === 'encrypting'
    || stage === 'vaulting';

  return (
    <div className="min-h-screen flex flex-col bg-bg-base">
      <Header />

      <main className={`flex-1 mx-auto w-full px-0 sm:px-4 py-4 sm:py-8 ${isWorking ? 'max-w-6xl' : 'max-w-5xl'}`}>
        <AnimatePresence mode="wait">
          {stage === 'idle' && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-5 max-w-lg mx-auto px-4"
                >
                  <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-center">
                    <p className="text-sm text-danger font-medium mb-3">{error}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        // A refused duplicate can never succeed, so send the user
                        // back to an empty upload zone. A transient error is worth
                        // retrying with the same file, so that selection stays.
                        if (duplicateInfo) setSelectedFile(null);
                        setDuplicateInfo(null);
                      }}
                      className="btn btn-secondary"
                    >
                      {duplicateInfo ? 'Choose a different file' : 'Retry'}
                    </button>
                  </div>
                </motion.div>
              )}
              <UploadZone
                selectedFile={selectedFile}
                onFileSelected={setSelectedFile}
                onGenerate={handleGenerate}
              />
            </motion.div>
          )}

          {isWorking && (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <GenerationProgress
                phase={stage as 'processing' | 'encrypting' | 'vaulting'}
                fileName={selectedFile?.name ?? session?.filename}
                fileSizeBytes={selectedFile?.size ?? session?.fileSizeBytes}
                mimeType={selectedFile?.type ?? session?.mimeType}
                dnaRecordId={session?.dnaRecordId}
                previewUrl={previewUrl}
              />
              {stalled && (
                <div className="mt-4 max-w-lg mx-auto px-4">
                  <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-center">
                    <p className="text-sm text-yellow-400 font-medium mb-2">
                      This is taking longer than expected.
                    </p>
                    <p className="text-xs text-gray-400 mb-3">
                      Protection usually finishes in under a minute. If this screen hasn't moved on,
                      the file may already be protected on the server — check your Vault directly
                      rather than keep waiting here.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate('/vault')}
                      className="btn btn-secondary"
                    >
                      Check Vault
                    </button>
                  </div>
                </div>
              )}
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
                    custodyLocation={custodyLocation}
                    campaignId={campaignId}
                    onComplete={handleVaultComplete}
                    onError={handleVaultError}
                  />
                </div>
              )}
            </motion.div>
          )}

          {stage === 'success' && session && (
            <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <SuccessPanel session={session} onReset={handleReset} campaignId={session.vault?.campaignId ?? campaignId} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
