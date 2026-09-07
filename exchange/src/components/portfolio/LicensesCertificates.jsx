import React, { useMemo, useState } from 'react';
import { BadgeCheck, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, X } from 'lucide-react';

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
  if (raw === 'license' || raw === 'course' || raw === 'workshop' || raw === 'award' || raw === 'recognition') {
    return raw;
  }
  if (raw === 'certification') return 'certificate';
  return 'certificate';
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function yearOf(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const n = Number(String(iso).slice(0, 4));
    return Number.isFinite(n) ? n : null;
  }
  return d.getFullYear();
}

const KIND_LABEL = {
  award: 'Award',
  license: 'License',
  course: 'Course',
  workshop: 'Workshop',
  certificate: 'Certification',
  recognition: 'Recognition',
};

const FILTERS = [
  ['all', 'All'],
  ['award', 'Awards'],
  ['license', 'Licenses'],
  ['course', 'Courses'],
  ['workshop', 'Workshops'],
  ['certificate', 'Certifications'],
];

function sealFromPercent(percent) {
  if (!Number.isFinite(percent)) return null;
  if (percent >= 90) return { headline: 'HUMAN VERIFIED', tier: 'gold', percent };
  if (percent >= 75) return { headline: 'VERIFIED', tier: 'silver', percent };
  if (percent >= 50) return { headline: 'REVIEWED', tier: 'bronze', percent };
  return null;
}

function CredentialSeal({ seal }) {
  if (!seal) return null;
  const color = seal.tier === 'gold' ? '#D9A441' : seal.tier === 'silver' ? '#C5CDD8' : '#C4845A';
  return (
    <div className="pf-cseal" style={{ borderColor: `${color}66`, boxShadow: `0 6px 16px -10px ${color}` }} aria-label={`${seal.headline} ${seal.percent}%`}>
      <span className="pf-cseal__dot" style={{ background: color }} />
      <span className="pf-cseal__h" style={{ color }}>{seal.headline}</span>
      <span className="pf-cseal__t" style={{ color }}>{seal.tier}</span>
    </div>
  );
}

function publicCredentialId(id) {
  const trimmed = String(id || '').trim();
  if (!trimmed) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return '';
  if (trimmed.length > 32) return '';
  return trimmed;
}

