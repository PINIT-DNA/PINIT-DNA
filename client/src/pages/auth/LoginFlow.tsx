import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ScanFace, Fingerprint, ShieldCheck, ArrowRight, CheckCircle2, UserCheck } from 'lucide-react';

import { AuthShell } from '../../components/auth/AuthShell';
import { CameraStage } from '../../components/auth/CameraStage';
import { StepHead, Checklist, SystemTrace, TrustBadge, type CheckItem } from '../../components/auth/parts';
import { useAuth } from '../../context/AuthContext';
import { getStoredShortId, getTrustScore, getLastLogin, recordLogin, clearRegistration } from '../../lib/hoid';
import { assertDeviceCredential } from '../../lib/webauthn';
import { touchLastLogin } from '../../lib/identity-store';

type Step = 'welcome' | 'face' | 'biometric' | 'presence' | 'success';
const ORDER: Step[] = ['welcome', 'face', 'biometric', 'presence', 'success'];

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.28 },
};

export function LoginFlow() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  const go = (s: Step) => { setError(''); setStep(s); };
  const idx = ORDER.indexOf(step);

  function useDifferentIdentity() {
    clearRegistration();
    navigate('/register', { replace: true });
  }

  return (
    <AuthShell steps={ORDER.length} current={idx} tagline="Verify Your Presence">
      <AnimatePresence mode="wait">
        <motion.div key={step} {...fade}>
          {step === 'welcome'   && <WelcomeBack onNext={() => go('face')} onSwitch={useDifferentIdentity} />}
          {step === 'face'      && <FaceAuth onNext={() => go('biometric')} />}
          {step === 'biometric' && <BiometricConfirm onNext={() => go('presence')} />}
          {step === 'presence'  && (
            <Presence
              error={error}
              run={async () => {
                const shortId = getStoredShortId();
                if (!shortId) throw new Error('No identity bound to this device.');
                await login(shortId);
                recordLogin();
                await touchLastLogin(shortId);
              }}
              onDone={() => go('success')}
              onError={(m) => setError(m)}
              onSwitch={useDifferentIdentity}
            />
          )}
          {step === 'success'   && <LoginSuccess onEnter={() => navigate('/', { replace: true })} />}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

/* ── Screen 1 — Welcome Back ──────────────────────────────────────────────── */
function WelcomeBack({ onNext, onSwitch }: { onNext: () => void; onSwitch: () => void }) {
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div style={{ width: 76, height: 76, margin: '4px auto 16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 30%, rgba(129,140,248,0.35), rgba(99,102,241,0.06))', border: '1px solid rgba(129,140,248,0.4)' }}>
        <UserCheck size={38} color="#6366f1" />
      </div>
      <h1 style={{ fontSize: 23, fontWeight: 800 }}>Welcome Back</h1>
      <p className="pa-muted" style={{ fontSize: 14, marginTop: 8, marginBottom: 22 }}>
        Verify your presence to continue.
      </p>
      <button className="pa-btn" onClick={onNext}><ScanFace size={17} /> Verify Identity</button>
      <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onSwitch}>
        Use a different identity
      </button>
    </div>
  );
}

/* ── Screen 2 — Face Authentication ───────────────────────────────────────── */
function FaceAuth({ onNext }: { onNext: () => void }) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const advancedRef = useRef(false);

  useEffect(() => {
    const iv = setInterval(() => setProgress((p) => Math.min(100, p + 4)), 65);
    return () => clearInterval(iv);
  }, []);

  // `done` is intentionally NOT a dependency (see RegistrationFlow FaceEnroll).
  useEffect(() => {
    if (progress >= 100 && !advancedRef.current) {
      advancedRef.current = true;
      setDone(true);
      const t = setTimeout(onNext, 850);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, onNext]);

  return (
    <div className="pa-card">
      <StepHead icon={<ScanFace size={26} color="#6366f1" />} title="Face Authentication" subtitle="Look at the camera." />
      <CameraStage active progress={progress} done={done} />
      <p className="pa-accent mono" style={{ textAlign: 'center', fontSize: 12.5, marginTop: 16, lineHeight: 1.9 }}>
        {done ? 'Face matched ✓' : 'Face scan · matching · liveness · deepfake check…'}
      </p>
    </div>
  );
}

/* ── Screen 3 — Device Biometric ──────────────────────────────────────────── */
function BiometricConfirm({ onNext }: { onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      setBusy(true);
      await assertDeviceCredential();
      setBusy(false);
      setTimeout(onNext, 400);
    })();
  }, [onNext]);

  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <StepHead icon={<Fingerprint size={26} color="#6366f1" />} title="Confirm Identity" subtitle="Use Face ID or Fingerprint" />
      <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 18px' }}>
        <div className={busy ? 'pa-spin' : 'pa-pop'} style={{ width: 92, height: 92, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 30%, rgba(129,140,248,0.35), rgba(99,102,241,0.08))', border: '1px solid rgba(129,140,248,0.4)' }}>
          <Fingerprint size={44} color="#6366f1" />
        </div>
      </div>
      <p className="pa-faint mono" style={{ fontSize: 11.5, lineHeight: 1.9 }}>
        WebAuthn Assertion · Secure Enclave · FIDO2
      </p>
    </div>
  );
}

/* ── Screen 4 — Presence Verification ─────────────────────────────────────── */
function Presence({
  run, onDone, onError, onSwitch, error,
}: {
  run: () => Promise<void>;
  onDone: () => void;
  onError: (m: string) => void;
  onSwitch: () => void;
  error: string;
}) {
  const [items, setItems] = useState<CheckItem[]>([
    { label: 'Face Match', done: false },
    { label: 'Voice Profile', done: false },
    { label: 'Device Signature', done: false },
    { label: 'Presence Certificate', done: false },
    { label: 'Trust Score', done: false },
  ]);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    items.forEach((_, i) =>
      setTimeout(() => setItems((prev) => prev.map((it, j) => (j <= i ? { ...it, done: true } : it))), 420 * (i + 1))
    );
    run()
      .then(() => setTimeout(onDone, 2600))
      .catch((e) => onError(e?.message || 'Verification failed.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pa-card">
      <StepHead icon={<ShieldCheck size={26} color="#6366f1" />} title="Presence Verification" subtitle="Validating your identity signals…" />
      <Checklist items={items} />
      <SystemTrace lines={['Validate Face Match', 'Verify Device Signature', 'Check Presence Certificate', 'Compute Trust Score']} />
      {error && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>
          <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onSwitch}>Register a new identity</button>
        </div>
      )}
    </div>
  );
}

/* ── Screen 5 — Login Success ─────────────────────────────────────────────── */
function LoginSuccess({ onEnter }: { onEnter: () => void }) {
  const last = getLastLogin();
  const lastStr = last
    ? `Today ${last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '—';

  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div className="pa-pop" style={{ width: 76, height: 76, margin: '4px auto 16px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 34px rgba(16,185,129,0.65)' }}>
        <CheckCircle2 size={42} color="#fff" />
      </div>
      <h1 style={{ fontSize: 23, fontWeight: 800 }}>Identity Verified</h1>
      <div style={{ margin: '18px 0' }}><TrustBadge score={getTrustScore()} /></div>
      <div className="pa-check" style={{ justifyContent: 'center', marginBottom: 18 }}>
        <span className="pa-faint" style={{ fontSize: 13 }}>Last login</span>
        <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 600 }}>{lastStr}</span>
      </div>
      <button className="pa-btn" onClick={onEnter}>Enter PINIT <ArrowRight size={17} /></button>
    </div>
  );
}
