import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ShieldCheck, Camera, Mic, Fingerprint, Sparkles,
  ArrowRight, CheckCircle2, Building2, User, Copy, Check,
} from 'lucide-react';

import { AuthShell } from '../../components/auth/AuthShell';
import { FaceRoundScan } from '../../components/auth/FaceRoundScan';
import { BiometricStep } from '../../components/auth/BiometricStep';
import { isDuplicateIdentityError } from '../../components/auth/BiometricStep';
import { VoiceCaptureStep } from '../../components/auth/VoiceCaptureStep';
import { StepHead, Checklist, SystemTrace, TrustBadge, type CheckItem } from '../../components/auth/parts';
import { useAuth } from '../../context/AuthContext';
import { collectFingerprint } from '../../lib/device-fingerprint';
import { generateHoid, saveRegistration, clearRegistration } from '../../lib/hoid';
import { warmBackend, parseJwt } from '../../lib/auth';
import { beginFaceEnrollment, registerFaceIdentity, type FacePadEvidence } from '../../lib/face-api-client';
import { type BiometricResult } from '../../lib/webauthn';
import { preloadFaceModels } from '../../lib/face-capture';
import {
  clearBusinessSetup,
  markAccountTypeOnboardingComplete,
  setChosenAccountType,
} from '../../lib/account-onboarding';
import { resolvePostAccountTypePath } from '../../lib/onboarding-routes';
import {
  clearPreRegisterAccountType,
  getPreRegisterAccountType,
} from '../../lib/pre-register';

type Step = 'welcome' | 'permissions' | 'face' | 'device' | 'voice' | 'creating' | 'success';
/** Reserve a Pinit ID, then three live face samples, then an optional device factor. */
const ORDER: Step[] = ['welcome', 'permissions', 'face', 'device', 'voice', 'creating', 'success'];

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.22 },
};

