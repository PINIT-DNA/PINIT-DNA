import { useState, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, UserPlus, LogIn } from 'lucide-react';
import { API_BASE_URL } from '../../config/api.config';
import { getStoredShortId } from '../../lib/hoid';
import { toRootPinitId } from '../../lib/pinit-identity';
import { ensureFaceModels } from '../../lib/face-capture';
import { runPadCapture } from '../../lib/face-liveness';
import type { FacePadEvidence } from '../../lib/face-api-client';
import { assertDeviceCredential, registerDeviceCredential } from '../../lib/webauthn';

interface FaceAuthProps {
  mode: 'login' | 'register' | 'capture';
  variant?: 'standalone' | 'embedded';
  claimedShortId?: string;
  onSuccess: (data: Record<string, unknown>) => void;
  onSwitchMode?: () => void;
}

type LivenessStep = 'init' | 'detecting' | 'liveness' | 'passkey' | 'processing' | 'done' | 'error';

async function postFaceApi(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const url = `${API_BASE_URL}${path}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (res.status >= 500 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr ?? new Error('Face API unreachable');
}

export function FaceAuth({ mode, variant = 'standalone', claimedShortId, onSuccess, onSwitchMode }: FaceAuthProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [step, setStep] = useState<LivenessStep>('init');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState('Initializing camera...');
  const [claimInput, setClaimInput] = useState(
    () => claimedShortId || getStoredShortId() || '',
  );
  const runningRef = useRef(false);
  const pendingCaptureRef = useRef<{ embedding: number[]; padEvidence?: FacePadEvidence } | null>(null);

  useEffect(() => {
    async function loadModels() {
      try {
        await ensureFaceModels();
        setModelsLoaded(true);
      } catch {
        setError('Failed to load face detection models. Refresh the page.');
        setStep('error');
      }
    }
    void loadModels();
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    }
  }, []);

  // Intentionally reads only success/matched/message/status from the response below —
  // never a field like shortId/distance that the backend might stop sending on a
  // contract change (see biometric-auth.service.ts's register()). Keep it that way.
  const submitCapture = useCallback(async (
    embedding: number[],
    padEvidence?: FacePadEvidence,
    passkey?: { webauthnSession?: string; passkeyPendingToken?: string },
  ) => {
    if (mode === 'capture') {
      setStep('done');
      setProgress(100);
      stopCamera();
      onSuccess({ embedding, success: true, padEvidence });
      return;
    }

    const path = mode === 'register' ? '/auth/face/register' : '/auth/face/login';
    const claim = (toRootPinitId(claimInput) || claimInput).trim();
    if (mode === 'login' && !claim) {
      setStep('error');
      setError('Enter your Pinit ID, then verify your face against that account.');
      return;
    }
    try {
      const { status, data } = await postFaceApi(path, {
        embedding,
        padEvidence,
        webauthnSession: passkey?.webauthnSession,
        passkeyPendingToken: passkey?.passkeyPendingToken,
        ...(mode === 'login' ? { claimedShortId: claim } : {}),
      });

      if (data.success === true && data.matched !== false) {
        setStep('done');
        setProgress(100);
        stopCamera();
        onSuccess(data);
        return;
      }

      setStep('error');
      setError(
        (typeof data.message === 'string' && data.message) ||
        (status === 409 ? 'This face is already registered. Please login.' : null) ||
        (mode === 'login' ? 'Could not verify this face for the claimed account.' : 'Registration failed. Please try again.'),
      );
    } catch {
      setStep('error');
      setError(`Cannot reach server. Check connection to ${API_BASE_URL.replace('/api/v1', '')}`);
    }
  }, [mode, onSuccess, stopCamera, claimInput]);

  const runPadSession = useCallback(async () => {
    if (!videoRef.current || runningRef.current) return;
    runningRef.current = true;
    setStep('liveness');
    setHint('Follow the live motion prompts');
    try {
      const result = await runPadCapture(videoRef.current, {
        onProgress: setProgress,
        onHint: (h) => { setHint(h); setStep('liveness'); },
      });
      if (mode === 'capture') {
        await submitCapture(result.embedding, result.padEvidence);
        return;
      }
      pendingCaptureRef.current = { embedding: result.embedding, padEvidence: result.padEvidence };
      runningRef.current = false;
      setProgress(90);
      setStep('passkey');
      setHint('Confirm with this device passkey');
    } catch (e) {
      runningRef.current = false;
      setStep('error');
      setError(e instanceof Error ? e.message : 'Liveness check failed. Retry.');
    }
  }, [mode, submitCapture]);

  const continueWithPasskey = useCallback(async () => {
    const pending = pendingCaptureRef.current;
    if (!pending) {
      setStep('error');
      setError('Face capture missing. Retry.');
      return;
    }
    setStep('processing');
    setHint('Verifying device passkey…');
    try {
      const claim = (toRootPinitId(claimInput) || claimInput).trim();
      const passkey = mode === 'register'
        ? await registerDeviceCredential()
        : await assertDeviceCredential(claim);
      if (passkey.simulated) {
        throw new Error('Simulated device hashes are not accepted. Use a real passkey.');
      }
      await submitCapture(pending.embedding, pending.padEvidence, {
        webauthnSession: passkey.webauthnSession,
        passkeyPendingToken: passkey.passkeyPendingToken,
      });
    } catch (e) {
      setStep('error');
      setError(e instanceof Error ? e.message : 'Passkey verification failed.');
    }
  }, [claimInput, mode, submitCapture]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStep('detecting');
        setHint('Position your face in the frame');
        void runPadSession();
      }
    } catch {
      setError('Camera access denied. Please allow camera permission.');
      setStep('error');
    }
  }, [runPadSession]);

  useEffect(() => {
    if (!modelsLoaded) return;
    void startCamera();
    return () => stopCamera();
  }, [modelsLoaded, startCamera, stopCamera]);

  const retry = () => {
    runningRef.current = false;
    setError(null);
    setProgress(0);
    setStep('detecting');
    void runPadSession();
  };

  return (
    <div className={variant === 'embedded' ? 'w-full' : 'w-full max-w-md mx-auto'}>
      {mode === 'login' && (
        <label className="block mb-3">
          <span className="text-[10px] font-bold tracking-wider uppercase text-gray-500">Pinit ID</span>
          <input
            value={claimInput}
            onChange={(e) => setClaimInput(e.target.value.toUpperCase())}
            placeholder="PINIT-XXXXXX"
            autoComplete="username"
            className="mt-1 w-full rounded-xl bg-bg-elevated border border-bg-border px-3 py-2 text-sm font-bold text-white tracking-wide"
          />
        </label>
      )}
      <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] mb-4">
        <video
          ref={videoRef}
          className="w-full h-full object-cover mirror"
          autoPlay playsInline muted
          style={{ transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ transform: 'scaleX(-1)' }}
        />

        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-60 border-2 border-dna-400/40 rounded-[40%]">
            <div className="absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 border-dna-400 rounded-tl-xl" />
            <div className="absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 border-dna-400 rounded-tr-xl" />
            <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-2 border-l-2 border-dna-400 rounded-bl-xl" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-2 border-r-2 border-dna-400 rounded-br-xl" />
          </div>
        </div>

        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
          <div className={`px-4 py-1.5 rounded-full text-xs font-bold backdrop-blur-md ${
            step === 'done' ? 'bg-green-500/80 text-white' :
            step === 'error' ? 'bg-red-500/80 text-white' :
            'bg-black/60 text-dna-400'
          }`}>
            {step === 'done' ? 'Verified' :
             step === 'error' ? error :
             hint}
          </div>
        </div>
      </div>

      <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-to-r from-dna-500 to-accent-light rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex justify-between mb-6 px-2">
        {[
          { label: 'Detect', done: progress >= 20 },
          { label: 'Motion', done: progress >= 50 },
          { label: 'Liveness', done: progress >= 80 },
          { label: 'Verify', done: progress >= 100 },
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
              s.done ? 'bg-success text-white' : 'bg-bg-elevated text-gray-500 border border-bg-border'
            }`}>
              {s.done ? '✓' : i + 1}
            </div>
            <span className={`text-[10px] font-semibold ${s.done ? 'text-success' : 'text-gray-500'}`}>{s.label}</span>
          </div>
        ))}
      </div>

      {step === 'passkey' && (
        <button
          type="button"
          onClick={() => void continueWithPasskey()}
          className={variant === 'embedded' ? 'pa-btn w-full mb-3' : 'btn btn-primary w-full mb-3'}
        >
          Continue with device passkey
        </button>
      )}

      {step === 'error' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <AlertTriangle size={20} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-400 font-semibold">{error}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={retry} className={variant === 'embedded' ? 'pa-btn flex-1' : 'btn btn-primary flex-1'}>
              <RefreshCw size={14} /> Try Again
            </button>
            {onSwitchMode && (
              <button onClick={onSwitchMode} className={variant === 'embedded' ? 'pa-btn pa-btn-ghost flex-1' : 'btn btn-secondary flex-1'}>
                {mode === 'login' ? <><UserPlus size={14} /> Register</> : <><LogIn size={14} /> Login</>}
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'done' && variant === 'standalone' && (
        <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
          <CheckCircle size={20} className="text-green-400" />
          <p className="text-sm text-green-400 font-semibold">
            {mode === 'register' ? 'Face registered! Redirecting...' : 'Identity verified! Logging in...'}
          </p>
        </div>
      )}

      {step !== 'done' && step !== 'error' && onSwitchMode && variant === 'standalone' && (
        <button onClick={onSwitchMode} className="w-full text-center text-xs text-gray-500 hover:text-dna-400 transition mt-2">
          {mode === 'login' ? "Don't have an account? Register with face" : 'Already registered? Login with face'}
        </button>
      )}
    </div>
  );
}
