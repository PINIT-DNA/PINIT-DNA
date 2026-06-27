import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ScanFace, Fingerprint, Mic, ArrowRight, CheckCircle2, UserCheck } from 'lucide-react';

import { AuthShell } from '../../components/auth/AuthShell';
import { FaceAuth } from '../../components/auth/FaceAuth';
import { StepHead, TrustBadge } from '../../components/auth/parts';
import { useAuth } from '../../context/AuthContext';
import {
  getTrustScore, getLastLogin, recordLogin, clearRegistration,
  saveRegistration, getStoredWebAuthnCredential, generateHoid,
} from '../../lib/hoid';
import { assertDeviceCredential } from '../../lib/webauthn';
import { touchLastLogin } from '../../lib/identity-store';
import { warmBackend } from '../../lib/auth';
import { loginWithFace } from '../../lib/face-api-client';
import { captureVoiceFingerprint } from '../../lib/voice-fingerprint';
import { collectFingerprint } from '../../lib/device-fingerprint';

type Step = 'welcome' | 'face' | 'voice' | 'biometric' | 'success';
const ORDER: Step[] = ['welcome', 'face', 'voice', 'biometric', 'success'];

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.28 },
};

export function LoginFlow() {
  const navigate = useNavigate();
  const { loginWithFaceResponse } = useAuth();

  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  const faceEmbeddingRef = useRef<number[] | null>(null);

  const go = (s: Step) => { setError(''); setStep(s); };
  const idx = ORDER.indexOf(step);

  useEffect(() => { warmBackend(); }, []);

  function useDifferentIdentity() {
    clearRegistration();
    navigate('/register', { replace: true });
  }

  return (
    <AuthShell steps={ORDER.length} current={idx} tagline="Verify Your Presence">
      <AnimatePresence mode="wait">
        <motion.div key={step} {...fade}>
          {step === 'welcome' && (
            <WelcomeBack
              onNext={() => go('face')}
              onSwitch={useDifferentIdentity}
            />
          )}
          {step === 'face' && (
            <div className="pa-card">
              <StepHead icon={<ScanFace size={26} color="#6366f1" />} title="Face Authentication" subtitle="Look at the camera — blink and smile when prompted." />
              <FaceAuth
                mode="capture"
                variant="embedded"
                onSuccess={(data) => {
                  const emb = data.embedding as number[] | undefined;
                  if (!emb?.length) {
                    setError('Face capture failed.');
                    return;
                  }
                  faceEmbeddingRef.current = emb;
                  go('voice');
                }}
              />
              {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 12, textAlign: 'center' }}>{error}</p>}
            </div>
          )}
          {step === 'voice' && (
            <VoiceLogin
              error={error}
              onDone={async (voiceFp) => {
                const embedding = faceEmbeddingRef.current;
                if (!embedding) throw new Error('Face data missing.');
                const result = await loginWithFace({
                  embedding,
                  voiceFingerprint: voiceFp,
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
                go('biometric');
              }}
              onError={(m) => setError(m)}
              onSwitch={useDifferentIdentity}
            />
          )}
          {step === 'biometric' && (
            <BiometricConfirm
              error={error}
              onNext={() => go('success')}
              onError={(m) => setError(m)}
              onSwitch={useDifferentIdentity}
            />
          )}
          {step === 'success' && <LoginSuccess onEnter={() => navigate('/', { replace: true })} />}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

function WelcomeBack({ onNext, onSwitch }: { onNext: () => void; onSwitch: () => void }) {
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div style={{ width: 76, height: 76, margin: '4px auto 16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 30%, rgba(129,140,248,0.35), rgba(99,102,241,0.06))', border: '1px solid rgba(129,140,248,0.4)' }}>
        <UserCheck size={38} color="#6366f1" />
      </div>
      <h1 style={{ fontSize: 23, fontWeight: 800 }}>Welcome Back</h1>
      <p className="pa-muted" style={{ fontSize: 14, marginTop: 8, marginBottom: 22 }}>
        Verify your face, voice, and device to sign in.
      </p>
      <button className="pa-btn" onClick={onNext}><ScanFace size={17} /> Verify Identity</button>
      <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onSwitch}>
        Register a new identity
      </button>
    </div>
  );
}

function VoiceLogin({
  onDone, onError, onSwitch, error,
}: {
  onDone: (fp: number[]) => Promise<void>;
  onError: (m: string) => void;
  onSwitch: () => void;
  error: string;
}) {
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  async function start() {
    setRecording(true);
    setBusy(true);
    setProgress(0);
    try {
      const fp = await captureVoiceFingerprint(setProgress);
      await onDone(fp);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Voice verification failed.');
      setRecording(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pa-card">
      <StepHead icon={<Mic size={26} color="#6366f1" />} title="Voice Verification" subtitle="Confirm your voice to complete login." />
      <div style={{ margin: '4px 0 18px', padding: '18px 16px', borderRadius: 14, textAlign: 'center', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.22)', fontSize: 17, fontWeight: 600, color: '#3730a3', fontStyle: 'italic' }}>
        “My digital identity belongs only to me.”
      </div>
      {recording && (
        <p className="pa-accent mono" style={{ textAlign: 'center', fontSize: 12.5, marginBottom: 14 }}>
          Verifying voiceprint · {Math.round(progress)}%
        </p>
      )}
      {error && (
        <div style={{ marginBottom: 14, textAlign: 'center' }}>
          <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>
          <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onSwitch}>Register instead</button>
        </div>
      )}
      {!recording && !busy && (
        <button className="pa-btn" onClick={start}><Mic size={16} /> Verify Voice &amp; Sign In</button>
      )}
    </div>
  );
}

function BiometricConfirm({
  onNext, onError, onSwitch, error,
}: {
  onNext: () => void;
  onError: (m: string) => void;
  onSwitch: () => void;
  error: string;
}) {
  const [busy, setBusy] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      setBusy(true);
      try {
        const expected = getStoredWebAuthnCredential();
        await assertDeviceCredential(expected, { strict: Boolean(expected && !expected.startsWith('sim_')) });
        setBusy(false);
        setTimeout(onNext, 400);
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Device biometric failed.');
        setBusy(false);
      }
    })();
  }, [onNext, onError]);

  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <StepHead icon={<Fingerprint size={26} color="#6366f1" />} title="Confirm Device" subtitle="Use Face ID or Fingerprint" />
      <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 18px' }}>
        <div className={busy ? 'pa-spin' : 'pa-pop'} style={{ width: 92, height: 92, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 30%, rgba(129,140,248,0.35), rgba(99,102,241,0.08))', border: '1px solid rgba(129,140,248,0.4)' }}>
          <Fingerprint size={44} color="#6366f1" />
        </div>
      </div>
      {error && (
        <div style={{ marginTop: 10 }}>
          <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>
          <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onSwitch}>Register a new identity</button>
        </div>
      )}
    </div>
  );
}

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
