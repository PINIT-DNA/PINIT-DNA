import React, { useState, useEffect } from 'react';
import { ShieldCheck, Download, Award, FileText, ExternalLink, Share2, Copy, X, Eye } from 'lucide-react';
import { formatMoney } from '../lib/money.js';
import { apiFetch } from '../lib/api.js';
import EmptyState from '../components/EmptyState.jsx';

/** Hub UI is Vite :3002. Stale env used :3000, which refuses connections. */
function liveHubShareUrl(url) {
  return String(url || '')
    .replace(/:\/\/localhost:3000\b/gi, '://localhost:3002')
    .replace(/:\/\/127\.0\.0\.1:3000\b/gi, '://127.0.0.1:3002');
}

export default function MyLicenses({ user, onViewCertificate, onEnableBuyer, onBrowse }) {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Surfaces download/authorisation failures inline instead of an OS alert.
  const [actionError, setActionError] = useState('');
  /** Licence currently being shared (null = modal closed). */
  const [shareFor, setShareFor] = useState(null);
  const [shareOpts, setShareOpts] = useState({
    expiresPreset: 'never',
    expiresCustom: '',
    viewsPreset: 'unlimited',
    viewsCustom: '',
    allowDownload: true,
    allowPrint: true,
    requireName: false,
    requestLocation: false,
  });
  const [shareBusy, setShareBusy] = useState(false);
  const [shareResult, setShareResult] = useState(null);
  const [shareError, setShareError] = useState('');
  const [copied, setCopied] = useState(false);
  const [certFor, setCertFor] = useState(null);
  const [certData, setCertData] = useState(null);
  const [certBusy, setCertBusy] = useState(false);
  const [certError, setCertError] = useState('');

  useEffect(() => {
    fetchMyLicenses();
  }, [user?.pinit_id]);

  const fetchMyLicenses = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { ok, data, error } = await apiFetch('/api/orders/my-licenses');
      if (ok) setLicenses(data.licenses || []);
      else {
        setLicenses([]);
        setLoadError(error || 'Could not load your purchases. They are still saved — try again.');
      }
    } catch (err) {
      console.error('Error fetching licenses:', err);
      setLicenses([]);
      setLoadError('Could not load your purchases. They are still saved — try again.');
    } finally {
      setLoading(false);
    }
  };

  const openLicensedAccess = async (lic, download) => {
    setActionError('');
    const { ok, data, error } = await apiFetch('/api/orders/download/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seal_id: lic.seal_id,
        asset_id: lic.asset_id,
      }),
    });
    if (!ok) {
      setActionError(error || 'You don\'t have access to this file.');
      return;
    }
    const raw = download
      ? (data?.download_intent_url || data?.share_url)
      : (data?.view_url || data?.share_url);
    const url = liveHubShareUrl(raw);
    if (!url || String(url).includes('/exchange/delivery/')) {
      setActionError('Access is not ready yet. Please try again shortly.');
      return;
    }
    window.location.assign(
      download && !String(url).includes('download=')
        ? `${url}${url.includes('?') ? '&' : '?'}download=1`
        : url,
    );
  };

  const openShare = (lic) => {
    setShareFor(lic);
    setShareOpts({
      expiresPreset: 'never',
      expiresCustom: '',
      viewsPreset: 'unlimited',
      viewsCustom: '',
      allowDownload: true,
      allowPrint: true,
      requireName: false,
      requestLocation: false,
    });
    setShareResult(null);
    setShareError('');
    setCopied(false);
  };

  /**
   * Hub creates and hosts the share link; Exchange only proves the caller owns
   * this seal. All view/download tracking lives in Hub, so nothing is stored here.
   */
  const shareHours = () => {
    if (shareOpts.expiresPreset === 'never') return null;
    if (shareOpts.expiresPreset === 'custom') {
      const n = Number(shareOpts.expiresCustom);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const n = Number(shareOpts.expiresPreset);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const shareMaxViews = () => {
    if (shareOpts.viewsPreset === 'unlimited') return null;
    if (shareOpts.viewsPreset === 'custom') {
      const n = Number(shareOpts.viewsCustom);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const n = Number(shareOpts.viewsPreset);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const createShare = async () => {
    if (!shareFor) return;
    setShareBusy(true);
    setShareError('');
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 48000);
    try {
      const { ok, data, error } = await apiFetch(`/api/commerce/purchases/${encodeURIComponent(shareFor.seal_id)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          options: {
            expiresIn: shareHours(),
            maxViews: shareMaxViews(),
            allowDownload: shareOpts.allowDownload,
            allowPrint: shareOpts.allowPrint,
            requireName: shareOpts.requireName,
            requestLocation: shareOpts.requestLocation,
          },
        }),
      });
      if (ok && data?.shareUrl) {
        setShareResult({
          ...data,
          shareUrl: liveHubShareUrl(data.shareUrl),
          allowDownload: data.allowDownload !== false,
          allowPrint: data.allowPrint !== false,
          maxViews: data.maxViews ?? shareMaxViews(),
          expiresAt: data.expiresAt ?? null,
        });
      } else {
        setShareError(error || 'Couldn\'t create the sharing link.');
      }
    } finally {
      window.clearTimeout(timer);
      setShareBusy(false);
    }
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
      if (shareFor?.seal_id && shareResult.token) {
        apiFetch(`/api/commerce/purchases/${encodeURIComponent(shareFor.seal_id)}/share/copied`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: shareResult.token }),
        }).catch(() => {});
      }
    } catch {
      setShareError('Copy failed — select the link and copy manually.');
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '2.2rem', color: '#fff' }}>My Purchases</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Licensed files stay in the Pinit vault. Open a controlled access link to view or download.
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
      ) : loadError ? (
        <EmptyState
          icon={<ShieldCheck size={28} color="var(--primary)" />}
          title="Couldn't load purchases"
          description={loadError}
          primaryLabel="Try again"
          onPrimary={() => fetchMyLicenses()}
        />
      ) : licenses.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={28} color="var(--primary)" />}
          title="No purchases yet"
          description="Assets you license will appear here."
          primaryLabel="Explore assets"
          onPrimary={() => onBrowse?.('marketplace')}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {licenses.map((lic) => {
            const licenseStatus = String(lic.license_status || 'active').toLowerCase();
            const canDownload = licenseStatus === 'active';
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
                  <>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => openLicensedAccess(lic, false)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      <Eye size={16} /> View licensed asset
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => openLicensedAccess(lic, true)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      <Download size={16} /> Download licensed file
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-secondary" disabled>
                    <Download size={16} /> {`Blocked (${licenseStatus})`}
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
                  <Share2 size={16} /> Share licensed asset
                </button>
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
                  This creates a controlled link to the licensed asset. Views and downloads are recorded.
                </p>

                <div style={{ display: 'grid', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>Link expiration</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {[
                        ['never', 'Never'],
                        ['48', '48 hours'],
                        ['168', '7 days'],
                        ['custom', 'Custom'],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={shareOpts.expiresPreset === id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                          onClick={() => setShareOpts((s) => ({ ...s, expiresPreset: id }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {shareOpts.expiresPreset === 'custom' && (
                      <input
                        type="number"
                        min="1"
                        placeholder="Hours"
                        value={shareOpts.expiresCustom}
                        onChange={(e) => setShareOpts((s) => ({ ...s, expiresCustom: e.target.value }))}
                        style={{ marginTop: 8, width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.28)', background: 'rgba(8,14,28,0.7)', color: '#e8eef8' }}
                      />
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>View limit</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {[
                        ['unlimited', 'Unlimited'],
                        ['1', '1'],
                        ['5', '5'],
                        ['25', '25'],
                        ['custom', 'Custom'],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={shareOpts.viewsPreset === id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                          onClick={() => setShareOpts((s) => ({ ...s, viewsPreset: id }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {shareOpts.viewsPreset === 'custom' && (
                      <input
                        type="number"
                        min="1"
                        placeholder="Max views"
                        value={shareOpts.viewsCustom}
                        onChange={(e) => setShareOpts((s) => ({ ...s, viewsCustom: e.target.value }))}
                        style={{ marginTop: 8, width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.28)', background: 'rgba(8,14,28,0.7)', color: '#e8eef8' }}
                      />
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>Permissions</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                      <input
                        type="checkbox" checked={shareOpts.allowDownload}
                        onChange={(e) => setShareOpts((s) => ({ ...s, allowDownload: e.target.checked }))}
                      />
                      Allow download
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                      <input
                        type="checkbox" checked={shareOpts.allowPrint}
                        onChange={(e) => setShareOpts((s) => ({ ...s, allowPrint: e.target.checked }))}
                      />
                      Allow print
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                      <input
                        type="checkbox" checked={shareOpts.requireName}
                        onChange={(e) => setShareOpts((s) => ({ ...s, requireName: e.target.checked }))}
                      />
                      Ask recipient for their name
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <input
                        type="checkbox" checked={shareOpts.requestLocation}
                        onChange={(e) => setShareOpts((s) => ({ ...s, requestLocation: e.target.checked }))}
                      />
                      Request precise location
                    </label>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '8px 0 0' }}>
                      Approximate country and city are recorded from the request when available.
                      Precise GPS is only stored if the recipient allows it.
                    </p>
                  </div>
                </div>

                {shareError && (
                  <p role="alert" style={{ color: '#fca5a5', fontSize: '0.83rem', marginTop: 14 }}>{shareError}</p>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                  <button type="button" className="btn-primary" onClick={createShare} disabled={shareBusy}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Share2 size={16} /> {shareBusy ? 'Creating…' : 'Create secure link'}
                  </button>
                  {shareError && (
                    <button type="button" className="btn-secondary" onClick={createShare} disabled={shareBusy}>
                      Try again
                    </button>
                  )}
                  <button type="button" className="btn-secondary" onClick={() => setShareFor(null)} disabled={shareBusy}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--emerald)', fontSize: '0.88rem', margin: '16px 0 10px' }}>
                  ✓ Secure link created
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 12px' }}>
                  {(shareFor.title || shareFor.asset_title || 'Your licensed asset')} can now be shared through Pinit.
                </p>
                <div style={{
                  background: 'rgba(8,14,28,0.75)', border: '1px solid rgba(148,163,184,0.25)',
                  borderRadius: 8, padding: '11px 12px', fontSize: '0.8rem', color: '#e8eef8',
                  wordBreak: 'break-all',
                }}>
                  {shareResult.shareUrl}
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 12 }}>
                  Expires: {shareResult.expiresAt ? new Date(shareResult.expiresAt).toLocaleString() : 'Never'}
                  {' · '}Views allowed: {shareResult.maxViews != null ? shareResult.maxViews : 'Unlimited'}
                  {' · '}Download: {shareResult.allowDownload ? 'Allowed' : 'Off'}
                  {' · '}Print: {shareResult.allowPrint ? 'Allowed' : 'Off'}
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-primary" onClick={copyShareUrl}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Copy size={16} /> {copied ? 'Copied' : 'Copy secure link'}
                  </button>
                  <a className="btn-secondary" href={shareResult.shareUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                    <ExternalLink size={16} /> Open link
                  </a>
                  <button type="button" className="btn-secondary" onClick={() => setShareFor(null)}>Done</button>
                </div>
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
