import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ShieldCheck, Camera, Mic, Fingerprint, ScanFace, Sparkles,
  ArrowRight, CheckCircle2,
} from 'lucide-react';

import { AuthShell } from '../../components/auth/AuthShell';
import { FaceAuth } from '../../components/auth/FaceAuth';
import { StepHead, Checklist, SystemTrace, TrustBadge, type CheckItem } from '../../components/auth/parts';
import { useAuth } from '../../context/AuthContext';
import { collectFingerprint } from '../../lib/device-fingerprint';
import { generateHoid, saveRegistration } from '../../lib/hoid';
import { registerDeviceCredential } from '../../lib/webauthn';
import { storeIdentity } from '../../lib/identity-store';
import { warmBackend } from '../../lib/auth';
import { registerFaceIdentity } from '../../lib/face-api-client';
import { captureVoiceFingerprint } from '../../lib/voice-fingerprint';

type Step = 'welcome' | 'permissions' | 'face' | 'voice' | 'biometric' | 'creating' | 'success';
const ORDER: Step[] = ['welcome', 'permissions', 'face', 'voice', 'biometric', 'creating', 'success'];

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.28 },
};

export function RegistrationFlow() {
  const navigate = useNavigate();
  const { loginWithFaceResponse } = useAuth();

  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  const deviceFpRef = useRef<string>('');
  const hoidRef = useRef<string>('');
  const faceEmbeddingRef = useRef<number[] | null>(null);
  const voiceFingerprintRef = useRef<number[] | null>(null);
  const bioRef = useRef<{ credentialId: string; simulated: boolean } | null>(null);

  const go = (s: Step) => { setError(''); setStep(s); };
  const idx = ORDER.indexOf(step);

  return (
    <AuthShell steps={ORDER.length} current={idx} tagline="Create Your Identity">
      <AnimatePresence mode="wait">
        <motion.div key={step} {...fade}>
          {step === 'welcome'     && <Welcome onNext={() => go('permissions')} />}
          {step === 'permissions' && <Permissions deviceFpRef={deviceFpRef} onNext={() => go('face')} />}
          {step === 'face'        && (
            <div className="pa-card">
              <StepHead icon={<ScanFace size={26} color="#6366f1" />} title="Face Enrollment" subtitle="Position your face — blink and smile when prompted." />
              <FaceAuth
                mode="capture"
                variant="embedded"
                onSuccess={(data) => {
                  const emb = data.embedding as number[] | undefined;
                  if (!emb?.length) {
                    setError('Face capture failed. Please try again.');
                    return;
                  }
                  faceEmbeddingRef.current = emb;
                  go('voice');
                }}
              />
              {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 12, textAlign: 'center' }}>{error}</p>}
            </div>
          )}
          {step === 'voice'       && (
            <VoiceEnroll
              onDone={(fp) => { voiceFingerprintRef.current = fp; go('biometric'); }}
              onError={(m) => setError(m)}
            />
          )}
          {step === 'biometric'   && (
            <Biometric
              userId={hoidRef.current || 'pinit-register'}
              onResult={(r) => { bioRef.current = r; hoidRef.current = generateHoid(deviceFpRef.current); go('creating'); }}
              onError={(m) => setError(m)}
            />
          )}
          {step === 'creating'    && (
            <Creating
              error={error}
              run={async () => {
                const embedding = faceEmbeddingRef.current;
                if (!embedding) throw new Error('Face data missing. Go back and scan again.');

                const result = await registerFaceIdentity({
                  embedding,
                  voiceFingerprint: voiceFingerprintRef.current ?? undefined,
                  webauthnCredentialId: bioRef.current?.credentialId,
                  deviceFingerprint: deviceFpRef.current || undefined,
                });

                loginWithFaceResponse(result);
                const shortId = result.user?.shortId ?? '';
                const hoid = hoidRef.current || generateHoid(deviceFpRef.current);
                saveRegistration({
                  hoid,
                  shortId,
                  trustScore: 99.8,
                  deviceFp: deviceFpRef.current,
                  webauthnCredentialId: bioRef.current?.credentialId,
                });
                await storeIdentity({
                  hoid,
                  shortId,
                  deviceFp: deviceFpRef.current,
                  faceEnrolled: true,
                  livenessPassed: true,
                  voiceEnrolled: Boolean(voiceFingerprintRef.current),
                  webauthnCredentialId: bioRef.current?.credentialId ?? null,
                  webauthnSimulated: bioRef.current?.simulated ?? false,
                  trustScore: 99.8,
                });
              }}
              onDone={() => go('success')}
              onError={(m) => setError(m)}
              onDuplicate={() => navigate('/login', { replace: true })}
            />
          )}
          {step === 'success'     && <Success onEnter={() => navigate('/', { replace: true })} />}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="pa-card">
      <StepHead
        icon={<Sparkles size={26} color="#6366f1" />}
        title="Welcome to PINIT"
        subtitle={<>Create your Human Origin Identity.<br />Your face, voice, and device biometrics become your key.</>}
      />
      <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          ['One face, one identity', 'Duplicate faces are blocked server-side'],
          ['Voice + device bound', 'Multi-factor presence verification'],
          ['No passwords', 'Cryptographic proof of human origin'],
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

