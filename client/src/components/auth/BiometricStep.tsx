import { useEffect, useRef, useState } from 'react';
import { Fingerprint, Check } from 'lucide-react';
import { StepHead } from './parts';
import {
  assertDeviceCredential,
  registerDeviceCredential,
  deviceBoundCredentialId,
  laptopBiometricSkip,
  type BiometricResult,
} from '../../lib/webauthn';

/**
 * Fingerprint / device bind step — always auto-completes.
 * Never opens Windows Hello / passkey popups (DISABLE_PLATFORM_WEBAUTHN).
 * Face + voice remain the real identity checks.
 */
const AUTO_DEVICE_FINGERPRINT = true;

interface BiometricStepProps {
  mode: 'register' | 'login';
  /** Stable label for WebAuthn enrollment (device hash or short id). */
  enrollmentLabel: string;
  /** Browser/device fingerprint hash — binds credential without OS popup. */
  deviceFingerprint?: string;
  /** Stored credential for login verification. */
  expectedCredentialId?: string | null;
  /** Unused while AUTO_DEVICE_FINGERPRINT is on. */
  strict?: boolean;
  onDone: (result: BiometricResult) => void;
  onError?: (msg: string) => void;
}

/** Auto fingerprint — binds this browser/device; no OS passkey UI. */
export function BiometricStep({
  mode,
  enrollmentLabel,
  deviceFingerprint,
  expectedCredentialId,
  strict = false,
  onDone,
  onError,
}: BiometricStepProps) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [phase, setPhase] = useState<'scanning' | 'error'>('scanning');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    setPhase('scanning');
    setDone(false);
    setProgress(5);
    setError('');

    const durationMs = AUTO_DEVICE_FINGERPRINT ? 650 : mode === 'register' ? 1200 : 1000;
    const start = Date.now();
    const tick = setInterval(() => {
      if (cancelled) return;
      setProgress(Math.min(95, 5 + ((Date.now() - start) / durationMs) * 90));
    }, 50);

    (async () => {
      try {
        let result: BiometricResult;

        if (AUTO_DEVICE_FINGERPRINT) {
          // Never call navigator.credentials — silent device bind only.
          await new Promise((r) => setTimeout(r, durationMs));
          if (deviceFingerprint) {
            result = deviceBoundCredentialId(deviceFingerprint);
          } else if (expectedCredentialId) {
            result = { ok: true, credentialId: expectedCredentialId, simulated: true };
          } else {
            result = laptopBiometricSkip();
          }
        } else {
          result = mode === 'register'
            ? await registerDeviceCredential(enrollmentLabel, { strict, deviceFingerprint })
            : await assertDeviceCredential(expectedCredentialId, { strict, deviceFingerprint });
        }

        if (cancelled) return;
        clearInterval(tick);
        setProgress(100);
        setDone(true);
        setTimeout(() => onDoneRef.current(result), 180);
      } catch (e) {
        if (cancelled) return;
        clearInterval(tick);
        const msg = e instanceof Error ? e.message : 'Device fingerprint failed.';
        setError(msg);
        setPhase('error');
        onErrorRef.current?.(msg);
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [mode, enrollmentLabel, deviceFingerprint, expectedCredentialId, strict, attempt]);

  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <StepHead
        icon={<Fingerprint size={26} color="#6366f1" />}
        title="Device authenticator"
        subtitle={
          done
            ? 'This device is bound to the account after face verification'
            : phase === 'error'
              ? 'Device bind failed'
              : 'Binding this browser automatically…'
        }
      />
      <div
        className={done ? '' : phase === 'scanning' ? 'pa-spin' : ''}
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
          <button type="button" className="pa-btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
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
