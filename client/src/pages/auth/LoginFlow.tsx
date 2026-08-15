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
  saveRegistration, generateHoid, getStoredShortId,
} from '../../lib/hoid';
import { touchLastLogin } from '../../lib/identity-store';
import { warmBackend, parseJwt, getAccessToken, hasValidAccessToken } from '../../lib/auth';
import { toRootPinitId } from '../../lib/pinit-identity';
import { resolveDefaultHomePath } from '../../lib/subscription/post-upgrade-redirect';
import { takePendingTeamInvite } from '../../lib/team-invite';
import { loginWithFace, type FacePadEvidence } from '../../lib/face-api-client';
import { collectFingerprint } from '../../lib/device-fingerprint';
import { preloadFaceModels } from '../../lib/face-capture';
import { createExchangeSso } from '../../services/dashboard.api';
import {
  resolveExchangeReturn,
  stashExchangeReturn,
  takeStashedExchangeReturn,
} from '../../lib/exchange-return';

type Step = 'welcome' | 'face' | 'fingerprint' | 'voice' | 'presence' | 'success';
/**
 * Passkey/voice first, then face+PAD immediately before database match.
 * PAD challenges expire — scanning face too early (before passkey) caused false "liveness inconclusive".
 */
const ORDER: Step[] = ['welcome', 'fingerprint', 'voice', 'face', 'presence', 'success'];

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.22 },
};

const CLAIM_PREFILL_KEY = 'pinit_login_claim_prefill';

