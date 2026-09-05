import React, { useMemo, useState } from 'react';
import {
  Award, Building2, CheckCircle2, Download, ExternalLink, Fingerprint,
  Link2, Lock, Share2, Shield,
} from 'lucide-react';

const asArray = (v) => (Array.isArray(v) ? v : []);

function labelOf(item, ...keys) {
  if (typeof item === 'string') return item;
  for (const k of keys) {
    if (typeof item?.[k] === 'string' && item[k].trim()) return item[k];
  }
  return '';
}

function kindOf(item) {
  const raw = String(item?.kind || item?.relatedSkill || '').toLowerCase();
  if (raw === 'license' || raw === 'course' || raw === 'workshop' || raw === 'award') return raw;
  return 'certificate';
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const FILTERS = [
  ['all', 'All Certificates'],
  ['award', 'Awards'],
  ['license', 'Licenses'],
  ['course', 'Courses'],
  ['workshop', 'Workshops'],
];

function CertificatePaper({ title, name, issuer }) {
  return (
    <div className="pf-certpaper" aria-hidden="true">
      <span className="pf-certpaper__ribbon">Pinit</span>
      <span className="pf-certpaper__seal">Pinit</span>
      <p className="pf-certpaper__kicker">Certificate</p>
      <p className="pf-certpaper__of">OF ACHIEVEMENT</p>
      <p className="pf-certpaper__to">PROUDLY PRESENTED TO</p>
      <p className="pf-certpaper__name">{name || 'Recipient'}</p>
      <p className="pf-certpaper__title">{title}</p>
      {issuer ? <p className="pf-certpaper__issuer">{issuer}</p> : null}
      <span className="pf-certpaper__wave" />
    </div>
  );
}

export default function LicensesCertificates({
  portfolio, onShare, name,
}) {
  const id = portfolio?.identity || {};
  const displayName = name || id.name || '';
  const humanAvg = portfolio?.verified?.summary?.avg_human_percent;
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [selectedId, setSelectedId] = useState(null);

  const items = useMemo(() => {
    const creds = asArray(portfolio?.certifications).map((c, i) => ({
      id: c.id || `cert-${i}`,
      source: 'credential',
      kind: kindOf(c),
      title: labelOf(c, 'title', 'name') || 'Certificate',
      issuer: labelOf(c, 'issuer', 'org') || '',
      year: c.year || c.issuedOn || c.period || '',
      note: c.note || c.description || '',
      credential_id: c.credential_id || '',
      preview_url: c.preview_url || '',
      hub_protected: Boolean(c.hub_protected),
      human_percent: null,
      verification_url: c.verification_url || c.external_url || '',
    }));
    const awards = asArray(portfolio?.awards).map((a, i) => ({
      id: a.id || `award-${i}`,
      source: 'award',
      kind: 'award',
      title: labelOf(a, 'title', 'name') || 'Award',
      issuer: labelOf(a, 'issuer', 'org', 'body') || '',
      year: a.year || a.period || '',
      note: a.note || a.description || '',
      credential_id: '',
      preview_url: '',
      hub_protected: false,
      human_percent: null,
      verification_url: '',
    }));
    const ledgerDocs = asArray(portfolio?.verified?.entries).map((e) => ({
        id: e.asset_id,
        source: 'hub',
        kind: 'certificate',
        title: e.title || 'Protected file',
        issuer: 'Pinit HUB',
        year: when(e.protected_at),
        note: 'Fingerprinted and dated in Pinit HUB before it was shown here.',
        credential_id: e.certificate || '',
        preview_url: '',
        hub_protected: true,
        human_percent: Number.isFinite(e.human_percent) ? e.human_percent : null,
        verification_url: '',
      }));
    return [...creds, ...awards, ...ledgerDocs];
  }, [portfolio]);

  const visible = useMemo(() => {
    const list = filter === 'all' ? items : items.filter((it) => it.kind === filter);
    const copy = [...list];
    copy.sort((a, b) => {
      if (sort === 'az') return a.title.localeCompare(b.title);
      return String(b.year).localeCompare(String(a.year));
    });
    return copy;
  }, [items, filter, sort]);

  const selected = visible.find((it) => it.id === selectedId) || visible[0] || null;

  if (!items.length) return null;

  const share = () => {
    if (onShare) {
      onShare();
      return;
    }
    try {
      navigator.clipboard.writeText(window.location.href);
    } catch { /* ignore */ }
  };

  return (
    <section className="pf-certs-page" id="pf-certificates">
      <div className="pf-certs-hero">
        <div>
          <p className="pf-certs-kicker">Certificates &amp; Licenses</p>
          <h2>Certified. <em>Verified.</em> Human.</h2>
          <p className="pf-certs-lead">
            Credentials you added from your vault, plus documents fingerprinted in Pinit HUB.
            Nothing here is invented to fill the page.
          </p>
          <div className="pf-certs-feats">
            <span><Shield size={15} /><b>Human verified</b><em>{Number.isFinite(humanAvg) ? `${humanAvg}% human on sealed files` : 'Shown only when a file was analysed in HUB'}</em></span>
            <span><Building2 size={15} /><b>Named issuers</b><em>The organisations you listed</em></span>
            <span><Fingerprint size={15} /><b>Fingerprinted</b><em>HUB DNA — not a decorative seal</em></span>
            <span><Award size={15} /><b>Career ready</b><em>Share the same page a client sees</em></span>
          </div>
        </div>
        <aside className="pf-certs-standard">
          <span className="pf-certs-gold">Human<br />Verified</span>
          <p>Pinit certification standard</p>
          <em>A gold mark appears only on files protected in HUB, or analysed as human-made. It is not printed on every card.</em>
        </aside>
      </div>

      <div className="pf-certs-bar">
        <div className="pf-certs-tabs">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={filter === id ? 'is-on' : ''}
              onClick={() => { setFilter(id); setSelectedId(null); }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="pf-certs-sort">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="az">A–Z</option>
          </select>
        </label>
      </div>

      <div className="pf-certs-layout">
        <div className="pf-certs-grid">
          {visible.length === 0 ? (
            <p className="pf-dim">Nothing in this filter yet.</p>
          ) : visible.map((card) => {
            const sealed = card.hub_protected || Number.isFinite(card.human_percent);
            return (
              <article
                key={card.id}
                className={`pf-cred${selected?.id === card.id ? ' is-on' : ''}`}
              >
                <button type="button" className="pf-cred__visual" onClick={() => setSelectedId(card.id)}>
                  {card.preview_url
                    ? <img src={card.preview_url} alt="" />
                    : <CertificatePaper title={card.title} name={displayName} issuer={card.issuer} />}
                  {sealed ? <span className="pf-certs-gold pf-certs-gold--mini">Human<br />Verified</span> : null}
                </button>
                <div className="pf-cred__body">
                  <h3>{card.title}</h3>
                  <p className="pf-cred__meta">
                    {card.issuer ? <b>{card.issuer}</b> : null}
                    <span>{card.kind}</span>
                    {card.year ? <span>{card.year}</span> : null}
                  </p>
                  {card.note ? <p className="pf-cred__note">{card.note}</p> : null}
                  <div className="pf-cred__act">
                    {card.preview_url || card.verification_url ? (
                      <a
                        className="pf-btn pf-btn--sm"
                        href={card.preview_url || card.verification_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View credential <ExternalLink size={12} />
                      </a>
                    ) : (
                      <button type="button" className="pf-btn pf-btn--sm" onClick={() => setSelectedId(card.id)}>
                        View details
                      </button>
                    )}
                    <button type="button" className="pf-btn pf-btn--sm" onClick={share} aria-label="Copy link">
                      <Link2 size={13} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {selected ? (
          <aside className="pf-certs-side">
            <div className="pf-certs-panel">
              <p className="pf-certs-panel__h"><CheckCircle2 size={15} /> Verification details</p>
              <dl>
                <div><dt>Verified by</dt><dd>{selected.hub_protected ? 'Pinit HUB' : 'Issuer record'}</dd></div>
                <div><dt>Issuer</dt><dd>{selected.issuer || '—'}</dd></div>
                <div><dt>Issue date</dt><dd>{selected.year || '—'}</dd></div>
                <div><dt>Credential ID</dt><dd>{selected.credential_id || '—'}</dd></div>
                {Number.isFinite(selected.human_percent) ? (
                  <div><dt>Human</dt><dd>{selected.human_percent}%</dd></div>
                ) : null}
              </dl>
              <span className={`pf-certs-status${selected.hub_protected ? ' is-ok' : ''}`}>
                {selected.hub_protected ? 'Protected' : 'Listed'}
              </span>
              {selected.verification_url ? (
                <a className="pf-btn pf-btn--dark" href={selected.verification_url} target="_blank" rel="noreferrer">
                  View on issuer website <ExternalLink size={13} />
                </a>
              ) : null}
            </div>
            <div className="pf-certs-panel">
              <p className="pf-certs-panel__h"><Share2 size={15} /> Share this certificate</p>
              <button type="button" className="pf-btn" onClick={share}>Copy page link</button>
            </div>
            {selected.preview_url ? (
              <a className="pf-btn pf-btn--dark" href={selected.preview_url} target="_blank" rel="noreferrer">
                <Download size={14} /> Download certificate
              </a>
            ) : null}
            <p className="pf-certs-lock"><Lock size={12} /> Vault files are never re-uploaded here. The public page only shows what was already protected.</p>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
