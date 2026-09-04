import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, QrCode, Share2, ShieldCheck, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { HUB_APP_URL } from '../lib/exchange-routes.js';
import PortfolioPages from '../components/portfolio/PortfolioPages.jsx';

function isPreviewVisit() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('preview') === '1';
}

function leavePreview() {
  const editor = `${HUB_APP_URL.replace(/\/$/, '')}/profile?tab=portfolio`;
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.focus();
      window.close();
    }
  } catch {
    /* ignore */
  }
  window.setTimeout(() => {
    if (!window.closed) window.location.assign(editor);
  }, 80);
}

export default function PublicPortfolioPage({
  slug,
  viewer,
  onNavigate,
  onOpenAuth,
  onSelectListing,
}) {
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined' || !slug) return '';
    return `${window.location.origin}/p/${slug}`;
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const pub = await apiFetch(`/api/portfolio/public/${encodeURIComponent(slug)}`);
      if (cancelled) return;
      if (pub.ok) {
        const page = pub.data?.portfolio?.identity ? pub.data.portfolio : pub.data;
        setPortfolio(page);
        setError('');
        if (page?.identity?.name) document.title = `${page.identity.name} | Pinit Portfolio`;
        return;
      }
      const me = await apiFetch('/api/portfolio/me');
      if (cancelled) return;
      const mine = me.data?.portfolio?.identity ? me.data.portfolio : me.data;
      if (me.ok && mine?.slug === slug) {
        setPortfolio(mine);
        setError('');
        return;
      }
      setPortfolio(null);
      setError(pub.error || 'Portfolio not found');
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const hire = () => {
    if (!viewer) {
      onOpenAuth?.({ mode: 'signup', intent: 'buyer' });
      return;
    }
    onNavigate?.('requirements');
  };

  const contact = () => {
    const email = portfolio?.contact?.email;
    if (email) {
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Project with ${portfolio.identity.name}`)}`;
      return;
    }
    hire();
  };

  return (
    <div className={`ps-shell${portfolio?.theme ? ` ps-theme-${portfolio.theme}` : ''}`}>
      <header className="ps-chrome">
        <div className="ps-chrome__start">
          {isPreviewVisit() && (
            <button type="button" className="ps-btn" onClick={leavePreview}>
              <ArrowLeft size={14} /> Back
            </button>
          )}
          <button type="button" className="ps-brand" onClick={() => onNavigate('marketplace')}>
            <ShieldCheck size={17} /> Pinit
          </button>
        </div>
        <button type="button" className="ps-btn" onClick={() => setShareOpen(true)}>
          <Share2 size={14} /> Share
        </button>
      </header>

      {error && <div className="ps-empty">This portfolio is not available.</div>}
      {!error && !portfolio && <div className="ps-empty">Loading…</div>}
      {portfolio && (
        <PortfolioPages
          portfolio={portfolio}
          onNavigate={onNavigate}
          onSelectListing={onSelectListing}
          onContact={contact}
          onHire={hire}
        />
      )}

      {shareOpen && (
        <div className="ps-share" onClick={() => setShareOpen(false)}>
          <div className="ps-share__card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="ps-share__x" onClick={() => setShareOpen(false)} aria-label="Close"><X size={16} /></button>
            <h3>Share this portfolio</h3>
            <code>{shareUrl}</code>
            <div className="ps-actions">
              <button type="button" className="ps-btn ps-btn--solid" onClick={copyLink}><Copy size={14} /> {copied ? 'Copied' : 'Copy link'}</button>
              <a className="ps-btn" href={`https://wa.me/?text=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer">WhatsApp</a>
              <a className="ps-btn" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer">LinkedIn</a>
            </div>
            <img alt="QR" src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`} />
            <p><QrCode size={13} /> Scan to open</p>
          </div>
        </div>
      )}
    </div>
  );
}
