import { useEffect, useRef, useState } from 'react';
import { Fingerprint, Check } from 'lucide-react';
import { StepHead } from './parts';
import {
  assertDeviceCredential,
  registerDeviceCredential,
  type BiometricResult,
} from '../../lib/webauthn';

interface BiometricStepProps {
  mode: 'register' | 'login';
  enrollmentLabel: string;
  deviceFingerprint?: string;
  expectedCredentialId?: string | null;
  claimedShortId?: string;
  strict?: boolean;
  exchangeReturn?: boolean;
  onDone: (result: BiometricResult) => void;
  onError?: (msg: string) => void;
}

/** Real WebAuthn / passkey — platform fingerprint, face, or PIN. No simulated hashes. */
export function BiometricStep({
  mode,
  claimedShortId,
  onDone,
  onError,
}: BiometricStepProps) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'error'>('idle');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  useEffect(() => {
    if (phase !== 'scanning') return;
    const start = Date.now();
    const tick = setInterval(() => {
      setProgress(Math.min(90, 8 + ((Date.now() - start) / 8000) * 80));
    }, 80);
    return () => clearInterval(tick);
  }, [phase, attempt]);

  async function run() {
    setPhase('scanning');
    setDone(false);
    setProgress(8);
    setError('');
    try {
      const result = mode === 'register'
        ? await registerDeviceCredential()
        : await assertDeviceCredential(claimedShortId);
      if (result.simulated) {
        throw new Error('Simulated device hashes are not accepted. Use a real passkey.');
      }
      setProgress(100);
      setDone(true);
      setPhase('idle');
      setTimeout(() => onDoneRef.current(result), 180);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Passkey verification failed.';
      setError(msg);
      setPhase('error');
      onErrorRef.current?.(msg);
    }
  }

  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <StepHead
        icon={<Fingerprint size={26} color="#6366f1" />}
        title="Passkey"
        subtitle={
          done
            ? 'Bound'
            : phase === 'error'
              ? 'Failed'
              : 'Windows Hello / PIN'
        }
      />
      <div
        className={phase === 'scanning' ? 'pa-spin' : ''}
        style={{
          width: 92, height: 92, margin: '12px auto', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: done
            ? 'rgba(16,185,129,0.15)'
            : 'radial-gradient(circle at 50% 30%, rgba(129,140,248,0.35), rgba(99,102,241,0.08))',
          border: done ? '1px solid rgba(52,211,153,0.5)' : '1px solid rgba(129,140,248,0.4)',
        }}
      >
        {done ? <Check size={40} color="#10b981" strokeWidth={3} /> : <Fingerprint size={44} color="#6366f1" />}
      </div>
      {phase === 'scanning' && (
        <p className="pa-accent mono" style={{ fontSize: 12.5, marginTop: 10 }}>{Math.round(progress)}%</p>
      )}
      {phase === 'error' && (
        <div style={{ marginTop: 10 }}>
          <p style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{error}</p>
          <button type="button" className="pa-btn" onClick={() => { setAttempt((a) => a + 1); void run(); }}>
            Retry
          </button>
        </div>
      )}
      {phase === 'idle' && !done && (
        <button type="button" className="pa-btn" style={{ marginTop: 12 }} onClick={() => void run()}>
          <Fingerprint size={16} /> Continue
        </button>
      )}
    </div>
  );
}

export function isNotRegisteredError(msg: string): boolean {
  return /no identity found|no matching face|not recognized|register first|not found|please register/i.test(msg);
}

export function isDuplicateIdentityError(msg: string): boolean {
  return /already registered|already enrolled|already has a pinit|already has an account|too similar to an existing|duplicate identity|one face = one/i.test(msg);
}
