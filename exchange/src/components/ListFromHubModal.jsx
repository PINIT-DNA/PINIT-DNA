import React, { useState, useEffect } from 'react';
import { X, ShieldAlert, Award, Lock, Sparkles, AlertCircle, CheckCircle, Info, ExternalLink } from 'lucide-react';
import { canList } from '../lib/roles.js';

export default function ListFromHubModal({
  isOpen,
  onClose,
  onListingCreated,
  user,
  preselectedAssetId = null,
  hubAppUrl = 'http://localhost:3000',
}) {
  const [hubAssets, setHubAssets] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [fetchMessage, setFetchMessage] = useState('');
  const [hubProtectUrl, setHubProtectUrl] = useState(`${hubAppUrl}/generate`);

  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [vertical, setVertical] = useState('images');
  const [humanPercent, setHumanPercent] = useState(90);
  const [aiPercent, setAiPercent] = useState(10);
  const [previewUrl, setPreviewUrl] = useState('');

  const [pricePersonal, setPricePersonal] = useState(49);
  const [priceCommercial, setPriceCommercial] = useState(149);
  const [priceExclusive, setPriceExclusive] = useState(899);
  const [priceEnterprise, setPriceEnterprise] = useState(2499);
  const [aiOptOut, setAiOptOut] = useState(true);

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (!canList(user)) {
        setHubAssets([]);
        setFetchMessage('Buyer accounts cannot list Hub assets on Exchange.');
        return;
      }
      fetchHubAssets();
      setErrorMsg('');
      setSuccessMsg('');
    }
  }, [isOpen, user?.pinit_id]);

  const fetchHubAssets = async () => {
    if (!user?.pinit_id) {
      setHubAssets([]);
      setFetchMessage('Sign in with Pinit HUB to load your protected vault assets.');
      return;
    }
    setFetching(true);
    setFetchMessage('');
    try {
      const res = await fetch(`/api/hub/assets?pinit_id=${encodeURIComponent(user.pinit_id)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to load Hub assets');
      }
      const rows = Array.isArray(data) ? data : (data.assets || []);
      setHubAssets(rows);
      if (data.hub_protect_url) setHubProtectUrl(data.hub_protect_url);
      if (data.message) setFetchMessage(data.message);

      const preferred =
        (preselectedAssetId && rows.find((a) => a.asset_id === preselectedAssetId)) ||
        rows[0];
      if (preferred) {
        setSelectedAssetId(preferred.asset_id);
        populateAssetDetails(preferred);
      } else {
        setSelectedAssetId('');
      }
    } catch (err) {
      console.error('Error fetching Hub assets:', err);
      setErrorMsg(err.message || 'Could not reach Pinit HUB for vault assets.');
      setHubAssets([]);
    } finally {
      setFetching(false);
    }
  };

  const populateAssetDetails = (asset) => {
    setTitle(asset.title || '');
    setTagline('');
    setTagsInput('');
    const v = asset.vertical || asset.file_type || 'images';
    setVertical(v === 'image' ? 'images' : v === 'documents' || v === 'document' ? 'concepts' : v);
    setHumanPercent(asset.human_percent != null ? Number(asset.human_percent) : 90);
    setAiPercent(asset.ai_percent != null ? Number(asset.ai_percent) : 10);
    if (asset.preview_url) setPreviewUrl(asset.preview_url);
  };

  let predictedBadge = 'Bronze';
  if (humanPercent >= 90) predictedBadge = 'Gold';
  else if (humanPercent >= 60) predictedBadge = 'Silver';

  const isAiBlocked = aiPercent > 80;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!user?.hub_linked && !user?.pinit_id) {
      setErrorMsg('Sellers must Continue with Pinit HUB before listing.');
      return;
    }
    if (!selectedAssetId) {
      setErrorMsg('Select a vault-protected asset from Pinit HUB. Protect new work in Hub first.');
      return;
    }
    if (isAiBlocked) {
      setErrorMsg('This asset exceeds the 80% AI-content limit and cannot be listed on Pinit Exchange.');
      return;
    }

    setLoading(true);

    try {
      const hubListToken = sessionStorage.getItem('pinit_hub_list_token') || undefined;
      const listRes = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: selectedAssetId,
          pinit_id: user.pinit_id,
          title: title.trim() || 'Untitled listing',
          tagline: tagline.trim(),
          description: description.trim(),
          vertical,
          tags: tagsInput.trim() || `${vertical},pinit,verified,provenance`,
          price_personal: pricePersonal,
          price_commercial: priceCommercial,
          price_exclusive: priceExclusive,
          price_enterprise: priceEnterprise,
          ai_training_opt_out: aiOptOut,
          human_percent: humanPercent,
          ai_percent: aiPercent,
          hub_list_token: hubListToken,
        }),
      });

      const listData = await listRes.json();
      if (listRes.ok) {
        sessionStorage.removeItem('pinit_hub_list_token');
      }

      if (!listRes.ok) {
        if (listData.error === 'AI_POLICY_VIOLATION') {
          setErrorMsg(listData.message);
        } else {
          setErrorMsg(listData.error || listData.message || 'Failed to publish listing to Exchange');
        }
        setLoading(false);
        return;
      }

      setSuccessMsg(`Listing published with ${listData.badge_assigned} Badge. Opening marketplace…`);
      setLoading(false);
      setTimeout(() => {
        onListingCreated?.(listData.listing || { listing_id: listData.listing?.listing_id, vertical });
        onClose();
      }, 900);
    } catch (err) {
      setErrorMsg(err.message || 'An unexpected error occurred');
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.15)', padding: '10px', borderRadius: '10px', display: 'flex' }}>
              <Lock size={20} color="var(--primary)" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>List on Pinit Exchange</h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Choose a file already protected in Pinit HUB. Exchange does not open your computer folders.
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
            <X size={22} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="modal-body">
            {errorMsg && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#f87171',
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '18px',
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <AlertCircle size={20} />
                <div>{errorMsg}</div>
              </div>
            )}

            {successMsg && (
              <div style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#34d399',
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '18px',
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <CheckCircle size={20} />
                <div>{successMsg}</div>
              </div>
            )}

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Your Hub vault {fetching ? '(loading…)' : hubAssets.length ? `(${hubAssets.length})` : ''}
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={fetchHubAssets}
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                >
                  Refresh from Hub
                </button>
              </div>

              {fetching && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading protected files from Pinit HUB…</p>
              )}

              {!fetching && hubAssets.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: 10,
                    maxHeight: 280,
                    overflowY: 'auto',
                    padding: 2,
                  }}
                >
                  {hubAssets.map((asset) => {
                    const selected = selectedAssetId === asset.asset_id;
                    return (
                      <button
                        key={asset.asset_id}
                        type="button"
                        onClick={() => {
                          setSelectedAssetId(asset.asset_id);
                          setErrorMsg('');
                          populateAssetDetails(asset);
                        }}
                        style={{
                          textAlign: 'left',
                          border: selected ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                          background: selected ? 'rgba(59, 130, 246, 0.14)' : 'rgba(15, 23, 42, 0.7)',
                          borderRadius: 10,
                          padding: 0,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          color: '#fff',
                        }}
                      >
                        <div style={{ height: 88, background: '#0b1220', overflow: 'hidden' }}>
                          {asset.preview_url ? (
                            <img
                              src={asset.preview_url}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
                              <Lock size={18} />
                            </div>
                          )}
                        </div>
                        <div style={{ padding: '8px 10px' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {asset.title}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3 }}>
                            {asset.badge_tier} · {asset.human_percent ?? '—'}% human
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {!fetching && hubAssets.length === 0 && (
                <div style={{
                  background: 'rgba(99,102,241,0.1)',
                  border: '1px solid rgba(99,102,241,0.35)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '18px',
                }}>
                  <div style={{ color: '#fff', fontWeight: 600, marginBottom: 8 }}>No Hub assets yet</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 12 }}>
                    Protect the file in Pinit HUB first. Then it appears here — do not pick from your computer folders.
                  </p>
                  {fetchMessage && (
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 12 }}>{fetchMessage}</p>
                  )}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <a
                      className="btn-primary"
                      href={`${hubAppUrl}/vault`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      Open Digital Assets <ExternalLink size={14} />
                    </a>
                    <a
                      className="btn-secondary"
                      href={hubProtectUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      Protect a new file
                    </a>
                  </div>
                </div>
              )}
            </div>

            {selectedAssetId && (
              <>
                <div className="form-group" style={{
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                }}>
                  <label className="form-label" style={{ marginBottom: 4 }}>Hub Asset ID</label>
                  <div style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: '0.85rem',
                    color: 'var(--primary)',
                    fontWeight: 600,
                    wordBreak: 'break-all',
                  }}>
                    {selectedAssetId}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 4, display: 'block' }}>
                    This vault asset ID stays linked on the Exchange listing after publish.
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Listing Title</label>
                    <input
                      type="text"
                      className="form-input"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Give buyers a clear, professional title"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Vertical / Category</label>
                    <select className="form-select" value={vertical} onChange={(e) => setVertical(e.target.value)}>
                      <option value="images">Photography / Images</option>
                      <option value="video">Video / Film</option>
                      <option value="ui_ux">UI/UX Components</option>
                      <option value="3d">3D Models</option>
                      <option value="audio">Audio</option>
                      <option value="concepts">Concepts & Documents</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Tagline</label>
                  <input
                    type="text"
                    className="form-input"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="One line that sells the shot — like stock agencies"
                    maxLength={120}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Tags / keywords</label>
                  <input
                    type="text"
                    className="form-input"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="cinematic, drone, golden-hour, commercial, 8k"
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4, display: 'block' }}>
                    Comma-separated — shown as chips on marketplace cards and used in search.
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label">Description & Provenance Notes</label>
                  <textarea
                    className="form-textarea"
                    rows="2"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Usage rights notes, shoot context, what’s included…"
                  />
                </div>

                <div style={{
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '18px',
                  marginBottom: '20px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sparkles size={16} color="var(--indigo)" />
                      Authenticity (from Hub DNA)
                    </div>
                    <span className={`badge-${predictedBadge.toLowerCase()}`}>
                      <Award size={12} /> {predictedBadge} Badge
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span>Human: <strong style={{ color: 'var(--emerald)' }}>{humanPercent}%</strong></span>
                    <span>AI: <strong style={{ color: isAiBlocked ? '#ef4444' : 'var(--primary)' }}>{aiPercent}%</strong></span>
                  </div>
                  {isAiBlocked ? (
                    <div style={{
                      marginTop: 12,
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid #ef4444',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      color: '#fca5a5',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}>
                      <ShieldAlert size={20} color="#ef4444" />
                      Exceeds 80% AI limit — cannot list.
                    </div>
                  ) : (
                    <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Info size={14} color="var(--primary)" />
                      Scores come from Pinit HUB protection — edit authenticity in Hub if needed.
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label className="form-label" style={{ marginBottom: '10px' }}>License Tier Pricing ($ USD)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Personal</span>
                      <input type="number" className="form-input" value={pricePersonal} onChange={(e) => setPricePersonal(Number(e.target.value))} />
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Commercial</span>
                      <input type="number" className="form-input" value={priceCommercial} onChange={(e) => setPriceCommercial(Number(e.target.value))} />
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Exclusive</span>
                      <input type="number" className="form-input" value={priceExclusive} onChange={(e) => setPriceExclusive(Number(e.target.value))} />
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Enterprise</span>
                      <input type="number" className="form-input" value={priceEnterprise} onChange={(e) => setPriceEnterprise(Number(e.target.value))} />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isAiBlocked || loading || !selectedAssetId}
            >
              {loading ? 'Publishing...' : 'Publish to Exchange'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