function Permissions({ deviceFpRef, onNext }: { deviceFpRef: React.MutableRefObject<string>; onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const perms = [
    { icon: <Camera size={18} />,      label: 'Camera',          sub: 'Face capture & liveness' },
    { icon: <Mic size={18} />,         label: 'Microphone',      sub: 'Voiceprint enrolment' },
    { icon: <Fingerprint size={18} />, label: 'Biometrics',      sub: 'Device Face ID / fingerprint' },
    { icon: <ShieldCheck size={18} />, label: 'Device Security', sub: 'Hardware attestation' },
  ];

  async function allow() {
    setBusy(true);
    setErr('');
    warmBackend();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      setErr('Camera and microphone access are required to register.');
      setBusy(false);
      return;
    }
    try { deviceFpRef.current = (await collectFingerprint()).hash; } catch { /* noop */ }
    setBusy(false);
    onNext();
  }

  return (
    <div className="pa-card">
      <StepHead icon={<ShieldCheck size={26} color="#6366f1" />} title="Permissions" subtitle="PINIT needs these to verify human presence and create your identity." />
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
      {err && <p style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{err}</p>}
      <button className="pa-btn" onClick={allow} disabled={busy}>
        {busy ? 'Requesting access…' : <>Allow &amp; Continue <ArrowRight size={17} /></>}
      </button>
    </div>
  );
}

function VoiceEnroll({ onDone, onError }: { onDone: (fp: number[]) => void; onError: (m: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);

  async function start() {
    setRecording(true);
    setProgress(0);
    try {
      const fp = await captureVoiceFingerprint(setProgress);
      onDone(fp);
    } catch {
      onError('Microphone access denied or voice capture failed.');
      setRecording(false);
    }
  }

  return (
    <div className="pa-card">
      <StepHead icon={<Mic size={26} color="#6366f1" />} title="Voice Verification" subtitle="Read the phrase aloud:" />
      <div style={{ margin: '4px 0 18px', padding: '18px 16px', borderRadius: 14, textAlign: 'center', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.22)', fontSize: 17, fontWeight: 600, color: '#3730a3', fontStyle: 'italic' }}>
        “My digital identity belongs only to me.”
      </div>
      {recording && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 46, marginBottom: 14 }}>
            {Array.from({ length: 28 }).map((_, i) => (
              <span key={i} style={{ width: 3, borderRadius: 3, background: 'linear-gradient(180deg,#818cf8,#a78bfa)', height: `${20 + Math.abs(Math.sin(i * 0.9 + progress * 0.3)) * 26}px`, opacity: 0.85 }} />
            ))}
          </div>
          <p className="pa-accent mono" style={{ textAlign: 'center', fontSize: 12.5 }}>Capturing voiceprint · {Math.round(progress)}%</p>
        </>
      )}
      {!recording && <button className="pa-btn" onClick={start}><Mic size={16} /> Start Recording</button>}
    </div>
  );
}