export function LoginFlow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithFaceResponse } = useAuth();
  const exchangeReturn = resolveExchangeReturn(searchParams.get('exchange_return'));

  useEffect(() => {
    if (exchangeReturn) stashExchangeReturn(exchangeReturn);
  }, [exchangeReturn]);

  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  const [openingExchange, setOpeningExchange] = useState(false);
  const [claimedShortId, setClaimedShortId] = useState('');
  const faceEmbeddingRef = useRef<number[] | null>(null);
  const padEvidenceRef = useRef<FacePadEvidence | null>(null);
  const voiceFingerprintRef = useRef<number[] | null>(null);
  const bioCredentialRef = useRef<string | undefined>(undefined);
  const webauthnSessionRef = useRef<string | undefined>(undefined);
  const passkeyPendingRef = useRef<string | undefined>(undefined);
  const deviceFpRef = useRef<string>('');
  const claimedShortIdRef = useRef('');
  claimedShortIdRef.current = claimedShortId;

  const go = (s: Step) => { setError(''); setStep(s); };
  const idx = ORDER.indexOf(step);

  const bootRef = useRef(false);
  useEffect(() => {
    if (!bootRef.current) {
      bootRef.current = true;
      let stashed = '';
      try { stashed = sessionStorage.getItem(CLAIM_PREFILL_KEY) || ''; } catch { /* ignore */ }
      const remembered = getStoredShortId() || '';
      const jwtShort = parseJwt(getAccessToken() || '')?.shortId || '';
      const claim = toRootPinitId(stashed) || stashed
        || toRootPinitId(remembered) || remembered
        || toRootPinitId(jwtShort) || jwtShort;
      if (claim) {
        setClaimedShortId(claim);
        try { sessionStorage.setItem(CLAIM_PREFILL_KEY, claim); } catch { /* ignore */ }
      }

      // Stay signed in until Logout. Visiting /login must NOT wipe the Hub JWT.
      // Already authenticated + normal login URL → go home (not a forced re-login).
      if (hasValidAccessToken() && !exchangeReturn) {
        const parsed = parseJwt(getAccessToken() || '');
        navigate(resolveDefaultHomePath(parsed?.accountType ?? 'INDIVIDUAL'), { replace: true });
        return;
      }
    }
    warmBackend();
    preloadFaceModels();
    collectFingerprint().then((f) => { deviceFpRef.current = f.hash; }).catch(() => {});
  }, [navigate, exchangeReturn]);

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
          <h1 style={{ fontSize: 20, fontWeight: 800, marginTop: 16 }}>Opening…</h1>
          <p className="pa-muted" style={{ fontSize: 14, marginTop: 8 }}>
            Exchange
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
              claimedShortId={claimedShortId}
              onClaimedShortIdChange={setClaimedShortId}
              onNext={() => {
                const claim = (toRootPinitId(claimedShortId) || claimedShortId).trim();
                if (!claim) {
                  setError('Enter your Pinit ID, then verify your face against that account.');
                  return;
                }
                setClaimedShortId(claim);
                go('fingerprint');
              }}
              onRegister={goToRegister}
              exchangeReturn={!!exchangeReturn}
              error={error}
            />
          )}
          {step === 'face' && (
            <>
              <FaceRoundScan
                mode="login"
                title="Face Authentication"
                onEmbedding={(emb) => { faceEmbeddingRef.current = emb; }}
                onPadEvidence={(ev) => { padEvidenceRef.current = ev; }}
                onNext={() => go('presence')}
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
              claimedShortId={claimedShortId}
              exchangeReturn={!!exchangeReturn}
              onDone={(r) => {
                bioCredentialRef.current = r.simulated ? undefined : r.credentialId;
                passkeyPendingRef.current = r.passkeyPendingToken;
                webauthnSessionRef.current = r.webauthnSession;
                go('voice');
              }}
              onError={(m) => setError(m)}
            />
          )}
          {step === 'voice' && (
            <VoiceCaptureStep
              randomPhrase
              optional
              onDone={(fp) => { voiceFingerprintRef.current = fp; go('face'); }}
              onSkip={() => { voiceFingerprintRef.current = null; go('face'); }}
              onError={(m) => setError(m)}
            />
          )}
          {step === 'presence' && (
            <Presence
              error={error}
              exchangeReturn={!!exchangeReturn}
              run={async () => {
                const embedding = faceEmbeddingRef.current;
                const voiceFp = voiceFingerprintRef.current;
                if (!embedding) throw new Error('Face data missing. Scan again.');

                const claim = (toRootPinitId(claimedShortIdRef.current) || claimedShortIdRef.current).trim();
                if (!claim) throw new Error('Enter your Pinit ID, then verify your face against that account.');

                const result = await loginWithFace({
                  embedding,
                  claimedShortId: claim,
                  padEvidence: padEvidenceRef.current ?? undefined,
                  webauthnSession: webauthnSessionRef.current,
                  passkeyPendingToken: passkeyPendingRef.current,
                  voiceFingerprint: voiceFp ?? undefined,
                  webauthnCredentialId: bioCredentialRef.current,
                  deviceFingerprint: (await collectFingerprint().catch(() => ({ hash: '' }))).hash || undefined,
                });
                if (result.user?.id && result.accessToken) {
                  const sub = parseJwt(result.accessToken)?.sub;
                  if (sub && sub !== result.user.id) {
                    throw new Error('Could not verify this face for the claimed account.');
                  }
                }
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
              onRetry={() => {
                // Fresh face+PAD required — retrying with used/expired evidence → replay_detected
                setError('');
                padEvidenceRef.current = null;
                faceEmbeddingRef.current = null;
                go('face');
              }}
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
  claimedShortId,
  onClaimedShortIdChange,
  error,
}: {
  onNext: () => void;
  onRegister: () => void;
  exchangeReturn?: boolean;
  claimedShortId: string;
  onClaimedShortIdChange: (v: string) => void;
  error?: string;
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
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>
        {exchangeReturn ? 'Continue' : 'Welcome Back'}
      </h1>
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
      <label className="pa-muted" style={{ display: 'block', fontSize: 12, textAlign: 'left', marginTop: 16 }}>
        Pinit ID
        <input
          value={claimedShortId}
          onChange={(e) => onClaimedShortIdChange(e.target.value.toUpperCase())}
          placeholder="PINIT-XXXXXX"
          autoComplete="username"
          style={{
            display: 'block', width: '100%', marginTop: 6, padding: '10px 12px',
            borderRadius: 10, border: '1px solid rgba(59,158,255,0.35)',
            background: 'rgba(8,14,28,0.7)', color: '#e8eef8', fontWeight: 700, letterSpacing: 0.4,
          }}
        />
      </label>
      {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 10 }}>{error}</p>}
      <button className="pa-btn" style={{ marginTop: 14 }} onClick={onNext}><ScanFace size={17} /> Verify</button>
      {!exchangeReturn && (
        <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onRegister}>
          Create account
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
      <SystemTrace lines={['Liveness / PAD', '1:1 verify enrolled face', 'Bind this device']} />
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
          ? 'Opening…'
          : exchangeReturn
            ? <>Continue <ArrowRight size={17} /></>
            : <>Enter <ArrowRight size={17} /></>}
      </button>
    </div>
  );
}
