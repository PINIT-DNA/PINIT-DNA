import { useEffect, useRef, useState } from 'react';
import { Fingerprint, Check } from 'lucide-react';
import { StepHead } from './parts';
import { laptopBiometricSkip, type BiometricResult } from '../../lib/webauthn';

interface BiometricStepProps {
  mode: 'register' | 'login';
  onDone: (result: BiometricResult) => void;
}

/** Fingerprint UI — quick scan animation (~1 s), auto-continues to voice. */
export function BiometricStep({ mode, onDone }: BiometricStepProps) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const durationMs = mode === 'register' ? 1000 : 850;
    const start = Date.now();
    let cancelled = false;

    setProgress(5);

    const tick = setInterval(() => {
      if (cancelled) return;
      setProgress(Math.min(100, 5 + ((Date.now() - start) / durationMs) * 95));
    }, 50);

    const timer = setTimeout(() => {
      if (cancelled) return;
      clearInterval(tick);
      setProgress(100);
      setDone(true);
      setTimeout(() => onDoneRef.current(laptopBiometricSkip()), 200);
    }, durationMs);

    return () => {
      cancelled = true;
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [mode]);

  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <StepHead
        icon={<Fingerprint size={26} color="#6366f1" />}
        title="Device Biometric"
        subtitle={done ? 'Verified' : 'Scanning fingerprint…'}
      />
      <div
        className={done ? '' : 'pa-spin'}
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
      <p className="pa-accent mono" style={{ fontSize: 12.5, marginTop: 10 }}>{Math.round(progress)}%</p>
    </div>
  );
}

export function isNotRegisteredError(msg: string): boolean {
  return /no identity found|no matching face|not recognized|register first|not found|please register/i.test(msg);
}

export function isDuplicateIdentityError(msg: string): boolean {
  return /already exists|already registered|duplicate|sign in using|login instead/i.test(msg);
}
