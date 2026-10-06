import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ScanFace } from 'lucide-react';

import { AuthShell } from '../../components/auth/AuthShell';
import { FaceRoundScan } from '../../components/auth/FaceRoundScan';
import { useAuth } from '../../context/AuthContext';
import {
  getTrustScore, recordLogin, clearRegistration,
  saveRegistration, generateHoid, getStoredShortId, getLastAccount, rememberLastAccount,
} from '../../lib/hoid';
import { warmBackend, parseJwt, getAccessToken, hasValidAccessToken } from '../../lib/auth';
import { maySkipBiometricsForExchangeReturn } from '../../lib/exchange-return-session';
import { toRootPinitId } from '../../lib/pinit-identity';
import { resolveLoginHomePath, BUSINESS_DASHBOARD_PATH } from '../../lib/subscription/post-upgrade-redirect';
import { applyLoginWorkspaceDefault } from '../../lib/account-view-mode';
import { takePendingTeamInvite } from '../../lib/team-invite';
import { identifyWithFace, loginWithFace, type FacePadEvidence } from '../../lib/face-api-client';
import { collectFingerprint } from '../../lib/device-fingerprint';
import { ensureFaceModels } from '../../lib/face-capture';
import { createExchangeSso } from '../../services/dashboard.api';
import {
  resolveExchangeReturn,
  stashExchangeReturn,
  takeStashedExchangeReturn,
} from '../../lib/exchange-return';

type Step = 'welcome' | 'face' | 'entering';

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.22 },
};

const CLAIM_PREFILL_KEY = 'pinit_login_claim_prefill';