export function RegistrationFlow() {
  const navigate = useNavigate();
  const { loginWithFaceResponse, user } = useAuth();

  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState('');
  /** The minted Pinit ID, surfaced on the success screen so it can be saved. */
  const [newShortId, setNewShortId] = useState('');
  const [reservedId, setReservedId] = useState('');
  const [faceCaptured, setFaceCaptured] = useState(false);
  const deviceFpRef = useRef<string>('');
  const hoidRef = useRef<string>('');
  const faceEmbeddingRef = useRef<number[] | null>(null);
  const padEvidenceRef = useRef<FacePadEvidence | null>(null);
  const samplesRef = useRef<Array<{ embedding: number[]; padEvidence: FacePadEvidence }>>([]);
  const enrollmentTokenRef = useRef('');
  const bioRef = useRef<BiometricResult | null>(null);
  const voiceFingerprintRef = useRef<number[] | null>(null);
  const accountTypeRef = useRef<'INDIVIDUAL' | 'BUSINESS'>(
    getPreRegisterAccountType() ?? 'INDIVIDUAL',
  );

  const go = (s: Step) => { setError(''); setStep(s); };
  const idx = ORDER.indexOf(step);

  const sessionResetRef = useRef(false);
  useEffect(() => {
    if (!sessionResetRef.current) {
      sessionResetRef.current = true;
      clearRegistration();
    }
    const chosen = getPreRegisterAccountType();
    if (!chosen) {
      navigate('/register/account-type', { replace: true });
      return;
    }
    accountTypeRef.current = chosen;
  }, [navigate]);

  useEffect(() => {
    if (step !== 'face' || enrollmentTokenRef.current) return;
    let cancelled = false;
    void beginFaceEnrollment()
      .then((claim) => {
        if (cancelled) return;
        enrollmentTokenRef.current = claim.enrollmentToken;
        setReservedId(claim.shortId);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not reserve a Pinit ID.');
      });
    return () => { cancelled = true; };
  }, [step]);

  function afterFace() {
    if (samplesRef.current.length < 3) {
      setError('Three clear face samples are required.');
      return;
    }
    setFaceCaptured(true);
    if (!enrollmentTokenRef.current) {
      setError('Reserving your Pinit ID…');
      return;
    }
    go('device');
  }

  useEffect(() => {
    if (step !== 'face' || !faceCaptured || !enrollmentTokenRef.current) return;
    go('device');
  }, [step, faceCaptured, reservedId]);

  function afterVoice(fp: number[] | null) {
    voiceFingerprintRef.current = fp;
    hoidRef.current = generateHoid(deviceFpRef.current);
    go('creating');
  }

  return (
    <AuthShell steps={ORDER.length} current={idx} tagline="Create Biometric Identity">
      <AnimatePresence mode="wait">
        <motion.div key={step} {...fade}>
          {step === 'welcome'     && (
            <Welcome
              accountType={accountTypeRef.current}
              onNext={() => go('permissions')}
            />
          )}
          {step === 'permissions' && <Permissions deviceFpRef={deviceFpRef} onNext={() => go('face')} />}
          {step === 'face'        && (
            <>
              {reservedId && (
                <p className="pa-muted" style={{ textAlign: 'center', fontSize: 13, marginBottom: 8 }}>
                  Pinit ID {reservedId} is reserved. It stays empty until these face samples pass.
                </p>
              )}
              <FaceRoundScan
                mode="register"
                samplesRequired={3}
                identityError={error}
                onEmbedding={(emb) => { faceEmbeddingRef.current = emb; }}
                onPadEvidence={(ev) => { padEvidenceRef.current = ev; }}
                onSample={(sample) => { samplesRef.current = [...samplesRef.current, sample]; }}
                onNext={afterFace}
                onError={(m) => setError(m)}
              />
              {!reservedId && error && (
                <button
                  type="button"
                  className="pa-btn pa-btn-ghost"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    enrollmentTokenRef.current = '';
                    setError('');
                    void beginFaceEnrollment()
                      .then((claim) => {
                        enrollmentTokenRef.current = claim.enrollmentToken;
                        setReservedId(claim.shortId);
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : 'Could not reserve a Pinit ID.'));
                  }}
                >
                  Reserve Pinit ID again
                </button>
              )}
            </>
          )}
          {step === 'device' && (
            <div>
              <BiometricStep
                mode="register"
                hold
                enrollmentLabel={reservedId || 'register'}
                onDone={(result) => {
                  bioRef.current = result;
                  go('voice');
                }}
                onError={(m) => setError(m)}
              />
              <button type="button" className="pa-btn pa-btn-ghost" style={{ marginTop: 10 }} onClick={() => { bioRef.current = null; go('voice'); }}>
                Skip fingerprint — continue with face
              </button>
              {error && <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>{error}</p>}
            </div>
          )}
          {step === 'voice'       && (
            <VoiceCaptureStep
              randomPhrase
              optional
              onDone={afterVoice}
              onSkip={() => afterVoice(null)}
              onError={(m) => setError(m)}
            />
          )}
          {step === 'creating'    && (
            <Creating
              error={error}
              run={async () => {
                const embedding = faceEmbeddingRef.current;
                const voiceFp = voiceFingerprintRef.current;
                if (!embedding || samplesRef.current.length < 3 || !enrollmentTokenRef.current) {
                  throw new Error('Three live face samples and a reserved Pinit ID are required.');
                }

                const result = await registerFaceIdentity({
                  embedding,
                  samples: samplesRef.current,
                  enrollmentToken: enrollmentTokenRef.current || undefined,
                  padEvidence: padEvidenceRef.current ?? undefined,
                  passkeyPendingToken: bioRef.current?.passkeyPendingToken,
                  webauthnCredentialId: bioRef.current?.credentialId || undefined,
                  voiceFingerprint: voiceFp ?? undefined,
                  deviceFingerprint: deviceFpRef.current || undefined,
                  accountType: accountTypeRef.current,
                });

                loginWithFaceResponse(result);
                if (result.accessToken) {
                  const authUser = parseJwt(result.accessToken);
                  if (authUser?.sub) {
                    markAccountTypeOnboardingComplete(authUser.sub);
                    setChosenAccountType(authUser.sub, accountTypeRef.current);
                    if (accountTypeRef.current === 'BUSINESS') {
                      clearBusinessSetup(authUser.sub);
                    }
                  }
                }
                const shortId = result.user?.shortId ?? '';
                setNewShortId(shortId);
                const hoid = hoidRef.current || generateHoid(deviceFpRef.current);
                saveRegistration({
                  hoid,
                  shortId,
                  trustScore: 99.8,
                  deviceFp: deviceFpRef.current,
                });
              }}
              onDone={() => go('success')}
              onError={(m) => setError(m)}
              onDuplicate={() => navigate('/login', { replace: true })}
            />
          )}
          {step === 'success'     && (
            <Success
              shortId={newShortId}
              onEnter={() => {
                const uid = user?.sub;
                if (uid) {
                  markAccountTypeOnboardingComplete(uid);
                  setChosenAccountType(uid, accountTypeRef.current);
                  if (accountTypeRef.current === 'BUSINESS') {
                    clearBusinessSetup(uid);
                  }
                }
                navigate(resolvePostAccountTypePath(accountTypeRef.current), { replace: true });
                clearPreRegisterAccountType();
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

function Welcome({
  accountType,
  onNext,
}: {
  accountType: 'INDIVIDUAL' | 'BUSINESS';
  onNext: () => void;
}) {
  const isBusiness = accountType === 'BUSINESS';
  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <StepHead
        icon={isBusiness ? <Building2 size={26} color="#a855f7" /> : <User size={26} color="#3b9eff" />}
        title="Create your Pinit HUB identity"
        subtitle={
          isBusiness
            ? 'Business mode · Free plan. Your face identifies you.'
            : 'Individual mode · Free plan. Your face identifies you.'
        }
      />
      <div className="pa-bio-steps">
        <div className="pa-bio-step">
          <Camera size={18} color="#3b9eff" style={{ margin: '0 auto' }} />
          <span>Face</span>
          <em>3 samples</em>
        </div>
        <div className="pa-bio-step">
          <Fingerprint size={18} color="#3b9eff" style={{ margin: '0 auto' }} />
          <span>Fingerprint</span>
          <em>Optional</em>
        </div>
        <div className="pa-bio-step">
          <Mic size={18} color="#3b9eff" style={{ margin: '0 auto' }} />
          <span>Voice</span>
          <em>Optional</em>
        </div>
      </div>
      <button className="pa-btn" onClick={onNext}>Start biometric setup <ArrowRight size={17} /></button>
      <Link
        to="/register/account-type"
        className="pa-btn pa-btn-ghost"
        style={{ marginTop: 10, display: 'inline-flex' }}
      >
        Change account type
      </Link>
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
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      setErr('Camera access is required for face enrollment.');
      setBusy(false);
      return;
    }
    try {
      const a = await navigator.mediaDevices.getUserMedia({ audio: true });
      a.getTracks().forEach((t) => t.stop());
    } catch {
      // Voice is optional — continue without mic.
    }
    try { deviceFpRef.current = (await collectFingerprint()).hash; } catch { /* noop */ }
    setBusy(false);
    onNext();
  }

  return (
    <div className="pa-card">
      <StepHead icon={<ShieldCheck size={26} color="#3b9eff" />} title="Permissions" subtitle="Camera is required. Microphone is optional." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20 }}>
        {[
          { icon: <Camera size={18} />, label: 'Camera', sub: 'Round face scan' },
          { icon: <Mic size={18} />, label: 'Microphone', sub: 'Optional voice check' },
        ].map((p) => (
          <div key={p.label} className="pa-check">
            <span style={{ color: '#3b9eff', display: 'flex' }}>{p.icon}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#f4f8ff' }}>{p.label}</div>
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
    { label: 'Device Bound', done: false },
    { label: 'Voice (optional)', done: false },
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
        // Show existing PINIT ID briefly, then send them to face login
        if (isDuplicateIdentityError(msg)) setTimeout(onDuplicate, 3200);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries]);

  return (
    <div className="pa-card">
      <StepHead icon={<Sparkles size={26} color="#3b9eff" />} title="Saving to Database" subtitle="Checking you are not already registered…" />
      <Checklist items={items} />
      <SystemTrace lines={['Reserve the Pinit ID', 'Check three live samples', 'Create the account']} />
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

/**
 * Registration success — the one moment the new Pinit ID is shown.
 *
 * This used to auto-advance after 1.6s without ever displaying the ID, so a
 * new user never saw their own identity. It no longer moves on by itself:
 * signing in normally is done by face, but the ID is the recovery path and is
 * worth a deliberate moment to copy.
 */
function Success({ shortId, onEnter }: { shortId?: string; onEnter: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!shortId) return;
    try {
      await navigator.clipboard.writeText(shortId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the ID is on screen to copy by hand */
    }
  };

  return (
    <div className="pa-card" style={{ textAlign: 'center' }}>
      <div className="pa-pop" style={{ width: 76, height: 76, margin: '4px auto 16px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 34px rgba(16,185,129,0.65)' }}>
        <CheckCircle2 size={42} color="#fff" />
      </div>
      <h1 style={{ fontSize: 23, fontWeight: 800 }}>Welcome to Pinit HUB</h1>

      {shortId && (
        <>
          <p className="pa-muted" style={{ fontSize: 13, marginTop: 10 }}>
            Your Pinit ID
          </p>
          <div style={{
            margin: '8px auto 0', padding: '12px 14px', maxWidth: 320,
            borderRadius: 12, border: '1px solid rgba(59,158,255,0.35)',
            background: 'rgba(8,14,28,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            <code style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.8, color: '#e8eef8' }}>
              {shortId}
            </code>
            <button
              type="button"
              onClick={copy}
              title="Copy Pinit ID"
              aria-label="Copy Pinit ID"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: copied ? '#34d399' : '#3b9eff', fontSize: 12, fontWeight: 700,
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="pa-muted" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.5, maxWidth: 330, margin: '10px auto 0' }}>
            You won&apos;t need this to sign in — just scan your face. Keep it
            somewhere safe as a backup way into your account.
          </p>
        </>
      )}

      <div style={{ margin: '18px 0' }}><TrustBadge score={99.8} /></div>
      <button className="pa-btn" onClick={onEnter}>Enter Pinit HUB <ArrowRight size={17} /></button>
    </div>
  );
}
