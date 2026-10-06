import { useRef, useState } from 'react';
import { ScanFace } from 'lucide-react';
import { FaceRoundScan } from '../auth/FaceRoundScan';
import { reenrollFace } from '../../lib/face-api-client';

export function SignInMethodSettings({ compact }: { compact?: boolean }) {
  const [updating, setUpdating] = useState(false);
  const [scanKey, setScanKey] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const sampleRef = useRef<{ embedding: number[]; padEvidence: Parameters<typeof reenrollFace>[0]['padEvidence'] } | null>(null);

  return (
    <div className={compact ? '' : 'space-y-2'}>
      <p className="text-xs font-medium text-slate-900 dark:text-white flex items-center gap-2">
        <ScanFace size={16} className="text-dna-400" />
        Face Scan
      </p>
      <p className="text-2xs text-slate-600 dark:text-gray-400 mt-1">
        Sign in by looking at the camera. On a known device this is a 1:1 check. Fingerprint stays optional.
      </p>
      {!compact && (
        <button
          type="button"
          className="mt-2 text-2xs font-medium text-dna-500"
          onClick={() => {
            setUpdating((open) => !open);
            setMessage('');
            setError('');
            sampleRef.current = null;
          }}
        >
          {updating ? 'Cancel face update' : 'Update face'}
        </button>
      )}
      {updating && (
        <div className="pinit-auth mt-3">
          <p className="text-2xs text-slate-600 dark:text-gray-400 mb-2">
            This only replaces the face if it still matches the face already on this account.
          </p>
          <FaceRoundScan
            key={scanKey}
            mode="login"
            samplesRequired={1}
            title="Confirm it is still you"
            identityError={error}
            onEmbedding={() => {}}
            onSample={(sample) => { sampleRef.current = sample; }}
            onNext={() => {
              const sample = sampleRef.current;
              if (!sample) {
                setError('Live check did not finish. Try again.');
                return;
              }
              void reenrollFace({ embedding: sample.embedding, padEvidence: sample.padEvidence })
                .then(() => {
                  setMessage('Face updated for this account.');
                  setUpdating(false);
                  setError('');
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Face update failed.');
                  sampleRef.current = null;
                });
            }}
            onClearIdentity={() => {
              sampleRef.current = null;
              setError('');
              setScanKey((n) => n + 1);
            }}
            scanAgainLabel="Scan again"
            onError={setError}
          />
        </div>
      )}
      {message && <p className="text-2xs text-emerald-600 mt-2">{message}</p>}
    </div>
  );
}