function userFacingLoginError(msg: string): string {
  const m = msg.toLowerCase();
  if (/camera/.test(m) && /required|unavailable|permission|access/.test(m)) {
    return 'Camera access is required to sign in with Face Scan.';
  }
  if (/not recognized/.test(m)) {
    return 'Face not recognized. Look at the camera again, or sign up if this is a new account.';
  }
  if (/capture_aborted|aborterror/.test(m)) {
    return 'Look at the camera and hold still for a second.';
  }
  if (/pinit id|unknown_claim|no_claim|enter your pinit id/.test(m)) {
    return 'Look at the camera to sign in.';
  }
  if (/follow the on-screen prompts|follow the motion|follow the live motion/.test(m)) {
    return 'Look at the camera.';
  }
  if (/timed out|taking too long/.test(m)) {
    return 'Authentication timed out. The server is taking too long to respond. Please try again.';
  }
  const clean = msg.trim();
  return clean || "Couldn't verify you. Please try again.";
}

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
  const [scanAttempts, setScanAttempts] = useState(0);
  const [finishHint, setFinishHint] = useState('Identity verified');
  const faceEmbeddingRef = useRef<number[] | null>(null);
  const padEvidenceRef = useRef<FacePadEvidence | null>(null);
  const lightingRef = useRef<{ status: string; average: number } | null>(null);
  const deviceFpRef = useRef<string>('');
  const claimedShortIdRef = useRef('');
  claimedShortIdRef.current = claimedShortId;

  const go = (s: Step) => { setError(''); setStep(s); };

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

      if (hasValidAccessToken()) {
        const skip = maySkipBiometricsForExchangeReturn({
          hasAccessToken: true,
          authContextUserPresent: true,
        });
        if (exchangeReturn && skip.allow) {
          setOpeningExchange(true);
          const er = exchangeReturn;
          void (async () => {
            try {
              const sso = await createExchangeSso();
              if (!sso?.token) throw new Error('Could not return to Exchange.');
              const target = new URL(er);
              target.searchParams.set('hub_sso', sso.token);
              window.location.replace(target.toString());
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not return to Exchange.');
              setOpeningExchange(false);
            }
          })();
          return;
        }
        if (!exchangeReturn) {
          navigate(resolveLoginHomePath(), { replace: true });
          return;
        }
      }
    }
    warmBackend();
    void ensureFaceModels();
    collectFingerprint().then((f) => { deviceFpRef.current = f.hash; }).catch(() => {});
  }, [navigate, exchangeReturn]);

  function goToRegister() {
    const er = exchangeReturn || takeStashedExchangeReturn();
    if (er) {
      setError('Continue with Hub to use your existing account.');
      return;
    }
    clearRegistration();
    navigate('/register/account-type', { replace: true });
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
        if (!sso?.token) throw new Error('Could not return to Exchange.');
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
    if (parsed?.sub) {
      const mode = applyLoginWorkspaceDefault(
        parsed.sub,
        {
          hasPersonalWorkspace: true,
          hasBusinessWorkspace:
            parsed.accountType === 'BUSINESS' || parsed.capabilities?.business === true,
        },
        parsed.lastActiveShell,
      );
      navigate(mode === 'BUSINESS' ? BUSINESS_DASHBOARD_PATH : resolveLoginHomePath(), { replace: true });
      return;
    }
    navigate(resolveLoginHomePath(), { replace: true });
  }

  function startSignIn() {
    claimedShortIdRef.current = '';
    setClaimedShortId('');
    setScanAttempts(0);
    setError('');
    go('face');
  }

  function clearClaimedIdentity() {
    clearRegistration();
    try { sessionStorage.removeItem(CLAIM_PREFILL_KEY); } catch { /* ignore */ }
    try { localStorage.removeItem('pinit_claimed_short_id'); } catch { /* ignore */ }
    setClaimedShortId('');
    claimedShortIdRef.current = '';
    setScanAttempts(0);
    setError('');
    go('face');
  }

  async function applyLoginResult(result: Awaited<ReturnType<typeof loginWithFace>>) {
    if (result.user?.id && result.accessToken) {
      const sub = parseJwt(result.accessToken)?.sub;
      if (sub && sub !== result.user.id) {
        throw new Error("That didn't match. Try again.");
      }
    }
    const claim = (toRootPinitId(claimedShortIdRef.current) || claimedShortIdRef.current).trim();
    const returnedId = (toRootPinitId(result.user?.shortId || '') || result.user?.shortId || '').trim();
    const claimedId = (toRootPinitId(claim) || claim).trim();
    if (returnedId && claimedId && returnedId !== claimedId) {
      throw new Error("That didn't match. Try again.");
    }
    loginWithFaceResponse(result);
    const shortId = result.user?.shortId ?? '';
    if (shortId) {
      rememberLastAccount(shortId);
      let deviceFp = '';
      try { deviceFp = (await collectFingerprint()).hash; } catch { /* noop */ }
      saveRegistration({
        hoid: generateHoid(deviceFp),
        shortId,
        trustScore: getTrustScore(),
        deviceFp,
      });
      recordLogin();
    }
  }

  async function submitFaceLogin() {
    const embedding = faceEmbeddingRef.current;
    if (!embedding) throw new Error('Look at the camera and try again.');
    const typedClaim = (toRootPinitId(claimedShortIdRef.current) || claimedShortIdRef.current).trim();
    const deviceFingerprint = (await collectFingerprint().catch(() => ({ hash: '' }))).hash || undefined;
    const padEvidence = padEvidenceRef.current ?? undefined;
    const lightingTelemetry = lightingRef.current
      ? {
          lightingStatus: lightingRef.current.status,
          ambientBrightness: Math.round(lightingRef.current.average),
        }
      : undefined;

    const stored = (toRootPinitId(getStoredShortId()) || getStoredShortId() || '').trim();
    const lastAccount = (toRootPinitId(getLastAccount()) || getLastAccount() || '').trim();
    const claim = typedClaim || stored || lastAccount;
    if (claim) {
      return loginWithFace({
        embedding,
        claimedShortId: claim,
        padEvidence,
        lightingTelemetry,
        deviceFingerprint,
      });
    }
    return identifyWithFace({ embedding, padEvidence, deviceFingerprint });
  }

  async function finishLogin() {
    await applyLoginResult(await submitFaceLogin());
  }

  if (openingExchange && exchangeReturn) {
    return (
      <AuthShell steps={0} current={0} tagline="Sign in">
        <div className="pa-card" style={{ textAlign: 'center' }}>
          <div
            className="pa-spin"
            style={{
              width: 32, height: 32, margin: '12px auto',
              border: '3px solid rgba(120,160,220,0.2)', borderTopColor: '#3b9eff', borderRadius: '50%',
            }}
          />
          <p className="pa-muted" style={{ fontSize: 14, marginTop: 16 }}>Opening…</p>
          {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell steps={0} current={0} tagline="Sign in">
      <AnimatePresence mode="wait">
        <motion.div key={step} {...fade}>
          {step === 'welcome' && (
            <WelcomeHome
              exchangeReturn={!!exchangeReturn}
              error={error}
              onSignIn={startSignIn}
              onSignUp={goToRegister}
            />
          )}

          {step === 'face' && (
            <FaceRoundScan
              mode="login"
              title="Sign In"
              claimedShortId={claimedShortId}
              scanAttempts={scanAttempts}
              identityError={error}
              onClearIdentity={clearClaimedIdentity}
              onEmbedding={(emb) => { faceEmbeddingRef.current = emb; }}
              onPadEvidence={(ev) => { padEvidenceRef.current = ev; }}
              onLightingSample={(status, average) => {
                lightingRef.current = { status, average };
              }}
              onNext={() => {
                void finishLogin()
                  .then(async () => {
                    setScanAttempts(0);
                    setFinishHint('Identity verified');
                    setStep('entering');
                    setFinishHint('Entering Pinit HUB...');
                    await enterAfterLogin();
                  })
                  .catch((e) => {
                    padEvidenceRef.current = null;
                    faceEmbeddingRef.current = null;
                    const nextAttemptCount = scanAttempts + 1;
                    setScanAttempts(nextAttemptCount);
                    const raw = e instanceof Error ? e.message : '';
                    const msg = userFacingLoginError(raw);
                    setError(nextAttemptCount >= 3 ? `${msg} Tap Start Face Scan when you are ready.` : msg);
                  });
              }}
              onError={(m) => {
                const next = scanAttempts + 1;
                setScanAttempts(next);
                const msg = userFacingLoginError(m);
                setError(next >= 3 ? `${msg} Tap Start Face Scan when you are ready.` : msg);
              }}
              onScanStart={() => setError('')}
            />
          )}

          {step === 'entering' && (
            <QuietCameraWait message={finishHint} />
          )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

function WelcomeHome({
  onSignIn,
  onSignUp,
  exchangeReturn,
  error,
}: {
  onSignIn: () => void;
  onSignUp: () => void;
  exchangeReturn?: boolean;
  error?: string;
}) {
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>
        {exchangeReturn ? 'Continue' : 'Pinit HUB'}
      </h1>
      <p className="pa-muted" style={{ fontSize: 14, marginTop: 8 }}>
        {exchangeReturn ? 'Return to Exchange with your Hub account.' : 'Sign in with Face Scan.'}
      </p>
      {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 12 }}>{error}</p>}
      <button className="pa-btn" style={{ marginTop: 22 }} onClick={onSignIn}>
        Sign In
      </button>
      {!exchangeReturn && (
        <button className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onSignUp}>
          Sign Up
        </button>
      )}
    </div>
  );
}

function QuietCameraWait({ message }: { message: string }) {
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Sign In</h1>
      <p className="pa-muted" style={{ fontSize: 13, marginTop: 8 }}>{message}</p>
      <div className="pa-cam-focus" style={{ marginTop: 18 }}>
        <div className="pa-cam lock">
          <div className="pa-cam-lock" aria-hidden>
            <span className="pa-cam-lock-pulse" />
            <ScanFace size={36} color="#9ec4ff" strokeWidth={1.6} />
          </div>
        </div>
      </div>
    </div>
  );
}
