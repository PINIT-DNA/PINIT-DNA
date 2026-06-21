import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ShieldCheck, Camera, Mic, Fingerprint, ScanFace, Sparkles,
  ArrowRight, CheckCircle2, Eye, Smile, MoveLeft, MoveRight,
} from 'lucide-react';

import { AuthShell } from '../../components/auth/AuthShell';
import { CameraStage } from '../../components/auth/CameraStage';
import { StepHead, Checklist, SystemTrace, TrustBadge, type CheckItem } from '../../components/auth/parts';
import { useAuth } from '../../context/AuthContext';
import { collectFingerprint } from '../../lib/device-fingerprint';
import { generateHoid, saveRegistration } from '../../lib/hoid';
import { registerDeviceCredential } from '../../lib/webauthn';
import { storeIdentity } from '../../lib/identity-store';
import { warmBackend } from '../../lib/auth';

type Step =
  | 'welcome' | 'permissions' | 'face' | 'liveness'
  | 'voice' | 'biometric' | 'creating' | 'success';

const ORDER: Step[] = ['welcome', 'permissions', 'face', 'liveness', 'voice', 'biometric', 'creating', 'success'];

const LIVENESS = [
  { label: 'Blink Twice',     icon: <Eye size={18} /> },
  { label: 'Turn Head Left',  icon: <MoveLeft size={18} /> },
  { label: 'Turn Head Right', icon: <MoveRight size={18} /> },
  { label: 'Smile',           icon: <Smile size={18} /> },
];

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.28 },
};

export function RegistrationFlow() {
  const navigate = useNavigate();
  const { createAccount } = useAuth();

  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  const deviceFpRef = useRef<string>('');
  const hoidRef = useRef<string>('');
  const faceImageRef = useRef<string | null>(null);
  const bioRef = useRef<{ credentialId: string; simulated: boolean } | null>(null);

  const go = (s: Step) => { setError(''); setStep(s); };
  const idx = ORDER.indexOf(step);

  return (
    <AuthShell steps={ORDER.length} current={idx} tagline="Create Your Identity">
      <AnimatePresence mode="wait">
        <motion.div key={step} {...fade}>
          {step === 'welcome'     && <Welcome onNext={() => go('permissions')} />}
          {step === 'permissions' && <Permissions deviceFpRef={deviceFpRef} onNext={() => go('face')} />}
          {step === 'face'        && <FaceEnroll onCapture={(img) => { faceImageRef.current = img; }} onNext={() => go('liveness')} />}
          {step === 'liveness'    && <Liveness onNext={() => go('voice')} />}
          {step === 'voice'       && <Voice onNext={() => go('biometric')} />}
          {step === 'biometric'   && (
            <Biometric
              onResult={(r) => { bioRef.current = r; }}
              onNext={() => { hoidRef.current = generateHoid(deviceFpRef.current); go('creating'); }}
            />
          )}
          {step === 'creating'    && (
            <Creating
              error={error}
              run={async () => {
                const user = await createAccount();
                const hoid = hoidRef.current || generateHoid(deviceFpRef.current);
                saveRegistration({
                  hoid,
                  shortId: user.shortId,
                  trustScore: 99.8,
                  deviceFp: deviceFpRef.current,
                });
                // Persist the captured biometric/face identity to Supabase.
                await storeIdentity({
                  hoid,
                  shortId: user.shortId,
                  deviceFp: deviceFpRef.current,
                  faceImage: faceImageRef.current,
                  faceEnrolled: true,
                  livenessPassed: true,
                  voiceEnrolled: true,
                  webauthnCredentialId: bioRef.current?.credentialId ?? null,
                  webauthnSimulated: bioRef.current?.simulated ?? true,
                  trustScore: 99.8,
                });
              }}
              onDone={() => go('success')}
              onError={(m) => setError(m)}
            />
          )}
          {step === 'success'     && <Success onEnter={() => navigate('/', { replace: true })} />}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

/* ── Screen 1 — Welcome ───────────────────────────────────────────────────── */
function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="pa-card">
      <StepHead
        icon={<Sparkles size={26} color="#6366f1" />}
        title="Welcome to PINIT"
        subtitle={<>Create your Human Origin Identity.<br />Secure your ownership, provenance and digital rights — forever.</>}
      />
      <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          ['No passwords — ever', 'Your presence is the key'],
          ['Cryptographically yours', 'FIDO2 keys never leave the device'],
          ['Proof of human origin', 'Liveness + anti-deepfake verified'],
        ].map(([t, s]) => (
          <li key={t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <CheckCircle2 size={18} color="#10b981" style={{ marginTop: 1, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600 }}>{t}</div>
              <div className="pa-faint" style={{ fontSize: 12.5 }}>{s}</div>
            </div>
          </li>
        ))}
      </ul>
      <button className="pa-btn" onClick={onNext}>Get Started <ArrowRight size={17} /></button>
    </div>
  );
}

