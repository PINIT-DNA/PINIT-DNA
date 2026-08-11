import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  ShieldCheck,
  ShoppingBag,
  Camera,
  Lock,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Building2,
  User,
} from 'lucide-react';

const HUB_APP_URL = (import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const SESSION_KEY = 'pinit_exchange_session';

/**
 * Phase 1 auth — Buyer/Seller first.
 * Buyers: Exchange email only (never Hub).
 * Sellers: Pinit HUB identity required (Individual/Business on Hub).
 */
export default function AuthModal({
  isOpen,
  onClose,
  onAuthenticated,
  initialMode = 'welcome',
  initialIntent = null,
}) {
  const [mode, setMode] = useState(initialMode);
  const [intent, setIntent] = useState(initialIntent);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode || 'welcome');
    setIntent(initialIntent);
    setError('');
    setSuccess('');
    setAcceptTerms(false);
  }, [isOpen, initialMode, initialIntent]);

  const exchangeReturnUrl = useMemo(
    () => `${window.location.origin}/?hub_return=1`,
    [],
  );

  const title = useMemo(() => {
    if (mode === 'login') return 'Sign in';
    if (mode === 'signup' && intent === 'buyer') return 'Create buyer account';
    if (mode === 'signup' && intent === 'creator') return 'Sell on Exchange';
    return 'Choose your account type';
  }, [mode, intent]);

  const subtitle = useMemo(() => {
    if (mode === 'login') return 'Sellers use Pinit HUB. Buyers sign in with email.';
    if (mode === 'signup' && intent === 'buyer') {
      return 'Browse, buy, and manage licenses — Hub access is not required.';
    }
    if (mode === 'signup' && intent === 'creator') {
      return 'Sellers need a verified Pinit HUB identity (Individual or Business).';
    }
    return 'Pinit Exchange is the marketplace. Pinit HUB is identity & protection for sellers.';
  }, [mode, intent]);

  if (!isOpen) return null;

  const persistSession = (user) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      pinit_id: user.pinit_id,
      exchange_id: user.exchange_id,
      role: user.role,
      at: Date.now(),
    }));
    onAuthenticated?.(user);
  };

  const openHubContinue = () => {
    window.open(
      `${HUB_APP_URL}/login?exchange_return=${encodeURIComponent(exchangeReturnUrl)}`,
      '_blank',
      'noopener,noreferrer',
    );
    setSuccess('Pinit HUB opened. After you sign in, you return to Exchange as a Hub-linked seller.');
  };

  const openHubRegister = (accountHint = null) => {
    const base = `${HUB_APP_URL}/register/account-type?exchange_return=${encodeURIComponent(exchangeReturnUrl)}`;
    const url = accountHint ? `${base}&hint=${accountHint}` : base;
    window.open(url, '_blank', 'noopener,noreferrer');
    setSuccess(
      accountHint === 'BUSINESS'
        ? 'Create a Business Pinit HUB account, then you’ll return to Exchange as a seller.'
        : accountHint === 'INDIVIDUAL'
          ? 'Create an Individual Pinit HUB account, then you’ll return to Exchange as a seller.'
          : 'Choose Individual or Business on Pinit HUB. After registration you’ll return here as a seller.',
    );
  };

  const startIntent = (nextIntent) => {
    setIntent(nextIntent);
    setMode('signup');
    setError('');
    setSuccess('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      persistSession(data.user);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBuyerSignup = async (e) => {
    e.preventDefault();
    setError('');
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      setError('Enter your name, email, and password.');
      return;
    }
    if (!acceptTerms) {
      setError('Accept the buyer terms to continue.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'buyer',
          full_name: fullName.trim(),
          display_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          password,
          org_name: orgName.trim(),
          accept_terms: acceptTerms,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Signup failed');
      persistSession(data.user);
      setSuccess('Buyer account ready. You can browse and purchase licenses.');
      setTimeout(() => onClose?.(), 900);
    } catch (err) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const eyebrow =
    intent === 'buyer' || (mode === 'login' && intent !== 'creator')
      ? 'Buyer access'
      : intent === 'creator'
        ? 'Seller · Pinit HUB identity'
        : 'Pinit Exchange';

  return (
    <div className="modal-overlay auth-overlay" onClick={onClose} role="presentation">
      <div
        className="auth-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <div className="auth-modal__header">
          <div className="auth-modal__header-text">
            <div className="auth-modal__eyebrow">
              <ShieldCheck size={15} aria-hidden />
              <span>{eyebrow}</span>
            </div>
            <h2 id="auth-modal-title" className="auth-modal__title">{title}</h2>
            <p className="auth-modal__subtitle">{subtitle}</p>
          </div>
          <button type="button" className="auth-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {mode === 'welcome' && (
          <div className="auth-path-grid">
            <button type="button" className="auth-path-card" onClick={() => startIntent('creator')}>
              <span className="auth-path-card__icon auth-path-card__icon--sell" aria-hidden>
                <Camera size={20} />
              </span>
              <span className="auth-path-card__body">
                <strong>Seller</strong>
                <span>Requires a Pinit HUB account — Individual or Business.</span>
              </span>
              <ArrowRight size={16} className="auth-path-card__arrow" aria-hidden />
            </button>

            <button type="button" className="auth-path-card" onClick={() => startIntent('buyer')}>
              <span className="auth-path-card__icon auth-path-card__icon--buy" aria-hidden>
                <ShoppingBag size={20} />
              </span>
              <span className="auth-path-card__body">
                <strong>Buyer</strong>
                <span>Browse and purchase licenses — no Hub account needed.</span>
              </span>
              <ArrowRight size={16} className="auth-path-card__arrow" aria-hidden />
            </button>

            <p className="auth-footer-line">
              Already have an account?{' '}
              <button type="button" className="auth-text-link" onClick={() => setMode('login')}>
                Sign in
              </button>
            </p>
          </div>
        )}

        {mode === 'signup' && intent === 'creator' && (
          <div className="auth-form" style={{ gap: 12 }}>
            <div className="auth-hub-block" style={{ margin: 0 }}>
              <button type="button" className="auth-hub-btn" onClick={openHubContinue}>
                <Lock size={17} aria-hidden />
                <span>Continue with Pinit HUB</span>
                <ExternalLink size={14} aria-hidden />
              </button>
              <p className="auth-hub-hint">Already have a Hub account? Sign in once — you return here as a seller.</p>
            </div>

            <div className="auth-divider" role="separator">
              <span>or create a Pinit HUB account</span>
            </div>

            <div className="auth-protect-note">
              <Lock size={16} aria-hidden />
              <p>
                <strong>Sellers need Hub first.</strong> Choose Individual or Business, complete Hub registration,
                then your Exchange seller profile activates automatically.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button type="button" className="btn-secondary auth-submit" onClick={() => openHubRegister('INDIVIDUAL')}>
                <User size={16} /> Individual
              </button>
              <button type="button" className="btn-secondary auth-submit" onClick={() => openHubRegister('BUSINESS')}>
                <Building2 size={16} /> Business
              </button>
            </div>
            <button type="button" className="btn-primary auth-submit" onClick={() => openHubRegister(null)}>
              Create Pinit HUB account <ExternalLink size={14} />
            </button>

            {success && <SuccessBox text={success} />}
            {error && <ErrorBox text={error} />}

            <button type="button" className="auth-back" onClick={() => { setMode('welcome'); setIntent(null); setError(''); setSuccess(''); }}>
              Back to account type
            </button>
          </div>
        )}

        {mode === 'login' && (
          <>
            <div className="auth-hub-block">
              <button type="button" className="auth-hub-btn" onClick={openHubContinue}>
                <Lock size={17} aria-hidden />
                <span>Continue with Pinit HUB</span>
                <ExternalLink size={14} aria-hidden />
              </button>
              <p className="auth-hub-hint">For sellers — same Pinit identity for Hub and Exchange.</p>
              {success && <SuccessBox text={success} />}
            </div>

            <div className="auth-divider" role="separator">
              <span>or buyer email</span>
            </div>

            <form onSubmit={handleLogin} className="auth-form">
              <label className="auth-label">
                Email
                <input className="auth-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </label>
              <label className="auth-label">
                Password
                <input className="auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </label>
              {error && <ErrorBox text={error} />}
              <button type="submit" className="btn-primary auth-submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in with email'}
              </button>
              <button type="button" className="auth-back" onClick={() => { setMode('welcome'); setError(''); setSuccess(''); }}>
                Back to account type
              </button>
            </form>
          </>
        )}

        {mode === 'signup' && intent === 'buyer' && (
          <form onSubmit={handleBuyerSignup} className="auth-form">
            <label className="auth-label">
              Full name
              <input className="auth-input" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
            </label>
            <label className="auth-label">
              Work email
              <input className="auth-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            <label className="auth-label">
              Organization <span className="auth-optional">(optional)</span>
              <input className="auth-input" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Agency, brand, or studio" />
            </label>
            <label className="auth-label">
              Password
              <input className="auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            </label>
            <label className="auth-check">
              <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
              <span>I agree to Pinit Exchange buyer terms and license rules.</span>
            </label>
            {error && <ErrorBox text={error} />}
            {success && <SuccessBox text={success} />}
            <button type="submit" className="btn-primary auth-submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create buyer account'}
            </button>
            <button type="button" className="auth-back" onClick={() => { setMode('welcome'); setIntent(null); setError(''); }}>
              Back to account type
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ text }) {
  return <div className="auth-alert auth-alert--error" role="alert">{text}</div>;
}

function SuccessBox({ text }) {
  return (
    <div className="auth-alert auth-alert--success" role="status">
      <CheckCircle2 size={16} aria-hidden />
      <span>{text}</span>
    </div>
  );
}

export { SESSION_KEY };