export default function LicensesCertificates({
  portfolio, onShare, name,
}) {
  const id = portfolio?.identity || {};
  const displayName = name || id.name || '';
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [previewId, setPreviewId] = useState(null);
  const [verifyId, setVerifyId] = useState(null);

  const items = useMemo(() => {
    const ledger = asArray(portfolio?.verified?.entries);
    const byVault = new Map();
    for (const e of ledger) {
      if (e?.asset_id) byVault.set(e.asset_id, e);
      if (e?.vault_id) byVault.set(e.vault_id, e);
    }
    const attachHub = (row, vaultId) => {
      const e = vaultId ? byVault.get(vaultId) : null;
      if (!e) return row;
      return {
        ...row,
        hub_protected: true,
        human_percent: Number.isFinite(row.human_percent) ? row.human_percent : (Number.isFinite(e.human_percent) ? e.human_percent : null),
        credential_id: row.credential_id || e.certificate || '',
        fingerprinted: true,
      };
    };
    const creds = asArray(portfolio?.certifications).map((c, i) => attachHub({
      id: c.id || `cert-${i}`,
      kind: kindOf(c),
      title: labelOf(c, 'title', 'name') || 'Certificate',
      issuer: labelOf(c, 'issuer', 'org') || '',
      year: c.year || c.issuedOn || c.period || '',
      credential_id: c.credential_id || '',
      preview_url: c.preview_url || '',
      hub_protected: Boolean(c.hub_protected),
      human_percent: Number.isFinite(c.human_percent) ? c.human_percent : null,
      verification_url: c.verification_url || c.external_url || '',
      fingerprinted: Boolean(c.hub_protected || c.dna_id || c.vault_id),
    }, c.vault_id || c.documentKey));
    const awards = asArray(portfolio?.awards).map((a, i) => attachHub({
      id: a.id || `award-${i}`,
      kind: 'award',
      title: labelOf(a, 'title', 'name') || 'Award',
      issuer: labelOf(a, 'issuer', 'org', 'body') || '',
      year: a.year || a.period || '',
      credential_id: '',
      preview_url: '',
      hub_protected: Boolean(a.hub_protected || a.vault_id),
      human_percent: Number.isFinite(a.human_percent) ? a.human_percent : null,
      verification_url: '',
      fingerprinted: Boolean(a.vault_id),
    }, a.vault_id));
    const listedIds = new Set([...creds, ...awards].map((x) => x.id));

    /*
     * Only the work that is actually on sale.
     *
     * Every protected vault asset carries a certificate, so pulling the whole
     * ledger in here turned the section into a file listing — Ocean.jpg and a
     * build-plan .docx sat beside real credentials. A visitor reads this page
     * to check the work they can license, so the ledger contributes only the
     * assets that reached the Shop.
     *
     * Certificates and awards the person added by hand are untouched: those
     * were curated deliberately and are not tied to a listing.
     */
    const shopAssetIds = new Set(
      asArray(portfolio?.marketplace).map((m) => m?.asset_id).filter(Boolean),
    );

    const ledgerDocs = asArray(portfolio?.verified?.entries)
      .filter((e) => e.certificate || e.credential_id)
      .filter((e) => shopAssetIds.has(e.asset_id))
      .map((e) => ({
        id: e.certificate || e.asset_id,
        kind: 'certificate',
        title: e.title || 'Protected credential',
        issuer: e.issuer || '',
        year: when(e.protected_at),
        credential_id: e.certificate || e.credential_id || '',
        preview_url: '',
        hub_protected: true,
        human_percent: Number.isFinite(e.human_percent) ? e.human_percent : null,
        verification_url: '',
        fingerprinted: true,
      }))
      .filter((row) => !listedIds.has(row.id));
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

  const humanVerifiedCount = items.filter((it) => Number.isFinite(it.human_percent) && it.human_percent >= 90).length;
  const protectedCount = items.filter((it) => it.hub_protected).length;
  const years = items.map((it) => yearOf(it.year)).filter((y) => y != null);
  const sinceYear = years.length ? Math.min(...years) : null;

  const preview = visible.find((it) => it.id === previewId) || null;
  const verify = items.find((it) => it.id === verifyId) || null;
  const previewIndex = preview ? visible.findIndex((it) => it.id === preview.id) : -1;

  const share = async (card) => {
    const url = card?.verification_url
      || (card?.credential_id ? `${window.location.origin}${window.location.pathname}` : window.location.href);
    if (onShare && !card) {
      onShare();
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch { /* ignore */ }
  };

  if (!items.length) {
    return (
      <section className="pf-certs-page" id="pf-certificates">
        <h2>Certificates</h2>
        <p className="pf-certs-lead">No credentials have been added yet.</p>
      </section>
    );
  }

  return (
    <section className="pf-certs-page" id="pf-certificates">
      <div className="pf-certs-head">
        <div>
          <h2>Certificates</h2>
          <p className="pf-certs-lead">
            Credentials, recognitions and licenses connected to this Pinit identity.
          </p>
        </div>
      </div>

      <div className="pf-certs-metrics">
        <div><em>Credentials</em><b>{items.length}</b></div>
        <div><em>Human Verified</em><b>{humanVerifiedCount}</b></div>
        <div><em>Protected</em><b>{protectedCount}</b></div>
        {sinceYear != null ? <div><em>Since</em><b>{sinceYear}</b></div> : null}
      </div>

      <div className="pf-certs-bar">
        <div className="pf-certs-tabs">
          {FILTERS.map(([fid, label]) => (
            <button
              key={fid}
              type="button"
              className={filter === fid ? 'is-on' : ''}
              onClick={() => setFilter(fid)}
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

      <div className="pf-certs-grid pf-certs-grid--compact">
        {visible.length === 0 ? (
          <p className="pf-dim">Nothing in this filter yet.</p>
        ) : visible.map((card) => {
          const seal = sealFromPercent(card.human_percent);
          return (
            /*
             * A credential list is scanned, not read. The card used to carry the
             * whole record — tier, kind, awarded-to, issue date, credential id,
             * human percentage and three buttons — so six of them were a wall.
             *
             * What tells one credential from another is its name, who issued it
             * and when. Everything else is available on opening it, so the row
             * stays quiet and only offers View under the cursor.
             */
            <button
              key={card.id}
              type="button"
              className="pf-cred"
              onClick={() => setPreviewId(card.id)}
              title={`Open ${card.title}`}
            >
              <span className="pf-cred__rule" aria-hidden="true" />
              <span className="pf-cred__row">
                <span className="pf-cred__icon"><FileText size={15} /></span>
                <span className="pf-cred__text">
                  <span className="pf-cred__title">{card.title}</span>
                  {card.issuer ? <span className="pf-cred__issuer">{card.issuer}</span> : null}
                  <span className="pf-cred__foot">
                    {card.year ? <span className="pf-cred__year">{card.year}</span> : null}
                    {/* Hidden until the row is hovered or focused — the promise
                        of the section is that every card opens the document. */}
                    <span className="pf-cred__view"><FileText size={13} /> View</span>
                  </span>
                </span>
                {seal && card.hub_protected ? (
                  <span
                    className="pf-cred__seal"
                    title={`${seal.headline} · ${seal.tier}`}
                    aria-label={`${seal.headline}, ${seal.tier}`}
                  >
                    <BadgeCheck size={14} />
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {preview ? (
        <div className="pf-clight" role="dialog" aria-modal="true" aria-label="Certificate Preview" onClick={() => setPreviewId(null)}>
          <div className="pf-clight__panel" onClick={(e) => e.stopPropagation()}>
            <div className="pf-clight__bar">
              <h3>Certificate Preview</h3>
              <button type="button" className="pf-clight__x" onClick={() => setPreviewId(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="pf-clight__stage">
              {previewIndex > 0 ? (
                <button type="button" className="pf-clight__nav pf-clight__nav--l" onClick={() => setPreviewId(visible[previewIndex - 1].id)} aria-label="Previous">
                  <ChevronLeft size={18} />
                </button>
              ) : null}
              {preview.preview_url ? (
                <img src={preview.preview_url} alt="" className="pf-clight__art" />
              ) : (
                <div className="pf-clight__fallback">
                  <p>{preview.title}</p>
                  {preview.issuer ? <span>{preview.issuer}</span> : null}
                  <em>Artwork is shown here when a certificate document is available.</em>
                </div>
              )}
              {previewIndex >= 0 && previewIndex < visible.length - 1 ? (
                <button type="button" className="pf-clight__nav pf-clight__nav--r" onClick={() => setPreviewId(visible[previewIndex + 1].id)} aria-label="Next">
                  <ChevronRight size={18} />
                </button>
              ) : null}
            </div>
            <dl className="pf-clight__facts">
              <div><dt>Title</dt><dd>{preview.title}</dd></div>
              {displayName ? <div><dt>Recipient</dt><dd>{displayName}</dd></div> : null}
              {preview.issuer ? <div><dt>Issuer</dt><dd>{preview.issuer}</dd></div> : null}
              {preview.year ? <div><dt>Issue date</dt><dd>{preview.year}</dd></div> : null}
              {preview.credential_id ? <div><dt>Credential ID</dt><dd>{preview.credential_id}</dd></div> : null}
            </dl>
            <div className="pf-clight__act">
              <button type="button" className="pf-btn" onClick={() => setPreviewId(null)}>Close</button>
              <button type="button" className="pf-btn pf-btn--dark" onClick={() => { setPreviewId(null); setVerifyId(preview.id); }}>
                Open verification
              </button>
              {preview.preview_url ? (
                <a className="pf-btn" href={preview.preview_url} target="_blank" rel="noreferrer">
                  <Download size={14} /> Download certificate
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {verify ? (
        <div className="pf-clight" role="dialog" aria-modal="true" aria-label="Verification details" onClick={() => setVerifyId(null)}>
          <div className="pf-clight__panel pf-clight__panel--narrow" onClick={(e) => e.stopPropagation()}>
            <div className="pf-clight__bar">
              <h3>Verification details</h3>
              <button type="button" className="pf-clight__x" onClick={() => setVerifyId(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <ul className="pf-cchecks">
              {Number.isFinite(verify.human_percent) && verify.human_percent >= 90 ? <li>✓ Human verified</li> : null}
              {Number.isFinite(verify.human_percent) && verify.human_percent < 90 ? <li>✓ Human signal {verify.human_percent}%</li> : null}
              {verify.hub_protected ? <li>✓ Protected in Pinit HUB</li> : null}
              {verify.fingerprinted ? <li>✓ Fingerprinted</li> : null}
              {verify.credential_id ? <li>✓ Credential recorded</li> : null}
            </ul>
            <dl className="pf-clight__facts">
              <div><dt>Verified by</dt><dd>{verify.hub_protected ? 'Pinit HUB' : 'Issuer record'}</dd></div>
              {verify.issuer ? <div><dt>Issuer</dt><dd>{verify.issuer}</dd></div> : null}
              {verify.year ? <div><dt>Issue date</dt><dd>{verify.year}</dd></div> : null}
              {verify.credential_id ? <div><dt>Credential ID</dt><dd>{verify.credential_id}</dd></div> : null}
              {Number.isFinite(verify.human_percent) ? <div><dt>Human signal</dt><dd>{verify.human_percent}%</dd></div> : null}
              {verify.hub_protected ? <div><dt>Protection</dt><dd>Protected</dd></div> : null}
            </dl>
            <div className="pf-clight__act">
              <button type="button" className="pf-btn" onClick={() => setVerifyId(null)}>Close</button>
              <button type="button" className="pf-btn pf-btn--dark" onClick={() => { setVerifyId(null); setPreviewId(verify.id); }}>
                Preview certificate
              </button>
              {verify.verification_url ? (
                <a className="pf-btn" href={verify.verification_url} target="_blank" rel="noreferrer">
                  Open verification <ExternalLink size={12} />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