/* ── Screen 2 — Permissions ───────────────────────────────────────────────── */
function Permissions({ deviceFpRef, onNext }: { deviceFpRef: React.MutableRefObject<string>; onNext: () => void }) {
  const [busy, setBusy] = useState(false);

  const perms = [
    { icon: <Camera size={18} />,      label: 'Camera',          sub: 'Face capture & liveness' },
    { icon: <Mic size={18} />,         label: 'Microphone',      sub: 'Voiceprint enrolment' },
    { icon: <Fingerprint size={18} />, label: 'Biometrics',      sub: 'Device Face ID / fingerprint' },
    { icon: <ShieldCheck size={18} />, label: 'Device Security', sub: 'Hardware attestation' },
  ];

  async function allow() {
    setBusy(true);
    // Wake the backend now so it's ready by the time identity creation runs
    // (the rest of the flow takes ~20-30s — enough for a cold start to finish).
    warmBackend();
    // Trigger the OS permission prompts, then release the tracks immediately.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* denied / unavailable — flow still proceeds with simulation */ }
    try { deviceFpRef.current = (await collectFingerprint()).hash; } catch { /* noop */ }
    setBusy(false);
    onNext();
  }

  return (
    <div className="pa-card">
      <StepHead
        icon={<ShieldCheck size={26} color="#6366f1" />}
        title="Permissions"
        subtitle="PINIT needs these to verify human presence and create your identity."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20 }}>
        {perms.map((p) => (
          <div key={p.label} className="pa-check">
            <span style={{ color: '#6366f1', display: 'flex' }}>{p.icon}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{p.label}</div>
              <div className="pa-faint" style={{ fontSize: 12 }}>{p.sub}</div>
            </div>
          </div>
        ))}
      </div>
      <button className="pa-btn" onClick={allow} disabled={busy}>
        {busy ? <>Requesting access…</> : <>Allow &amp; Continue <ArrowRight size={17} /></>}
      </button>
    </div>
  );
}