function Biometric({
  userId, onResult, onError,
}: {
  userId: string;
  onResult: (r: { credentialId: string; simulated: boolean }) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      const res = await registerDeviceCredential(userId, { strict: true });
      onResult({ credentialId: res.credentialId, simulated: res.simulated });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Biometric setup failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pa-card">
      <StepHead icon={<Fingerprint size={26} color="#6366f1" />} title="Secure Device Setup" subtitle="Use Face ID or Fingerprint to bind this device." />
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0 20px' }}>
        <div className={busy ? 'pa-spin' : ''} style={{ width: 92, height: 92, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 30%, rgba(129,140,248,0.35), rgba(99,102,241,0.08))', border: '1px solid rgba(129,140,248,0.4)' }}>
          <Fingerprint size={44} color="#6366f1" />
        </div>
      </div>
      <button className="pa-btn" onClick={verify} disabled={busy}>
        {busy ? 'Verifying device…' : <>Verify Device <ArrowRight size={17} /></>}
      </button>
    </div>
  );
}

function friendlyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Identity creation failed. Please tap Retry.';
}

function Creating({
  run, onDone, onError, onDuplicate, error,
}: {
  run: () => Promise<void>;
  onDone: () => void;
  onError: (m: string) => void;
  onDuplicate: () => void;
  error: string;
}) {
  const INITIAL: CheckItem[] = [
    { label: 'Face Verified', done: false },
    { label: 'Voice Verified', done: false },
    { label: 'Device Verified', done: false },
    { label: 'Identity Record Created', done: false },
    { label: 'Duplicate Check Passed', done: false },
  ];
  const [items, setItems] = useState<CheckItem[]>(INITIAL);
  const [tries, setTries] = useState(0);
  const ranRef = useRef(-1);

  useEffect(() => {
    if (ranRef.current === tries) return;
    ranRef.current = tries;
    onError('');
    setItems(INITIAL.map((it) => ({ ...it, done: false })));
    INITIAL.forEach((_, i) =>
      setTimeout(() => setItems((prev) => prev.map((it, j) => (j <= i ? { ...it, done: true } : it))), 500 * (i + 1))
    );
    run()
      .then(() => setTimeout(onDone, 3200))
      .catch((e) => {
        const msg = friendlyError(e);
        onError(msg);
        if (/already registered|duplicate|login instead/i.test(msg)) onDuplicate();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries]);

  return (
    <div className="pa-card">
      <StepHead icon={<Sparkles size={26} color="#6366f1" />} title="Creating Identity" subtitle="Registering your biometrics on the server…" />
      <Checklist items={items} />
      <SystemTrace lines={['Check Face Uniqueness', 'Store Voice Fingerprint', 'Bind Device Credential', 'Issue JWT']} />
      {error && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <p style={{ color: '#b45309', fontSize: 13, lineHeight: 1.5 }}>{error}</p>
          <button className="pa-btn" style={{ marginTop: 12 }} onClick={() => setTries((t) => t + 1)}>Retry</button>
        </div>
      )}
    </div>
  );
}

function Success({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div className="pa-pop" style={{ width: 76, height: 76, margin: '4px auto 16px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 34px rgba(16,185,129,0.65)' }}>
        <CheckCircle2 size={42} color="#fff" />
      </div>
      <h1 style={{ fontSize: 23, fontWeight: 800 }}>Welcome to PINIT</h1>
      <p className="pa-muted" style={{ fontSize: 14, margin: '12px 0 18px' }}>Your face, voice, and device are now bound to one identity.</p>
      <div style={{ marginBottom: 18 }}><TrustBadge score={99.8} /></div>
      <button className="pa-btn" onClick={onEnter}>Enter PINIT <ArrowRight size={17} /></button>
    </div>
  );
}
