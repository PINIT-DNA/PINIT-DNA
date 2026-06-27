import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ScanFace, ShieldCheck, ArrowRight, CheckCircle2, UserCheck } from 'lucide-react';

import { AuthShell } from '../../components/auth/AuthShell';
import { FaceRoundScan } from '../../components/auth/FaceRoundScan';
import { BiometricStep, isNotRegisteredError } from '../../components/auth/BiometricStep';
import { VoiceCaptureStep } from '../../components/auth/VoiceCaptureStep';
import { StepHead, Checklist, SystemTrace, TrustBadge, type CheckItem } from '../../components/auth/parts';
import { useAuth } from '../../context/AuthContext';
import {
  getTrustScore, getLastLogin, recordLogin, clearRegistration,
  saveRegistration, getStoredWebAuthnCredential, generateHoid,
} from '../../lib/hoid';
import { touchLastLogin } from '../../lib/identity-store';
import { warmBackend } from '../../lib/auth';
import { loginWithFace } from '../../lib/face-api-client';
import { collectFingerprint } from '../../lib/device-fingerprint';
import { preloadFaceModels } from '../../lib/face-capture';

type Step = 'welcome' | 'face' | 'biometric' | 'voice' | 'presence' | 'success';
/** Face → fingerprint UI → voice → database check. */
const ORDER: Step[] = ['welcome', 'face', 'biometric', 'voice', 'presence', 'success'];

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.22 },
};

export function LoginFlow() {
  const navigate = useNavigate();
  const { loginWithFaceResponse } = useAuth();

  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  const [presenceKey, setPresenceKey] = useState(0);
  const faceEmbeddingRef = useRef<number[] | null>(null);
  const voiceFingerprintRef = useRef<number[] | null>(null);
  const bioCredentialRef = useRef<string | undefined>(undefined);

  const go = (s: Step) => { setError(''); setStep(s); };
  const idx = ORDER.indexOf(step);

  useEffect(() => { warmBackend(); preloadFaceModels(); }, []);

  function goToRegister() {
    clearRegistration();
    navigate('/register', { replace: true });
  }

  function handleNotRegistered(msg: string) {
    setError(msg);
  }

  return (
    <AuthShell steps={ORDER.length} current={idx} tagline="Verify Your Presence">
      <AnimatePresence mode="wait">
        <motion.div key={step} {...fade}>
          {step === 'welcome' && (
            <WelcomeBack onNext={() => go('face')} onRegister={goToRegister} />
          )}
          {step === 'face' && (
            <>
              <FaceRoundScan
                mode="login"
                title="Face Authentication"
                onEmbedding={(emb) => { faceEmbeddingRef.current = emb; }}
                onNext={() => go('biometric')}
                onError={(m) => setError(m)}
              />
              {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{error}</p>}
            </>
          )}
          {step === 'biometric' && (
            <BiometricStep
              mode="login"
              onDone={(r) => { bioCredentialRef.current = r.credentialId; go('voice'); }}
            />
          )}
          {step === 'voice' && (
            <VoiceCaptureStep
              onDone={(fp) => { voiceFingerprintRef.current = fp; go('presence'); }}
              onError={(m) => setError(m)}
            />
          )}
          {step === 'presence' && (
            <Presence
              key={presenceKey}
              error={error}
              run={async () => {
                const embedding = faceEmbeddingRef.current;
                const voiceFp = voiceFingerprintRef.current;
                if (!embedding || !voiceFp) throw new Error('Biometric data missing.');

                const result = await loginWithFace({
                  embedding,
                  voiceFingerprint: voiceFp,
                  webauthnCredentialId: bioCredentialRef.current,
                  deviceFingerprint: (await collectFingerprint().catch(() => ({ hash: '' }))).hash || undefined,
                });
                loginWithFaceResponse(result);

                const shortId = result.user?.shortId ?? '';
                if (shortId) {
                  let deviceFp = '';
                  try { deviceFp = (await collectFingerprint()).hash; } catch { /* noop */ }
                  saveRegistration({
                    hoid: generateHoid(deviceFp),
                    shortId,
                    trustScore: getTrustScore(),
                    deviceFp,
                    webauthnCredentialId: getStoredWebAuthnCredential() ?? undefined,
                  });
                  recordLogin();
                  await touchLastLogin(shortId);
                }
              }}
              onDone={() => go('success')}
              onError={(m) => {
                if (isNotRegisteredError(m)) handleNotRegistered(m);
                else setError(m);
              }}
              onRegister={goToRegister}
              onRetry={() => { setError(''); setPresenceKey((k) => k + 1); }}
            />
          )}
          {step === 'success' && (
            <LoginSuccess onEnter={() => navigate('/', { replace: true })} />
          )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

function WelcomeBack({ onNext, onRegister }: { onNext: () => void; onRegister: () => void }) {
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div style={{ width: 76, height: 76, margin: '4px auto 16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 30%, rgba(129,140,248,0.35), rgba(99,102,241,0.06))', border: '1px solid rgba(129,140,248,0.4)' }}>
        <UserCheck size={38} color="#6366f1" />
      </div>
      <h1 style={{ fontSize: 23, fontWeight: 800 }}>Welcome Back</h1>
      <p className="pa-muted" style={{ fontSize: 14, marginTop: 8, marginBottom: 22 }}>
        Face scan → fingerprint scan → voice — then we match our database.
      </p>
      <button className="pa-btn" onClick={onNext}><ScanFace size={17} /> Verify Identity</button>
      <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onRegister}>New here? Register</button>
    </div>
  );
}

function Presence({
  run, onDone, onError, onRegister, onRetry, error,
}: {
  run: () => Promise<void>;
  onDone: () => void;
  onError: (m: string) => void;
  onRegister: () => void;
  onRetry: () => void;
  error: string;
}) {
  const [items, setItems] = useState<CheckItem[]>([
    { label: 'Face Captured', done: false },
    { label: 'Fingerprint Verified', done: false },
    { label: 'Voice Captured', done: false },
    { label: 'Database Match', done: false },
  ]);
  const ran = useRef(false);
  const notRegistered = isNotRegisteredError(error);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const preMatch = items.length - 1;
    items.slice(0, preMatch).forEach((_, i) =>
      setTimeout(() => setItems((prev) => prev.map((it, j) => (j <= i ? { ...it, done: true } : it))), 250 * (i + 1))
    );
    run()
      .then(() => {
        setItems((prev) => prev.map((it) => ({ ...it, done: true })));
        setTimeout(onDone, 700);
      })
      .catch((e) => onError(e?.message || 'Verification failed.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pa-card">
      <StepHead icon={<ShieldCheck size={26} color="#6366f1" />} title="Checking Database" subtitle="Matching your biometrics…" />
      <Checklist items={items} />
      <SystemTrace lines={['Compare Face', 'Verify Voice', 'Lookup Identity']} />
      {error && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>
          <button type="button" className="pa-btn" style={{ marginTop: 10 }} onClick={onRetry}>Try again</button>
          {notRegistered && (
            <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10, marginLeft: 8 }} onClick={onRegister}>
              Register instead
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LoginSuccess({ onEnter }: { onEnter: () => void }) {
  const last = getLastLogin();
  const lastStr = last ? `Today ${last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—';

  useEffect(() => {
    const t = setTimeout(onEnter, 1600);
    return () => clearTimeout(t);
  }, [onEnter]);

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
