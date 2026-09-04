import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight, Check, Copy, ExternalLink, Eye, Globe, Lock, ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { HUB_APP_URL } from '../../lib/exchange-routes.js';
import PortfolioPages from '../../components/portfolio/PortfolioPages.jsx';

/**
 * Your portfolio, seen from Exchange.
 *
 * There used to be two builders — a 599-line form here and a second one in HUB —
 * for one portfolio. That is the thing that made it feel like nothing ever
 * changed: editing in one place did not obviously affect the other.
 *
 * HUB owns the editor, because HUB owns the identity and the vault the work is
 * picked from. Exchange stores the profile and serves the public page. So this
 * screen is not a builder at all: it is where a seller checks what the public
 * sees, copies the link, and changes who can reach it.
 */

const VISIBILITY = [
  ['public', 'Public', Globe, 'Anyone can find it, including search.'],
  ['unlisted', 'Unlisted', Eye, 'Opens for anyone with the link. Not listed anywhere.'],
  ['private', 'Private', Lock, 'Only you. The public link stops working.'],
];

export default function SellerPortfolio({ user, onNavigate }) {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { ok, data, error: err } = await apiFetch('/api/portfolio/me');
    const mine = data?.portfolio?.identity ? data.portfolio : data;
    if (ok && mine?.slug) { setPortfolio(mine); setError(''); }
    else setError(err || 'Could not load your portfolio.');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const publicUrl = portfolio?.slug && typeof window !== 'undefined'
    ? `${window.location.origin}/p/${portfolio.slug}`
    : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  /**
   * Visibility is the one thing worth changing from here — it is a decision
   * about reach, not about content, and a seller reaches for it on the day
   * they send the link rather than on the day they write the page.
   */
  const setVisibility = async (visibility) => {
    if (!portfolio || visibility === portfolio.visibility) return;
    setSaving(true);
    const { ok, data, error: err } = await apiFetch('/api/portfolio/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility }),
    });
    setSaving(false);
    if (ok) {
      const next = data?.portfolio?.identity ? data.portfolio : data;
      setPortfolio(next?.slug ? next : { ...portfolio, visibility });
      setNotice(visibility === 'private'
        ? 'Your portfolio is private. The public link no longer opens.'
        : `Your portfolio is ${visibility}.`);
    } else {
      setNotice(err || 'Could not change that.');
    }
  };

  const editInHub = () => {
    window.open(`${HUB_APP_URL.replace(/\/$/, '')}/profile?tab=portfolio`, '_blank', 'noopener');
  };

  if (loading) return <p className="studio-empty">Loading your portfolio…</p>;

  if (error || !portfolio) {
    return (
      <div className="sp-empty">
        <ShieldCheck size={22} />
        <h3>No portfolio yet</h3>
        <p>
          Your portfolio is built in Pinit HUB, from the work you have already
          protected there. It appears here once you save it.
        </p>
        <button type="button" className="btn-primary" onClick={editInHub}>
          Build it in Pinit HUB <ArrowUpRight size={14} />
        </button>
      </div>
    );
  }

  const verified = portfolio.verified?.summary;

  return (
    <div className="sp">
      {notice && (
        <div className="ex-alert ex-alert--ok sp-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button>
        </div>
      )}

      <section className="glass-panel sp-head">
        <div className="sp-head__main">
          <p className="sp-eyebrow">Your public portfolio</p>
          <h2>{portfolio.identity?.name}</h2>
          <p className="sp-sub">
            One portfolio, one link. Edited in Pinit HUB, shown here.
          </p>

          <div className="sp-link">
            <code>{publicUrl}</code>
            <button type="button" className="btn-secondary" onClick={copy}>
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
            </button>
            <a className="btn-secondary" href={`/p/${portfolio.slug}`} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Open
            </a>
          </div>

          {verified?.assets_protected > 0 && (
            <p className="sp-verified">
              <ShieldCheck size={14} />
              {verified.assets_protected} asset{verified.assets_protected === 1 ? '' : 's'} sealed
              {verified.since ? ` · protecting since ${verified.since}` : ''}
            </p>
          )}
        </div>

        <button type="button" className="btn-primary sp-edit" onClick={editInHub}>
          Edit in Pinit HUB <ArrowUpRight size={14} />
        </button>
      </section>

      <section className="glass-panel sp-vis">
        <h3>Who can see it</h3>
        <div className="sp-vis__opts">
          {VISIBILITY.map(([id, label, Icon, hint]) => (
            <button
              key={id}
              type="button"
              className={`sp-opt${portfolio.visibility === id ? ' is-on' : ''}`}
              onClick={() => setVisibility(id)}
              disabled={saving}
              aria-pressed={portfolio.visibility === id}
            >
              <Icon size={15} />
              <b>{label}</b>
              <em>{hint}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="sp-preview">
        <div className="sp-preview__bar">
          <span>Live preview</span>
          <span className="sp-preview__hint">Exactly what a visitor sees.</span>
        </div>
        {/* The same component the public page renders, so the preview cannot
            drift from the real thing the way two renderers always do. */}
        <PortfolioPages
          portfolio={portfolio}
          onNavigate={onNavigate}
          onContact={() => {}}
        />
      </section>
    </div>
  );
}
