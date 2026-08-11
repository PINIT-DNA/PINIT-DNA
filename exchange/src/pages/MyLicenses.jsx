import React, { useState, useEffect } from 'react';
import { ShieldCheck, Download, Award, FileText, ExternalLink } from 'lucide-react';

export default function MyLicenses({ user, onViewCertificate }) {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMyLicenses();
  }, [user?.pinit_id, user?.email]);

  const fetchMyLicenses = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (user?.email) params.set('email', user.email);
      if (user?.pinit_id) params.set('pinit_id', user.pinit_id);
      const res = await fetch(`/api/orders/my-licenses?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLicenses(data.licenses || []);
      }
    } catch (err) {
      console.error('Error fetching licenses:', err);
    } finally {
      setLoading(false);
    }
  };

  const authorizeDownload = async (lic) => {
    try {
      const res = await fetch('/api/orders/download/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seal_id: lic.seal_id,
          buyer_pinit_id: user?.pinit_id,
          buyer_email: user?.email,
          asset_id: lic.asset_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Download not allowed');
      window.open(data.download_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '2.2rem', color: '#fff' }}>My Purchased Licenses</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Download licensed exports from Pinit HUB. Master files never leave the Hub vault.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>Loading My Licenses...</div>
      ) : licenses.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '60px' }}>
          <ShieldCheck size={48} color="var(--text-muted)" style={{ marginBottom: '16px' }} />
          <h3 style={{ color: '#fff' }}>No Purchased Licenses Yet</h3>
          <p style={{ color: 'var(--text-muted)' }}>Explore the marketplace to buy verified provenance licenses.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {licenses.map((lic) => {
            const licenseStatus = String(lic.license_status || 'active').toLowerCase();
            const canDownload = licenseStatus === 'active' && lic.delivery_url;
            return (
            <div key={lic.seal_id} className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <span className="brand-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--emerald)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                      VERIFIED SEAL: {lic.seal_id}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Order: {lic.order_id}</span>
                    <span style={{ fontSize: '0.75rem', color: licenseStatus === 'active' ? 'var(--emerald)' : '#f87171', fontWeight: 700, textTransform: 'uppercase' }}>
                      License {licenseStatus}
                    </span>
                  </div>
                  <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>{lic.asset_title || lic.title || `License #${lic.listing_id}`}</h3>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    License Tier: <strong style={{ color: 'var(--emerald)', textTransform: 'uppercase' }}>{lic.license_tier}</strong>
                    {lic.asset_id && (
                      <span style={{ marginLeft: 10, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        Asset: {lic.asset_id}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff' }}>${lic.price_paid} USD</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--emerald)', fontWeight: 600 }}>
                    {String(lic.status || '').toUpperCase() || 'SEALED'}
                  </div>
                </div>
              </div>

              <div style={{
                background: 'rgba(0,0,0,0.3)',
                padding: '12px 16px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                color: 'var(--text-dim)',
                fontFamily: 'monospace',
                marginBottom: '16px',
                wordBreak: 'break-all',
              }}>
                SHA256 Fingerprint: {lic.dna_hash_summary}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onViewCertificate?.(lic.seal_id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  <FileText size={16} /> Certificate
                </button>
                {lic.badge_tier && (
                  <span className={`badge-${String(lic.badge_tier).toLowerCase()}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Award size={14} /> {lic.badge_tier}
                  </span>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