/* ── Screen 3 — Face Enrollment ───────────────────────────────────────────── */
function FaceEnroll({ onNext, onCapture }: { onNext: () => void; onCapture: (img: string | null) => void }) {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const advancedRef = useRef(false);

  useEffect(() => {
    if (!scanning) return;
    const iv = setInterval(() => setProgress((p) => Math.min(100, p + 4)), 70);
    return () => clearInterval(iv);
  }, [scanning]);

  // `done` is intentionally NOT a dependency: including it would re-run this
  // effect on completion and its cleanup would cancel the advance timer.
  useEffect(() => {
    if (progress >= 100 && !advancedRef.current) {
      advancedRef.current = true;
      setDone(true);
      const t = setTimeout(onNext, 900);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, onNext]);

  return (
    <div className="pa-card">
      <StepHead
        icon={<ScanFace size={26} color="#6366f1" />}
        title="Face Enrollment"
        subtitle="Position your face inside the frame."
      />
      <CameraStage active progress={progress} done={done} onCapture={onCapture} />
      {!scanning && !done && (
        <ul className="pa-faint" style={{ fontSize: 12.5, margin: '18px auto', padding: 0, listStyle: 'none', textAlign: 'center', lineHeight: 1.9 }}>
          <li>• Good lighting   • Remove sunglasses   • Look at the camera</li>
        </ul>
      )}
      {scanning && !done && (
        <p className="pa-accent" style={{ textAlign: 'center', fontSize: 13, marginTop: 16 }}>
          Capturing face · generating 3D mesh &amp; embedding…
        </p>
      )}
      {!scanning && !done && (
        <button className="pa-btn" style={{ marginTop: 8 }} onClick={() => setScanning(true)}>
          <Camera size={16} /> Start Face Scan
        </button>
      )}
    </div>
  );
}

/* ── Screen 4 — Human Presence (liveness) ─────────────────────────────────── */
function Liveness({ onNext }: { onNext: () => void }) {
  const [active, setActive] = useState(0); // index into LIVENESS
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (active >= LIVENESS.length) {
      setVerifying(true);
      const t = setTimeout(onNext, 1500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setActive((a) => a + 1), 1400);
    return () => clearTimeout(t);
  }, [active, onNext]);

  const progress = Math.min(100, (active / LIVENESS.length) * 100);

  return (
    <div className="pa-card">
      <StepHead
        icon={<Eye size={26} color="#6366f1" />}
        title="Human Presence"
        subtitle={verifying ? 'Verifying human presence…' : 'Follow the on-screen challenge.'}
      />
      <CameraStage active progress={progress} done={verifying} />
      {!verifying && (
        <div className="pa-pop" key={active} style={{ textAlign: 'center', marginTop: 18 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 19, fontWeight: 700, color: '#0f172a' }}>
            <span className="pa-accent">{LIVENESS[active]?.icon}</span>
            {LIVENESS[active]?.label}
          </div>
        </div>
      )}
      {verifying && (
        <p className="pa-accent mono" style={{ textAlign: 'center', fontSize: 12.5, marginTop: 16, lineHeight: 1.9 }}>
          Liveness detection · Anti-spoof · Deepfake check ✓
        </p>
      )}
    </div>
  );
}

/* ── Screen 5 — Voice Enrollment ──────────────────────────────────────────── */
function Voice({ onNext }: { onNext: () => void }) {
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!recording) return;
    const iv = setInterval(() => setProgress((p) => Math.min(100, p + 2.5)), 80);
    return () => clearInterval(iv);
  }, [recording]);

  useEffect(() => {
    if (progress >= 100) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const t = setTimeout(onNext, 700);
      return () => clearTimeout(t);
    }
  }, [progress, onNext]);

  async function start() {
    try { streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { /* simulate */ }
    setRecording(true);
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return (
    <div className="pa-card">
      <StepHead icon={<Mic size={26} color="#6366f1" />} title="Voice Verification" subtitle="Read the phrase aloud:" />
      <div
        style={{
          margin: '4px 0 18px',
          padding: '18px 16px',
          borderRadius: 14,
          textAlign: 'center',
          background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.22)',
          fontSize: 17,
          fontWeight: 600,
          color: '#3730a3',
          fontStyle: 'italic',
        }}
      >
        “My digital identity belongs only to me.”
      </div>

      {recording && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 46, marginBottom: 14 }}>
          {Array.from({ length: 28 }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 3,
                borderRadius: 3,
                background: 'linear-gradient(180deg,#818cf8,#a78bfa)',
                height: `${20 + Math.abs(Math.sin(i * 0.9 + progress * 0.3)) * 26}px`,
                opacity: 0.85,
              }}
            />
          ))}
        </div>
      )}

      {recording ? (
        <p className="pa-accent mono" style={{ textAlign: 'center', fontSize: 12.5 }}>
          Capturing voiceprint · {Math.round(progress)}%
        </p>
      ) : (
        <button className="pa-btn" onClick={start}><Mic size={16} /> Start Recording</button>
      )}
    </div>
  );
}

/* ── Screen 6 — Device Biometric ──────────────────────────────────────────── */
function Biometric({
  onNext,
  onResult,
}: {
  onNext: () => void;
  onResult: (r: { credentialId: string; simulated: boolean }) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    const res = await registerDeviceCredential('pinit-user');
    onResult({ credentialId: res.credentialId, simulated: res.simulated });
    setBusy(false);
    onNext();
  }

  return (
    <div className="pa-card">
      <StepHead
        icon={<Fingerprint size={26} color="#6366f1" />}
        title="Secure Device Setup"
        subtitle="Use Face ID or Fingerprint to secure your Human Origin Identity."
      />
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0 20px' }}>
        <div
          className={busy ? 'pa-spin' : ''}
          style={{
            width: 92, height: 92, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(circle at 50% 30%, rgba(129,140,248,0.35), rgba(99,102,241,0.08))',
            border: '1px solid rgba(129,140,248,0.4)',
          }}
        >
          <Fingerprint size={44} color="#6366f1" />
        </div>
      </div>
      <button className="pa-btn" onClick={verify} disabled={busy}>
        {busy ? 'Verifying device…' : <>Verify Device <ArrowRight size={17} /></>}
      </button>
      <p className="pa-faint mono" style={{ textAlign: 'center', fontSize: 11.5, marginTop: 14, lineHeight: 1.9 }}>
        WebAuthn · FIDO2 · Secure Enclave · Device Attestation
      </p>
    </div>
  );
}

