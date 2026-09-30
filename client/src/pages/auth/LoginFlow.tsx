import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ScanFace, UserCheck } from 'lucide-react';

import { AuthShell } from '../../components/auth/AuthShell';
import { FaceRoundScan } from '../../components/auth/FaceRoundScan';
import { useAuth } from '../../context/AuthContext';
import {
  getTrustScore, recordLogin, clearRegistration,
  saveRegistration, generateHoid, getStoredShortId,
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
import { getSignInStartMethod, resolveSignInEntryStep, loginNeedsPasskeyFactor } from '../../lib/signin-preference';
import { assertDeviceCredential } from '../../lib/webauthn';

type Step = 'welcome' | 'claim' | 'face' | 'device' | 'entering';

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
  if (/pinit id|unknown_claim|no_claim/.test(m)) {
    return 'Look at the camera to sign in, or enter your Pinit ID if you have it.';
  }
  if (/enter your pinit id/.test(m)) {
    return 'Look at the camera to sign in, or enter your Pinit ID if you have it.';
  }
  if (/timed out|taking too long/.test(m)) {
    return 'Authentication timed out. The server is taking too long to respond. Please try again.';
  }
  return "Couldn't verify you. Please try again.";
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
  const bioCredentialRef = useRef<string | undefined>(undefined);
  const webauthnSessionRef = useRef<string | undefined>(undefined);
  const passkeyPendingRef = useRef<string | undefined>(undefined);
  const deviceFpRef = useRef<string>('');
  const claimedShortIdRef = useRef('');
  claimedShortIdRef.current = claimedShortId;
  const passkeyAfterFaceRef = useRef(false);

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

  function rememberedIdentity(): string {
    let stashed = '';
    try { stashed = sessionStorage.getItem(CLAIM_PREFILL_KEY) || ''; } catch { /* ignore */ }
    const stored = getStoredShortId() || '';
    const jwtShort = parseJwt(getAccessToken() || '')?.shortId || '';
    const fromState = (toRootPinitId(claimedShortId) || claimedShortId).trim();
    return (
      fromState
      || (toRootPinitId(stashed) || stashed).trim()
      || (toRootPinitId(stored) || stored).trim()
      || (toRootPinitId(jwtShort) || jwtShort).trim()
    );
  }

  function startSignIn() {
    passkeyAfterFaceRef.current = false;
    webauthnSessionRef.current = undefined;
    passkeyPendingRef.current = undefined;
    bioCredentialRef.current = undefined;
    claimedShortIdRef.current = '';
    setClaimedShortId('');
    setScanAttempts(0);
    setError('');
    go(resolveSignInEntryStep(getSignInStartMethod(), ''));
  }

  function clearClaimedIdentity() {
    clearRegistration();
    try { sessionStorage.removeItem(CLAIM_PREFILL_KEY); } catch { /* ignore */ }
    try { localStorage.removeItem('pinit_claimed_short_id'); } catch { /* ignore */ }
    setClaimedShortId('');
    claimedShortIdRef.current = '';
    setScanAttempts(0);
    setError('');
    go('claim');
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

    if (typedClaim) {
      return loginWithFace({
        embedding,
        claimedShortId: typedClaim,
        padEvidence,
        lightingTelemetry,
        webauthnSession: webauthnSessionRef.current,
        passkeyPendingToken: passkeyPendingRef.current,
        webauthnCredentialId: bioCredentialRef.current,
        deviceFingerprint,
      });
    }

    try {
      return await identifyWithFace({ embedding, padEvidence, deviceFingerprint });
    } catch (identifyErr) {
      const stored = (toRootPinitId(getStoredShortId()) || getStoredShortId() || '').trim();
      if (!stored) throw identifyErr;
      return loginWithFace({
        embedding,
        claimedShortId: stored,
        padEvidence,
        lightingTelemetry,
        webauthnSession: webauthnSessionRef.current,
        passkeyPendingToken: passkeyPendingRef.current,
        webauthnCredentialId: bioCredentialRef.current,
        deviceFingerprint,
      });
    }
  }

  async function confirmDevicePasskey() {
    const r = await assertDeviceCredential(claimedShortIdRef.current.trim() || undefined);
    if (r.simulated) return;
    bioCredentialRef.current = r.credentialId;
    passkeyPendingRef.current = r.passkeyPendingToken;
    webauthnSessionRef.current = r.webauthnSession;
    if (r.shortId) {
      const bound = (toRootPinitId(r.shortId) || r.shortId).trim();
      const claimed = (toRootPinitId(claimedShortIdRef.current) || claimedShortIdRef.current).trim();
      if (claimed && bound && claimed !== bound) {
        throw new Error("That didn't match. Try again.");
      }
      setClaimedShortId(r.shortId);
      try { sessionStorage.setItem(CLAIM_PREFILL_KEY, r.shortId); } catch { /* ignore */ }
    }
  }

  async function finishLogin() {
    try {
      await applyLoginResult(await submitFaceLogin());
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!loginNeedsPasskeyFactor(msg) || passkeyAfterFaceRef.current) throw e;
      passkeyAfterFaceRef.current = true;
      setStep('device');
      await confirmDevicePasskey();
      await applyLoginResult(await submitFaceLogin());
    }
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

          {step === 'claim' && (
            <ClaimPinitId
              claimedShortId={claimedShortId}
              onClaimedShortIdChange={setClaimedShortId}
              onBack={() => go('welcome')}
              onSkipToFace={() => {
                setError('');
                setScanAttempts(0);
                go('face');
              }}
              onNext={() => {
                const claim = (toRootPinitId(claimedShortId) || claimedShortId).trim();
                if (!claim) {
                  setError('');
                  go('face');
                  return;
                }
                setClaimedShortId(claim);
                claimedShortIdRef.current = claim;
                try { sessionStorage.setItem(CLAIM_PREFILL_KEY, claim); } catch { /* ignore */ }
                go('face');
              }}
              error={error}
            />
          )}

          {step === 'face' && (
            <FaceRoundScan
              key={`face-login-${scanAttempts}`}
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
                    passkeyAfterFaceRef.current = false;
                    const nextAttemptCount = scanAttempts + 1;
                    setScanAttempts(nextAttemptCount);
                    const raw = e instanceof Error ? e.message : '';
                    if (/enter your pinit id/i.test(raw)) {
                      setError(userFacingLoginError(raw));
                      return;
                    }
                    setError(userFacingLoginError(raw));
                  });
              }}
              onError={(m) => setError(userFacingLoginError(m))}
              onScanStart={() => setError('')}
            />
          )}

          {(step === 'device' || step === 'entering') && (
            <QuietCameraWait
              message={step === 'device' ? 'Confirm this device' : finishHint}
            />
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

function ClaimPinitId({
  claimedShortId,
  onClaimedShortIdChange,
  onNext,
  onBack,
  onSkipToFace,
  error,
}: {
  claimedShortId: string;
  onClaimedShortIdChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSkipToFace: () => void;
  error?: string;
}) {
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, margin: '4px auto 14px', borderRadius: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(circle at 50% 30%, rgba(59,158,255,0.28), rgba(29,111,216,0.06))',
        border: '1px solid rgba(59,158,255,0.28)',
      }}>
        <UserCheck size={26} color="#3b9eff" />
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Your Pinit ID</h1>
      <p className="pa-muted" style={{ fontSize: 13, marginTop: 8 }}>
        Optional. If you do not know it, sign in with Face Scan instead.
      </p>
      <label className="pa-muted" style={{ display: 'block', fontSize: 12, textAlign: 'left', marginTop: 16 }}>
        Pinit ID
        <input
          value={claimedShortId}
          onChange={(e) => onClaimedShortIdChange(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') onNext(); }}
          placeholder="PINIT-XXXXXX"
          autoComplete="username"
          autoFocus
          style={{
            display: 'block', width: '100%', marginTop: 6, padding: '10px 12px',
            borderRadius: 10, border: '1px solid rgba(59,158,255,0.35)',
            background: 'rgba(8,14,28,0.7)', color: '#e8eef8', fontWeight: 700, letterSpacing: 0.4,
          }}
        />
      </label>
      {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 10 }}>{error}</p>}
      <button className="pa-btn" style={{ marginTop: 14 }} onClick={onNext}>
        Continue
      </button>
      <button type="button" className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={onSkipToFace}>
        I don't know my Pinit ID — Face Scan
      </button>
      <button type="button" className="pa-link" onClick={onBack} style={{ display: 'block', margin: '14px auto 0', fontSize: 13 }}>
        Back
      </button>
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
