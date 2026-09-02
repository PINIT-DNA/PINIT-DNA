import React, { useState, useEffect } from 'react';
import { ShieldCheck, Download, Award, FileText, ExternalLink, Share2, Copy, X } from 'lucide-react';
import { formatMoney } from '../lib/money.js';
import { apiFetch } from '../lib/api.js';
import { canPurchase, resolveExchangeAccount } from '../lib/roles.js';
import BecomeBuyerPanel from '../components/BecomeBuyerPanel.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function MyLicenses({ user, onViewCertificate, onEnableBuyer, onBrowse }) {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  // Surfaces download/authorisation failures inline instead of an OS alert.
  const [actionError, setActionError] = useState('');
  /** Licence currently being shared (null = modal closed). */
  const [shareFor, setShareFor] = useState(null);
  const [shareOpts, setShareOpts] = useState({ expiresIn: '', maxViews: '', allowDownload: false, requireName: false, requestLocation: false });
  const [shareBusy, setShareBusy] = useState(false);
  const [shareResult, setShareResult] = useState(null);
  const [shareError, setShareError] = useState('');
  const [copied, setCopied] = useState(false);
  const [certFor, setCertFor] = useState(null);
  const [certData, setCertData] = useState(null);
  const [certBusy, setCertBusy] = useState(false);
  const [certError, setCertError] = useState('');

  useEffect(() => {
    if (user && !canPurchase(user)) {
      setLoading(false);
      setLicenses([]);
      return;
    }
    fetchMyLicenses();
  }, [user?.pinit_id, user?.email, user?.can_purchase]);

  const fetchMyLicenses = async () => {
    setLoading(true);
    try {
      // Scoped server-side to the signed-in session, so no identity is passed
      // in the query string. apiFetch attaches the session token.
      const { ok, data } = await apiFetch('/api/orders/my-licenses');
      if (ok) setLicenses(data.licenses || []);
    } catch (err) {
      console.error('Error fetching licenses:', err);
    } finally {
      setLoading(false);
    }
  };

  const authorizeDownload = async (lic) => {
    setActionError('');
    // apiFetch, not bare fetch — the server now identifies the buyer from the
    // signed session token, which only apiFetch attaches. The buyer id and
    // email are no longer sent: the server reads them from the session, and
    // accepting them from the body was how someone else's licence could be
    // downloaded by supplying a public Pinit ID.
    const { ok, data, error } = await apiFetch('/api/orders/download/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seal_id: lic.seal_id,
        asset_id: lic.asset_id,
      }),
    });
    if (!ok) {
      setActionError(error || 'Download not allowed.');
      return;
    }
    if (!data?.download_url) {
      setActionError('Delivery is not ready yet. Please try again shortly.');
      return;
    }
    window.open(data.download_url, '_blank', 'noopener,noreferrer');
  };

  const openShare = (lic) => {
    setShareFor(lic);
    setShareOpts({ expiresIn: '', maxViews: '', allowDownload: false, requireName: false, requestLocation: false });
    setShareResult(null);
    setShareError('');
    setCopied(false);
  };

  /**
   * Hub creates and hosts the share link; Exchange only proves the caller owns
   * this seal. All view/download tracking lives in Hub, so nothing is stored here.
   */
  const createShare = async () => {
    if (!shareFor) return;
    setShareBusy(true);
    setShareError('');
    // apiFetch attaches the signed session token. The server identifies the
    // sharer from that token now, so the X-PinIT-Id header this used to set by
    // hand is neither needed nor trusted.
    const { ok, data, error } = await apiFetch(`/api/commerce/purchases/${encodeURIComponent(shareFor.seal_id)}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        options: {
          expiresIn: shareOpts.expiresIn ? Number(shareOpts.expiresIn) : null,
          maxViews: shareOpts.maxViews ? Number(shareOpts.maxViews) : null,
          allowDownload: shareOpts.allowDownload,
          requireName: shareOpts.requireName,
          requestLocation: shareOpts.requestLocation,
        },
      }),
    });
    if (ok) setShareResult(data);
    else setShareError(error || 'Could not create share link.');
    setShareBusy(false);
  };

  /**
   * Digital licence certificate.
   *
   * The certificate endpoint has existed since the commerce work landed but
   * nothing ever called it — buyers saw a decorative "VERIFIED SEAL" graphic at
   * checkout and had no way to retrieve the actual record afterwards. This
   * fetches the real seal: tier, status, DNA hash summary, and the parties.
   */
  const openCertificate = async (lic) => {
    setCertFor(lic);
    setCertData(null);
    setCertError('');
    setCertBusy(true);
    const { ok, data, error } = await apiFetch(
      `/api/orders/certificate/${encodeURIComponent(lic.seal_id)}`,
    );
    if (ok) setCertData(data);
    else setCertError(error || 'Could not load this certificate.');
    setCertBusy(false);
  };

  const printCertificate = () => window.print();

  const copyShareUrl = async () => {
    if (!shareResult?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareResult.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareError('Copy failed — select the link and copy manually.');
    }
  };

  if (user && resolveExchangeAccount(user).needsBuyerEnable) {
    return <BecomeBuyerPanel onEnable={onEnableBuyer} />;
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '2.2rem', color: '#fff' }}>My Purchases</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Download licensed exports from Pinit HUB. Master files never leave the Hub vault.
        </p>
      </div>

      {actionError && (
        <div
          role="alert"
          style={{
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            padding: '10px 14px', marginBottom: 20,
            color: 'var(--danger, #c0392b)', fontSize: '0.875rem',
            display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center',
          }}
        >
          <span>{actionError}</span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setActionError('')}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }} aria-busy="true" aria-label="Loading licences">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="ex-card" style={{ padding: 16, display: 'flex', gap: 18 }} aria-hidden="true">
              <div className="ex-skel" style={{ width: 150, height: 104, flexShrink: 0 }} />
              <div style={{ flexGrow: 1 }}>
                <div className="ex-skel ex-skel--line" style={{ width: '40%', marginTop: 4 }} />
                <div className="ex-skel ex-skel--line" style={{ width: '26%' }} />
                <div className="ex-skel ex-skel--line" style={{ width: '58%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : licenses.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={28} color="var(--primary)" />}
          title="No purchases yet"
          description="Creative work you license will appear here."
          primaryLabel="Explore Discover"
          onPrimary={() => onBrowse?.('marketplace')}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {licenses.map((lic) => {
            const licenseStatus = String(lic.license_status || 'active').toLowerCase();
            const canDownload = licenseStatus === 'active' && lic.delivery_url;
            return (
            <div key={lic.seal_id} className="ex-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, marginBottom: '16px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '9px', flexWrap: 'wrap' }}>
                    <span className="ex-verified" style={licenseStatus === 'active' ? {} : { background: 'rgba(244,63,94,.1)', borderColor: 'rgba(244,63,94,.3)', color: '#fda4af' }}>
                      Licence {licenseStatus}
                    </span>
                    {lic.badge_tier && (
                      <span className={`badge-${String(lic.badge_tier).toLowerCase()}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Award size={13} /> {lic.badge_tier}
                      </span>
                    )}
                  </div>

                  <h3 style={{ fontSize: '1.15rem', color: '#fff', margin: 0, fontFamily: 'var(--font-heading)' }}>
                    {lic.asset_title || lic.title || `License #${lic.listing_id}`}
                  </h3>

                  {/* Business references the buyer may quote to support are kept.
                      The raw asset UUID and the full SHA-256 dump are not:
                      they are internal identifiers, not customer information. */}
                  <div style={{ display: 'flex', gap: 26, marginTop: 15, flexWrap: 'wrap' }}>
                    <div>
                      <div className="ex-label">Licence</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3, textTransform: 'capitalize' }}>{lic.license_tier}</div>
                    </div>
                    <div>
                      <div className="ex-label">Seal</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{lic.seal_id}</div>
                    </div>
                    <div>
                      <div className="ex-label">Order</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{lic.order_id}</div>
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-heading)' }}>
                    {formatMoney(lic.price_paid, lic.currency)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--emerald)', fontWeight: 600, marginTop: 2, textTransform: 'capitalize' }}>
                    {String(lic.status || 'sealed').toLowerCase()}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {canDownload ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => authorizeDownload(lic)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  >
                    <Download size={16} /> Download licensed file (Hub)
                  </button>
                ) : (
                  <button type="button" className="btn-secondary" disabled>
                    <Download size={16} /> {licenseStatus === 'active' ? 'Delivery pending' : `Blocked (${licenseStatus})`}
                  </button>
                )}
                {/* Opens the real certificate record. This used to call
                    onViewCertificate, which App wired to navigate('my_licenses')
                    — the page the button already sits on, so it did nothing. */}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => openCertificate(lic)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  <FileText size={16} /> Certificate
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => openShare(lic)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  <Share2 size={16} /> Share
                </button>
                {lic.dna_hash_summary && (
                  <span
                    title={`Digital DNA fingerprint: ${lic.dna_hash_summary}`}
                    style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <ShieldCheck size={13} color="var(--emerald)" />
                    DNA {String(lic.dna_hash_summary).slice(0, 10)}…
                  </span>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {shareFor && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !shareBusy && setShareFor(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(3,7,18,0.78)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            className="glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 520, padding: 26 }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', color: '#fff', margin: 0 }}>Share licensed asset</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 6 }}>
                  {shareFor.title || "Protected asset"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !shareBusy && setShareFor(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {!shareResult ? (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '14px 0 18px' }}>
                  The link is created and hosted by Pinit HUB. Every view and download is
                  tracked there, and the master file never leaves the Hub vault.
                </p>

                <div style={{ display: 'grid', gap: 14 }}>
                  <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Expires after (hours) — blank = never
                    <input
                      type="number" min="1" placeholder="e.g. 48"
                      value={shareOpts.expiresIn}
                      onChange={(e) => setShareOpts((s) => ({ ...s, expiresIn: e.target.value }))}
                      style={{ padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.28)', background: 'rgba(8,14,28,0.7)', color: '#e8eef8' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Max views — blank = unlimited
                    <input
                      type="number" min="1" placeholder="e.g. 25"
                      value={shareOpts.maxViews}
                      onChange={(e) => setShareOpts((s) => ({ ...s, maxViews: e.target.value }))}
                      style={{ padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.28)', background: 'rgba(8,14,28,0.7)', color: '#e8eef8' }}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <input
                      type="checkbox" checked={shareOpts.allowDownload}
                      onChange={(e) => setShareOpts((s) => ({ ...s, allowDownload: e.target.checked }))}
                    />
                    Allow the recipient to download
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <input
                      type="checkbox" checked={shareOpts.requireName}
                      onChange={(e) => setShareOpts((s) => ({ ...s, requireName: e.target.checked }))}
                    />
                    Ask the recipient for their name
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <input
                      type="checkbox" checked={shareOpts.requestLocation}
                      onChange={(e) => setShareOpts((s) => ({ ...s, requestLocation: e.target.checked }))}
                    />
                    Ask the recipient for precise location (GPS)
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '-4px 0 0 26px' }}>
                    Without this only approximate city/ISP location from the IP address is recorded.
                  </p>
                </div>

                {shareError && (
                  <p style={{ color: '#fca5a5', fontSize: '0.83rem', marginTop: 14 }}>{shareError}</p>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                  <button type="button" className="btn-primary" onClick={createShare} disabled={shareBusy}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Share2 size={16} /> {shareBusy ? 'Creating…' : 'Create share link'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setShareFor(null)} disabled={shareBusy}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--emerald)', fontSize: '0.88rem', margin: '16px 0 10px' }}>
                  Share link created
                </p>
                <div style={{
                  background: 'rgba(8,14,28,0.75)', border: '1px solid rgba(148,163,184,0.25)',
                  borderRadius: 8, padding: '11px 12px', fontSize: '0.8rem', color: '#e8eef8',
                  wordBreak: 'break-all', fontFamily: 'monospace',
                }}>
                  {shareResult.shareUrl}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-primary" onClick={copyShareUrl}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Copy size={16} /> {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <a className="btn-secondary" href={shareResult.shareUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                    <ExternalLink size={16} /> Open
                  </a>
                  <button type="button" className="btn-secondary" onClick={() => setShareFor(null)}>Done</button>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 14 }}>
                  Activity for this link is tracked in Pinit HUB.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {certFor && (
        <div className="modal-overlay" role="presentation" onClick={() => setCertFor(null)}>
          <div
            className="modal cert-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Digital licence certificate"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Licence certificate</h2>
              <button type="button" className="modal-close" onClick={() => setCertFor(null)} aria-label="Close certificate">
                <X size={18} />
              </button>
            </div>

            <div className="cert-body">
              {certBusy && <p className="cert-loading">Loading certificate…</p>}

              {!certBusy && certError && (
                <div className="ex-alert ex-alert--error" role="alert">
                  <span>{certError}</span>
                </div>
              )}

              {!certBusy && !certError && certData && (
                <>
                  <div className="cert-seal">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>{certData.certificate_type}</strong>
                      <span className="cert-seal__id">{certData.seal_id}</span>
                    </div>
                    <span className={`cert-status cert-status--${String(certData.license_status || '').toLowerCase()}`}>
                      {certData.license_status}
                    </span>
                  </div>

                  <dl className="cert-grid">
                    <div><dt>Asset</dt><dd>{certData.asset_title || '—'}</dd></div>
                    <div><dt>Licence</dt><dd>{certData.license_tier}</dd></div>
                    <div><dt>Order</dt><dd className="mono">{certData.order_id}</dd></div>
                    <div><dt>Paid</dt><dd>{formatMoney(certData.price_paid, certData.currency)}</dd></div>
                    <div><dt>Payment</dt><dd className="cap">{certData.payment_status || '—'}</dd></div>
                    <div><dt>Creator</dt><dd>{certData.seller?.name}</dd></div>
                    <div><dt>Creator ID</dt><dd className="mono">{certData.seller?.pinit_id}</dd></div>
                    <div><dt>Licensed to</dt><dd>{certData.buyer?.name}{certData.buyer?.org ? ` · ${certData.buyer.org}` : ''}</dd></div>
                  </dl>

                  {certData.dna_hash_summary && (
                    <div className="cert-dna">
                      <span className="ex-label">Pinit DNA fingerprint</span>
                      <code>{certData.dna_hash_summary}</code>
                    </div>
                  )}

                  <p className="cert-note">{certData.note}</p>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="ex-btn ex-btn--secondary" onClick={() => setCertFor(null)}>Close</button>
              {certData && (
                <button type="button" className="ex-btn ex-btn--primary" onClick={printCertificate}>
                  <FileText size={16} /> Print / save PDF
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
