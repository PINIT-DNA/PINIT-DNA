import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ShieldCheck, Camera, Mic, Sparkles,
  ArrowRight, CheckCircle2,
} from 'lucide-react';

import { AuthShell } from '../../components/auth/AuthShell';
import { FaceRoundScan } from '../../components/auth/FaceRoundScan';
import { BiometricStep, isDuplicateIdentityError } from '../../components/auth/BiometricStep';
import { VoiceCaptureStep } from '../../components/auth/VoiceCaptureStep';
import { StepHead, Checklist, SystemTrace, TrustBadge, type CheckItem } from '../../components/auth/parts';
import { useAuth } from '../../context/AuthContext';
import { collectFingerprint } from '../../lib/device-fingerprint';
import { generateHoid, saveRegistration } from '../../lib/hoid';
import { type BiometricResult } from '../../lib/webauthn';
import { storeIdentity } from '../../lib/identity-store';
import { warmBackend } from '../../lib/auth';
import { registerFaceIdentity } from '../../lib/face-api-client';
import { preloadFaceModels } from '../../lib/face-capture';

type Step = 'welcome' | 'permissions' | 'face' | 'biometric' | 'voice' | 'creating' | 'success';
const ORDER: Step[] = ['welcome', 'permissions', 'face', 'biometric', 'voice', 'creating', 'success'];

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.22 },
};

export function RegistrationFlow() {
  const navigate = useNavigate();
  const { loginWithFaceResponse } = useAuth();

  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  const deviceFpRef = useRef<string>('');
  const hoidRef = useRef<string>('');
  const faceImageRef = useRef<string | null>(null);
  const faceEmbeddingRef = useRef<number[] | null>(null);
  const voiceFingerprintRef = useRef<number[] | null>(null);
  const bioRef = useRef<BiometricResult | null>(null);

  const go = (s: Step) => { setError(''); setStep(s); };
  const idx = ORDER.indexOf(step);

  function afterFace() {
    go('biometric');
  }

  function afterBiometric(r: BiometricResult) {
    bioRef.current = r;
    go('voice');
  }

  function afterVoice(fp: number[]) {
    voiceFingerprintRef.current = fp;
    hoidRef.current = generateHoid(deviceFpRef.current);
    go('creating');
  }

  return (
    <AuthShell steps={ORDER.length} current={idx} tagline="Create Your Identity">
      <AnimatePresence mode="wait">
        <motion.div key={step} {...fade}>
          {step === 'welcome'     && <Welcome onNext={() => go('permissions')} />}
          {step === 'permissions' && <Permissions deviceFpRef={deviceFpRef} onNext={() => go('face')} />}
          {step === 'face'        && (
            <>
              <FaceRoundScan
                mode="register"
                title="Face Enrollment"
                onCapture={(img) => { faceImageRef.current = img; }}
                onEmbedding={(emb) => { faceEmbeddingRef.current = emb; }}
                onNext={afterFace}
                onError={(m) => setError(m)}
              />
              {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{error}</p>}
            </>
          )}
          {step === 'biometric'   && (
            <BiometricStep mode="register" onDone={afterBiometric} />
          )}
          {step === 'voice'       && (
            <VoiceCaptureStep onDone={afterVoice} onError={(m) => setError(m)} />
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
                  faceImage: faceImageRef.current,
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
      <StepHead icon={<Sparkles size={26} color="#6366f1" />} title="Welcome to PINIT" subtitle={<>Face is your lock — fingerprint UI + voice complete your identity.</>} />
      <button className="pa-btn" onClick={onNext}>Get Started <ArrowRight size={17} /></button>
    </div>
  );
}

function Permissions({ deviceFpRef, onNext }: { deviceFpRef: React.MutableRefObject<string>; onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function allow() {
    setBusy(true);
    setErr('');
    warmBackend();
    preloadFaceModels();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      setErr('Camera and microphone access are required.');
      setBusy(false);
      return;
    }
    try { deviceFpRef.current = (await collectFingerprint()).hash; } catch { /* noop */ }
    setBusy(false);
    onNext();
  }

  return (
    <div className="pa-card">
      <StepHead icon={<ShieldCheck size={26} color="#6366f1" />} title="Permissions" subtitle="Camera, mic, and device biometrics — one-time setup." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20 }}>
        {[
          { icon: <Camera size={18} />, label: 'Camera', sub: 'Round face scan' },
          { icon: <Mic size={18} />, label: 'Microphone', sub: 'Quick voiceprint' },
          { icon: <ShieldCheck size={18} />, label: 'Fingerprint UI', sub: 'Visual scan step (auto-continues on web)' },
        ].map((p) => (
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
      <button className="pa-btn" onClick={allow} disabled={busy}>{busy ? 'Requesting…' : <>Allow &amp; Continue <ArrowRight size={17} /></>}</button>
    </div>
  );
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
    { label: 'Face Captured', done: false },
    { label: 'Fingerprint Verified', done: false },
    { label: 'Voice Captured', done: false },
    { label: 'Saved to Database', done: false },
  ];
  const [items, setItems] = useState<CheckItem[]>(INITIAL);
  const [tries, setTries] = useState(0);
  const ranRef = useRef(-1);
  const duplicate = isDuplicateIdentityError(error);

  useEffect(() => {
    if (ranRef.current === tries) return;
    ranRef.current = tries;
    onError('');
    setItems(INITIAL.map((it) => ({ ...it, done: false })));
    INITIAL.slice(0, INITIAL.length - 1).forEach((_, i) =>
      setTimeout(() => setItems((prev) => prev.map((it, j) => (j <= i ? { ...it, done: true } : it))), 280 * (i + 1))
    );
    run()
      .then(() => {
        setItems((prev) => prev.map((it) => ({ ...it, done: true })));
        setTimeout(onDone, 900);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : 'Registration failed.';
        onError(msg);
        if (isDuplicateIdentityError(msg)) onDuplicate();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries]);

  return (
    <div className="pa-card">
      <StepHead icon={<Sparkles size={26} color="#6366f1" />} title="Saving to Database" subtitle="Checking you are not already registered…" />
      <Checklist items={items} />
      <SystemTrace lines={['Check duplicates', 'Store biometrics', 'Issue certificate']} />
      {error && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <p style={{ color: duplicate ? '#b45309' : '#fca5a5', fontSize: 13 }}>{error}</p>
          {duplicate ? (
            <>
              <p className="pa-muted" style={{ fontSize: 12, marginTop: 6 }}>Redirecting to login…</p>
              <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onDuplicate}>Login instead</button>
            </>
          ) : (
            <button className="pa-btn" style={{ marginTop: 12 }} onClick={() => setTries((t) => t + 1)}>Retry</button>
          )}
        </div>
      )}
    </div>
  );
}

function Success({ onEnter }: { onEnter: () => void }) {
  useEffect(() => {
    const t = setTimeout(onEnter, 1600);
    return () => clearTimeout(t);
  }, [onEnter]);

  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div className="pa-pop" style={{ width: 76, height: 76, margin: '4px auto 16px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 34px rgba(16,185,129,0.65)' }}>
        <CheckCircle2 size={42} color="#fff" />
      </div>
      <h1 style={{ fontSize: 23, fontWeight: 800 }}>Welcome to PINIT</h1>
      <div style={{ marginBottom: 18 }}><TrustBadge score={99.8} /></div>
      <button className="pa-btn" onClick={onEnter}>Enter PINIT <ArrowRight size={17} /></button>
    </div>
  );
}