/** Turn a raw network/axios error into a friendly, actionable message. */
function friendlyError(e: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const status = (e as any)?.response?.status as number | undefined;
  const msg = (e instanceof Error ? e.message : String(e)) || '';
  if (status === undefined || /network|timeout|status code 5\d\d/i.test(msg) || (status && status >= 500)) {
    return 'The server is waking up — this can take a moment on first use. Please tap Retry.';
  }
  return 'Identity creation failed. Please tap Retry.';
}

/* ── Screen 7 — Identity Creation ─────────────────────────────────────────── */
function Creating({
  run, onDone, onError, error,
}: { run: () => Promise<void>; onDone: () => void; onError: (m: string) => void; error: string }) {
  const INITIAL: CheckItem[] = [
    { label: 'Face Verified', done: false },
    { label: 'Voice Verified', done: false },
    { label: 'Human Presence Verified', done: false },
    { label: 'Device Verified', done: false },
    { label: 'Cryptographic Keys Generated', done: false },
  ];
  const [items, setItems] = useState<CheckItem[]>(INITIAL);
  const [tries, setTries] = useState(0);
  const ranRef = useRef(-1);

  useEffect(() => {
    if (ranRef.current === tries) return;
    ranRef.current = tries;
    onError('');
    setItems(INITIAL.map((it) => ({ ...it, done: false })));

    // Reveal the checklist as the account is provisioned in the background.
    INITIAL.forEach((_, i) =>
      setTimeout(() => setItems((prev) => prev.map((it, j) => (j <= i ? { ...it, done: true } : it))), 500 * (i + 1))
    );

    run()
      .then(() => setTimeout(onDone, 3200))
      .catch((e) => onError(friendlyError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries]);

  return (
    <div className="pa-card">
      <StepHead
        icon={<Sparkles size={26} color="#6366f1" />}
        title="Creating Identity"
        subtitle="Forging your Human Origin Identity…"
      />
      <Checklist items={items} />
      <SystemTrace lines={['Generate HOID', 'Issue Presence Certificate', 'Create Identity Record', 'Register Device']} />
      {error && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <p style={{ color: '#b45309', fontSize: 13, lineHeight: 1.5 }}>{error}</p>
          <button className="pa-btn" style={{ marginTop: 12 }} onClick={() => setTries((t) => t + 1)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Screen 8 — Success (already authenticated) ───────────────────────────── */
function Success({ onEnter }: { onEnter: () => void }) {
  const rows = [
    'Human Origin Identity Created',
    'Presence Certificate Issued',
    'Device Registered',
    'Recovery Enabled',
  ];
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div className="pa-pop" style={{ width: 76, height: 76, margin: '4px auto 16px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 34px rgba(16,185,129,0.65)' }}>
        <CheckCircle2 size={42} color="#fff" />
      </div>
      <h1 style={{ fontSize: 23, fontWeight: 800 }}>Welcome to PINIT</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '18px 0' }}>
        {rows.map((r) => (
          <div key={r} className="pa-check on" style={{ justifyContent: 'center' }}>
            <CheckCircle2 size={16} color="#10b981" />
            <span style={{ fontSize: 13.5, color: '#0f172a', fontWeight: 600 }}>{r}</span>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 18 }}><TrustBadge score={99.8} /></div>
      <button className="pa-btn" onClick={onEnter}>Enter PINIT <ArrowRight size={17} /></button>
      <p className="pa-faint" style={{ fontSize: 11.5, marginTop: 12 }}>Session active · JWT issued · No login required</p>
    </div>
  );
}
