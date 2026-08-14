import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  ShoppingBag,
  Camera,
  Fingerprint,
  ArrowRight,
  ExternalLink,
  Building2,
  User,
} from 'lucide-react';

import { hubLoginUrl, hubRegisterUrl } from '../lib/exchange-routes.js';

const SESSION_KEY = 'pinit_exchange_session';
const INTENT_KEY = 'pinit_exchange_intent';

function stashIntent(nextIntent) {
  try {
    sessionStorage.setItem(INTENT_KEY, nextIntent === 'creator' ? 'creator' : 'buyer');
  } catch {
    /* ignore */
  }
}

function goToHub(url) {
  // Force a full navigation off Exchange. Never silently no-op.
  try {
    window.top.location.href = url;
  } catch {
    window.location.href = url;
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

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode || 'welcome');
    setIntent(initialIntent);
  }, [isOpen, initialMode, initialIntent]);

  const title = useMemo(() => {
    if (mode === 'login') return 'Sign in with Pinit HUB';
    if (mode === 'signup' && intent === 'buyer') return 'Buy with Hub identity';
    if (mode === 'signup' && intent === 'creator') return 'Sell on Exchange';
    return 'Choose your account type';
  }, [mode, intent]);

  if (!isOpen) return null;

  const openHubContinue = (nextIntent = intent || 'buyer') => {
    stashIntent(nextIntent);
    const returnUrl = `${window.location.origin}/?hub_return=1&exchange_intent=${nextIntent === 'creator' ? 'creator' : 'buyer'}`;
    goToHub(hubLoginUrl(returnUrl, { mode: 'login' }));
  };

  const openHubRegister = (accountHint = null) => {
    stashIntent('creator');
    const returnUrl = `${window.location.origin}/?hub_return=1&exchange_intent=creator`;
    goToHub(hubRegisterUrl(returnUrl, accountHint));
  };

  const startIntent = (nextIntent) => {
    setIntent(nextIntent);
    stashIntent(nextIntent);
    setMode('signup');
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
              </span>
              <ArrowRight size={16} className="auth-path-card__arrow" aria-hidden />
            </button>

            <button type="button" className="auth-path-card" onClick={() => startIntent('buyer')}>
              <span className="auth-path-card__icon auth-path-card__icon--buy" aria-hidden>
                <ShoppingBag size={20} />
              </span>
              <span className="auth-path-card__body">
                <strong>Buyer</strong>
              </span>
              <ArrowRight size={16} className="auth-path-card__arrow" aria-hidden />
            </button>

            <p className="auth-footer-line">
              Already have a Hub account?{' '}
              <button type="button" className="auth-text-link" onClick={() => setMode('login')}>
                Sign in with Hub biometric
              </button>
            </p>
          </div>
        )}

        {mode === 'signup' && intent === 'creator' && (
          <div className="auth-form" style={{ gap: 12 }}>
            <div className="auth-hub-block" style={{ margin: 0 }}>
              <button type="button" className="auth-hub-btn" onClick={() => openHubContinue('creator')}>
                <Fingerprint size={17} aria-hidden />
                <span>Continue with Hub biometric</span>
                <ExternalLink size={14} aria-hidden />
              </button>
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

            <button type="button" className="auth-back" onClick={() => { setMode('welcome'); setIntent(null); }}>
              Back to account type
            </button>
          </div>
        )}

        {mode === 'signup' && intent === 'buyer' && (
          <div className="auth-form" style={{ gap: 12 }}>
            <div className="auth-hub-block" style={{ margin: 0 }}>
              <button type="button" className="auth-hub-btn" onClick={() => openHubContinue('buyer')}>
                <Fingerprint size={17} aria-hidden />
                <span>Continue with Hub biometric</span>
                <ExternalLink size={14} aria-hidden />
              </button>
            </div>
            <button
              type="button"
              className="btn-secondary auth-submit"
              onClick={() => {
                stashIntent('buyer');
                const returnUrl = `${window.location.origin}/?hub_return=1&exchange_intent=buyer`;
                goToHub(hubRegisterUrl(returnUrl));
              }}
            >
              New to Pinit? Create Hub account
            </button>
            <button type="button" className="auth-back" onClick={() => { setMode('welcome'); setIntent(null); }}>
              Back to account type
            </button>
          </div>
        )}

        {mode === 'login' && (
          <div className="auth-form" style={{ gap: 12 }}>
            <div className="auth-hub-block" style={{ margin: 0 }}>
              <button type="button" className="auth-hub-btn" onClick={() => openHubContinue(intent || 'buyer')}>
                <Fingerprint size={17} aria-hidden />
                <span>Continue with Hub biometric</span>
                <ExternalLink size={14} aria-hidden />
              </button>
            </div>
            <button type="button" className="auth-back" onClick={() => setMode('welcome')}>
              Back to account type
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export { SESSION_KEY, INTENT_KEY };
