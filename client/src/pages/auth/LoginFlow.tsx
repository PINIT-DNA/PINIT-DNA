import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  saveRegistration, generateHoid,
} from '../../lib/hoid';
import { touchLastLogin } from '../../lib/identity-store';
import { warmBackend, parseJwt, getAccessToken, hasHubSession } from '../../lib/auth';
import { resolveDefaultHomePath } from '../../lib/subscription/post-upgrade-redirect';
import { takePendingTeamInvite } from '../../lib/team-invite';
import { loginWithFace } from '../../lib/face-api-client';
import { collectFingerprint } from '../../lib/device-fingerprint';
import { preloadFaceModels } from '../../lib/face-capture';
import { createExchangeSso } from '../../services/dashboard.api';
import {
  resolveExchangeReturn,
  stashExchangeReturn,
  takeStashedExchangeReturn,
} from '../../lib/exchange-return';

type Step = 'welcome' | 'face' | 'fingerprint' | 'voice' | 'presence' | 'success';
/** Face (real) → fingerprint (auto) → voice (real) → database match. */
const ORDER: Step[] = ['welcome', 'face', 'fingerprint', 'voice', 'presence', 'success'];

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.22 },
};

export function LoginFlow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithFaceResponse, resetLocalSession } = useAuth();
  const exchangeReturn = resolveExchangeReturn(searchParams.get('exchange_return'));

  useEffect(() => {
    if (exchangeReturn) stashExchangeReturn(exchangeReturn);
  }, [exchangeReturn]);

  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  const [presenceKey, setPresenceKey] = useState(0);
  const [openingExchange, setOpeningExchange] = useState(false);
  const autoExchangeRef = useRef(false);
  const faceEmbeddingRef = useRef<number[] | null>(null);
  const voiceFingerprintRef = useRef<number[] | null>(null);
  const bioCredentialRef = useRef<string | undefined>(undefined);
  const deviceFpRef = useRef<string>('');

  const go = (s: Step) => { setError(''); setStep(s); };
  const idx = ORDER.indexOf(step);

  const sessionResetRef = useRef(false);
  useEffect(() => {
    if (!sessionResetRef.current) {
      sessionResetRef.current = true;
      // Exchange return: keep an existing Hub JWT on this origin (handoff uses it).
      if (!exchangeReturn) {
        resetLocalSession();
        clearRegistration();
      }
    }
    warmBackend();
    preloadFaceModels();
    collectFingerprint().then((f) => { deviceFpRef.current = f.hash; }).catch(() => {});
  }, [resetLocalSession, exchangeReturn]);

  function goToRegister() {
    const er = exchangeReturn || takeStashedExchangeReturn();
    if (er) {
      setError('Continue with Hub signs into your existing Pinit ID. It does not create a new one. Try verification again.');
      return;
    }
    clearRegistration();
    navigate('/register/account-type', { replace: true });
  }

  function handleNotRegistered(msg: string) {
    setError(msg);
  }

  async function enterAfterLogin() {
    const pendingInvite = takePendingTeamInvite();
    if (pendingInvite) {
      navigate(`/team/join/${encodeURIComponent(pendingInvite)}`, { replace: true });
      return;
    }

    const er = exchangeReturn || takeStashedExchangeReturn();
    if (er) {
      setOpeningExchange(true);
      try {
        const sso = await createExchangeSso();
        if (!sso?.token) throw new Error('Hub did not issue an Exchange sign-in token.');
        const target = new URL(er);
        target.searchParams.set('hub_sso', sso.token);
        window.location.replace(target.toString());
        return;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not return to Exchange.');
        setOpeningExchange(false);
        return;
      }
    }

    const token = getAccessToken();
    const parsed = token ? parseJwt(token) : null;
    navigate(resolveDefaultHomePath(parsed?.accountType ?? 'INDIVIDUAL'), { replace: true });
  }

  const enterAfterLoginRef = useRef(enterAfterLogin);
  enterAfterLoginRef.current = enterAfterLogin;

  /** Already signed into Hub on this origin — skip face steps and return to Exchange. */
  useEffect(() => {
    if (!exchangeReturn || autoExchangeRef.current || !hasHubSession()) return;
    autoExchangeRef.current = true;
    setOpeningExchange(true);
    void enterAfterLoginRef.current();
  }, [exchangeReturn]);

  if (openingExchange && exchangeReturn) {
    return (
      <AuthShell steps={ORDER.length} current={0} tagline="Biometric Access">
        <div className="pa-card" style={{ textAlign: 'center' }}>
          <div
            className="pa-spin"
            style={{
              width: 32, height: 32, margin: '12px auto',
              border: '3px solid rgba(120,160,220,0.2)', borderTopColor: '#3b9eff', borderRadius: '50%',
            }}
          />
          <h1 style={{ fontSize: 20, fontWeight: 800, marginTop: 16 }}>Returning to Exchange…</h1>
          <p className="pa-muted" style={{ fontSize: 14, marginTop: 8 }}>
            Using your existing Pinit HUB session on {window.location.origin}.
          </p>
          {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell steps={ORDER.length} current={idx} tagline="Biometric Access">
      <AnimatePresence mode="wait">
        <motion.div key={step} {...fade}>
          {step === 'welcome' && (
            <WelcomeBack
              onNext={() => go('face')}
              onRegister={goToRegister}
              exchangeReturn={!!exchangeReturn}
              needsFaceVerify={Boolean(exchangeReturn && !hasHubSession())}
            />
          )}
          {step === 'face' && (
            <>
              <FaceRoundScan
                mode="login"
                title="Face Authentication"
                onEmbedding={(emb) => { faceEmbeddingRef.current = emb; }}
                onNext={() => go('fingerprint')}
                onError={(m) => setError(m)}
              />
              {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{error}</p>}
            </>
          )}
          {step === 'fingerprint' && (
            <BiometricStep
              mode="login"
              enrollmentLabel={deviceFpRef.current || 'login'}
              deviceFingerprint={deviceFpRef.current || undefined}
              onDone={(r) => {
                bioCredentialRef.current = r.credentialId;
                go('voice');
              }}
              onError={(m) => setError(m)}
            />
          )}
          {step === 'voice' && (
            <VoiceCaptureStep
              randomPhrase
              optional
              onDone={(fp) => { voiceFingerprintRef.current = fp; go('presence'); }}
              onSkip={() => { voiceFingerprintRef.current = null; go('presence'); }}
              onError={(m) => setError(m)}
            />
          )}
          {step === 'presence' && (
            <Presence
              key={presenceKey}
              error={error}
              exchangeReturn={!!exchangeReturn}
              run={async () => {
                const embedding = faceEmbeddingRef.current;
                const voiceFp = voiceFingerprintRef.current;
                if (!embedding) throw new Error('Face data missing. Scan again.');

                const result = await loginWithFace({
                  embedding,
                  voiceFingerprint: voiceFp ?? undefined,
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
                    webauthnCredentialId: bioCredentialRef.current,
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
            <LoginSuccess
              exchangeReturn={!!exchangeReturn}
              openingExchange={openingExchange}
              error={error}
              onEnter={() => { void enterAfterLogin(); }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

function WelcomeBack({
  onNext,
  onRegister,
  exchangeReturn,
  needsFaceVerify,
}: {
  onNext: () => void;
  onRegister: () => void;
  exchangeReturn?: boolean;
  needsFaceVerify?: boolean;
}) {
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div style={{
        width: 72, height: 72, margin: '4px auto 16px', borderRadius: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(circle at 50% 30%, rgba(59,158,255,0.35), rgba(29,111,216,0.08))',
        border: '1px solid rgba(59,158,255,0.35)',
      }}>
        <UserCheck size={34} color="#3b9eff" />
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Welcome Back</h1>
      <p className="pa-muted" style={{ fontSize: 14, marginTop: 8 }}>
        {exchangeReturn
          ? needsFaceVerify
            ? 'Exchange needs a quick face check on this browser (localhost:3000). Hub open on another port does not share login.'
            : 'Sign in to Pinit Hub to continue into Exchange with the same identity.'
          : 'Face identifies you. Device authentication is bound to that same account.'}
      </p>
      {exchangeReturn && needsFaceVerify && (
        <p style={{ fontSize: 12, color: '#fbbf24', marginTop: 8 }}>
          Tip: use Hub at <strong>http://localhost:3000</strong> only — not :3001 or another port.
        </p>
      )}
      {exchangeReturn && (
        <p style={{ fontSize: 12, color: '#6ee7b7', marginTop: 8 }}>
          After verification you’ll return to Pinit Exchange automatically.
        </p>
      )}
      <div className="pa-bio-steps">
        <div className="pa-bio-step">
          <ScanFace size={18} color="#3b9eff" style={{ margin: '0 auto' }} />
          <span>Face</span>
          <em>Scan</em>
        </div>
        <div className="pa-bio-step">
          <ShieldCheck size={18} color="#3b9eff" style={{ margin: '0 auto' }} />
          <span>Device</span>
          <em>Bind</em>
        </div>
        <div className="pa-bio-step">
          <CheckCircle2 size={18} color="#3b9eff" style={{ margin: '0 auto' }} />
          <span>Voice</span>
          <em>Optional</em>
        </div>
      </div>
      <button className="pa-btn" onClick={onNext}><ScanFace size={17} /> Verify Identity</button>
      {!exchangeReturn && (
        <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onRegister}>
          New here? Create biometric account
        </button>
      )}
    </div>
  );
}

function Presence({
  run, onDone, onError, onRegister, onRetry, error, exchangeReturn,
}: {
  run: () => Promise<void>;
  onDone: () => void;
  onError: (m: string) => void;
  onRegister: () => void;
  onRetry: () => void;
  error: string;
  exchangeReturn?: boolean;
}) {
  const [items, setItems] = useState<CheckItem[]>([
    { label: 'Face Captured', done: false },
    { label: 'Device Bound', done: false },
    { label: 'Voice (optional)', done: false },
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
      <StepHead icon={<ShieldCheck size={26} color="#3b9eff" />} title="Checking Database" subtitle="Matching your biometrics…" />
      <Checklist items={items} />
      <SystemTrace lines={['Identify face', '1:1 verify template', 'Bind this device']} />
      {error && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>
          <button type="button" className="pa-btn" style={{ marginTop: 10 }} onClick={onRetry}>Try again</button>
          {notRegistered && !exchangeReturn && (
            <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10, marginLeft: 8 }} onClick={onRegister}>
              Register instead
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LoginSuccess({
  onEnter,
  exchangeReturn,
  openingExchange,
  error,
}: {
  onEnter: () => void;
  exchangeReturn?: boolean;
  openingExchange?: boolean;
  error?: string;
}) {
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
        <span style={{ fontSize: 13, color: '#e8eef8', fontWeight: 600 }}>{lastStr}</span>
      </div>
      {error && <p style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <button className="pa-btn" onClick={onEnter} disabled={openingExchange}>
        {openingExchange
          ? 'Opening Exchange…'
          : exchangeReturn
            ? <>Continue to Exchange <ArrowRight size={17} /></>
            : <>Enter Pinit HUB <ArrowRight size={17} /></>}
      </button>
    </div>
  );
}
