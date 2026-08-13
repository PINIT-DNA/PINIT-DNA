import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  ShieldCheck,
  ShoppingBag,
  Camera,
  Fingerprint,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Building2,
  User,
} from 'lucide-react';

const HUB_APP_URL = (import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const SESSION_KEY = 'pinit_exchange_session';
const INTENT_KEY = 'pinit_exchange_intent';

function stashIntent(nextIntent) {
  try {
    sessionStorage.setItem(INTENT_KEY, nextIntent === 'creator' ? 'creator' : 'buyer');
  } catch {
    /* ignore */
  }
}

/**
 * Exchange never stores passwords or runs its own biometric capture.
 * Identity is Pinit HUB only (face / voice / Hub login), then SSO returns here.
 */
export default function AuthModal({
  isOpen,
  onClose,
  initialMode = 'welcome',
  initialIntent = null,
}) {
  const [mode, setMode] = useState(initialMode);
  const [intent, setIntent] = useState(initialIntent);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode || 'welcome');
    setIntent(initialIntent);
    setSuccess('');
  }, [isOpen, initialMode, initialIntent]);

  const title = useMemo(() => {
    if (mode === 'login') return 'Sign in with Pinit HUB';
    if (mode === 'signup' && intent === 'buyer') return 'Buy with Hub identity';
    if (mode === 'signup' && intent === 'creator') return 'Sell on Exchange';
    return 'Choose your account type';
  }, [mode, intent]);

  const subtitle = useMemo(() => {
    if (mode === 'login') {
      return 'No email or password on Exchange. Complete Hub biometric verification, then you return here.';
    }
    if (intent === 'buyer') {
      return 'Buyers also use Pinit HUB biometric identity — same secure login as Hub.';
    }
    if (intent === 'creator') {
      return 'Sellers protect assets in Hub, then list them here with the same biometric identity.';
    }
    return 'Pinit Exchange does not accept email/password. All access is Pinit HUB biometric identity.';
  }, [mode, intent]);

  if (!isOpen) return null;

  const openHubContinue = (nextIntent = intent || 'buyer') => {
    stashIntent(nextIntent);
    const returnUrl = `${window.location.origin}/?hub_return=1&exchange_intent=${nextIntent === 'creator' ? 'creator' : 'buyer'}`;
    const existing = window.open(
      `${HUB_APP_URL}/login?exchange_return=${encodeURIComponent(returnUrl)}&hub_mode=login`,
      'pinit-hub-auth',
    );
    if (existing) existing.focus();
    setSuccess('Pinit Hub opened. Sign in with your existing identity — this does not create a new Pinit ID.');
  };

  const openHubRegister = (accountHint = null) => {
    stashIntent('creator');
    const returnUrl = `${window.location.origin}/?hub_return=1&exchange_intent=creator`;
    const base = `${HUB_APP_URL}/register/account-type?exchange_return=${encodeURIComponent(returnUrl)}`;
    const url = accountHint ? `${base}&hint=${accountHint}` : base;
    window.open(url, '_blank', 'noopener,noreferrer');
    setSuccess('Create your Pinit HUB account with biometric verification, then you return here as a seller.');
  };

  const startIntent = (nextIntent) => {
    setIntent(nextIntent);
    stashIntent(nextIntent);
    setMode('signup');
    setSuccess('');
  };

  const eyebrow =
    intent === 'buyer' || (mode === 'login' && intent !== 'creator')
      ? 'Hub biometric · Buyer'
      : intent === 'creator'
        ? 'Hub biometric · Seller'
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
              <Fingerprint size={15} aria-hidden />
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
                <span>Hub biometric identity required to list protected assets.</span>
              </span>
              <ArrowRight size={16} className="auth-path-card__arrow" aria-hidden />
            </button>

            <button type="button" className="auth-path-card" onClick={() => startIntent('buyer')}>
              <span className="auth-path-card__icon auth-path-card__icon--buy" aria-hidden>
                <ShoppingBag size={20} />
              </span>
              <span className="auth-path-card__body">
                <strong>Buyer</strong>
                <span>Same Hub biometric login — no email or password on Exchange.</span>
              </span>
              <ArrowRight size={16} className="auth-path-card__arrow" aria-hidden />
            </button>

            <p className="auth-footer-line">
              Already have a Hub account?{' '}
              <button type="button" className="auth-text-link" onClick={() => { setMode('login'); setSuccess(''); }}>
                Sign in with Hub biometric
              </button>
            </p>
          </div>
        )}

        {mode === 'signup' && intent === 'creator' && (
          <div className="auth-form" style={{ gap: 12 }}>
            <div className="auth-protect-note">
              <ShieldCheck size={16} aria-hidden />
              <p>
                <strong>Biometric identity lives on Pinit HUB.</strong> Face and voice verification
                never run inside Exchange. After Hub confirms you, Exchange receives a signed SSO token only.
              </p>
            </div>
            <div className="auth-hub-block" style={{ margin: 0 }}>
              <button type="button" className="auth-hub-btn" onClick={() => openHubContinue('creator')}>
                <Fingerprint size={17} aria-hidden />
                <span>Continue with Hub biometric</span>
                <ExternalLink size={14} aria-hidden />
              </button>
              <p className="auth-hub-hint">Sign in on Hub with face / voice, then return here as a seller.</p>
            </div>

            <div className="auth-divider" role="separator">
              <span>new Hub account</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button type="button" className="btn-secondary auth-submit" onClick={() => openHubRegister('INDIVIDUAL')}>
                <User size={16} /> Individual
              </button>
              <button type="button" className="btn-secondary auth-submit" onClick={() => openHubRegister('BUSINESS')}>
                <Building2 size={16} /> Business
              </button>
            </div>

            {success && <SuccessBox text={success} />}
            <button type="button" className="auth-back" onClick={() => { setMode('welcome'); setIntent(null); setSuccess(''); }}>
              Back to account type
            </button>
          </div>
        )}

        {mode === 'signup' && intent === 'buyer' && (
          <div className="auth-form" style={{ gap: 12 }}>
            <div className="auth-protect-note">
              <Fingerprint size={16} aria-hidden />
              <p>
                <strong>Buyers use the same Hub biometric login.</strong> Exchange does not collect
                email or passwords. Your license is tied to your verified Pinit ID.
              </p>
            </div>
            <div className="auth-hub-block" style={{ margin: 0 }}>
              <button type="button" className="auth-hub-btn" onClick={() => openHubContinue('buyer')}>
                <Fingerprint size={17} aria-hidden />
                <span>Continue with Hub biometric</span>
                <ExternalLink size={14} aria-hidden />
              </button>
              <p className="auth-hub-hint">Complete Hub face / voice verification, then return here to buy.</p>
            </div>
            <button
              type="button"
              className="btn-secondary auth-submit"
              onClick={() => {
                stashIntent('buyer');
                const returnUrl = `${window.location.origin}/?hub_return=1&exchange_intent=buyer`;
                window.open(
                  `${HUB_APP_URL}/register/account-type?exchange_return=${encodeURIComponent(returnUrl)}`,
                  '_blank',
                  'noopener,noreferrer',
                );
                setSuccess('Create your Pinit HUB account with biometric verification, then you return here to buy.');
              }}
            >
              New to Pinit? Create Hub account
            </button>
            {success && <SuccessBox text={success} />}
            <button type="button" className="auth-back" onClick={() => { setMode('welcome'); setIntent(null); setSuccess(''); }}>
              Back to account type
            </button>
          </div>
        )}

        {mode === 'login' && (
          <div className="auth-form" style={{ gap: 12 }}>
            <div className="auth-protect-note">
              <ShieldCheck size={16} aria-hidden />
              <p>
                Email and password sign-in is disabled on Exchange. Authenticate on Pinit HUB
                (biometric), then a one-time signed token opens your Exchange session.
              </p>
            </div>
            <div className="auth-hub-block" style={{ margin: 0 }}>
              <button type="button" className="auth-hub-btn" onClick={() => openHubContinue(intent || 'buyer')}>
                <Fingerprint size={17} aria-hidden />
                <span>Continue with Hub biometric</span>
                <ExternalLink size={14} aria-hidden />
              </button>
              <p className="auth-hub-hint">Works for buyers and sellers — same Pinit identity.</p>
            </div>
            {success && <SuccessBox text={success} />}
            <button type="button" className="auth-back" onClick={() => { setMode('welcome'); setSuccess(''); }}>
              Back to account type
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SuccessBox({ text }) {
  return (
    <div className="auth-alert auth-alert--success" role="status">
      <CheckCircle2 size={16} aria-hidden />
      <span>{text}</span>
    </div>
  );
}

export { SESSION_KEY, INTENT_KEY };
