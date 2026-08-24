import React, { useState } from 'react';
import { Building2, ShieldCheck, FileText, CheckCircle, DollarSign } from 'lucide-react';
import InfoPage, { InfoCards, InfoSteps } from '../components/InfoPage.jsx';
import { HUB_APP_URL } from '../lib/exchange-routes.js';

export default function EnterpriseLicensing({ onNavigate }) {
  const [seats, setSeats] = useState(50);
  const [indemnity, setIndemnity] = useState('5000000');
  const [orgName, setOrgName] = useState('Global Media Corp');
  const [submitted, setSubmitted] = useState(false);

  const calculateEstimate = () => {
    let base = seats * 180;
    if (indemnity === 'unlimited') base += 2500;
    return base;
  };

  const handleSubmitPO = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={[{ label: 'Business', page: 'sell' }, { label: 'Enterprise' }]}
      eyebrow="Enterprise"
      title="Creative asset commerce built for teams"
      subtitle="For creative teams, marketing, agencies, media companies, game studios, brands, and enterprises that need protection, licensing, and delivery in one path."
      related={[
        { page: 'security', label: 'Security', desc: 'Access and privacy' },
        { page: 'trust', label: 'Trust Center', desc: 'Hub + Exchange model' },
        { page: 'creator_support', label: 'Support', desc: 'Talk to the team' },
      ]}
      primaryCta={{ label: 'Talk to Pinit', onClick: () => document.getElementById('enterprise-contact')?.scrollIntoView({ behavior: 'smooth' }) }}
      secondaryCta={{ label: 'Explore Pinit HUB', onClick: () => window.open(HUB_APP_URL, '_blank', 'noopener,noreferrer') }}
    >
      <InfoCards
        items={[
          { icon: ShieldCheck, title: 'Asset protection', body: 'Hub vaults the original. Teams license usage on Exchange.' },
          { icon: FileText, title: 'Licensing', body: 'Personal through enterprise seats, with a sealed record per purchase.' },
          { icon: Building2, title: 'Team collaboration', body: 'Business accounts on Hub; Exchange listings stay tied to the same identity code.' },
          { icon: DollarSign, title: 'Secure delivery', body: 'Authorized assets come from Hub after checkout — not an open file dump.' },
        ]}
      />

      <h2>Enterprise workflow</h2>
      <InfoSteps
        steps={[
          { title: 'Create / Import', body: 'Bring work into Pinit HUB.' },
          { title: 'Protect', body: 'Vault the asset and record Asset DNA.' },
          { title: 'Collaborate', body: 'Review inside the team before it is offered for license.' },
          { title: 'Approve', body: 'Decide what can be listed and at which tier.' },
          { title: 'License', body: 'Buyers or internal teams complete Exchange checkout.' },
          { title: 'Deliver', body: 'Hub authorizes the licensed package.' },
          { title: 'Monitor', body: 'Keep watching for copies after delivery.' },
        ]}
      />

      <h2 id="enterprise-contact">Request a conversation</h2>
      <p>The form below is an estimate request already in the product. It is not a binding purchase order until Pinit confirms terms with you.</p>

      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(59, 130, 246, 0.15)',
          padding: '6px 16px',
          borderRadius: '99px',
          color: 'var(--primary)',
          fontSize: '0.85rem',
          fontWeight: 700,
          marginBottom: '16px'
        }}>
          <Building2 size={16} /> INSTITUTIONAL BULK LICENSING
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '32px' }}>
        {/* Estimator & PO Form */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <h3 style={{ fontSize: '1.3rem', color: '#fff', marginBottom: '20px' }}>Configure Enterprise SLA</h3>

          {submitted ? (
            <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '24px', borderRadius: '12px', textAlign: 'center' }}>
              <CheckCircle size={40} color="var(--emerald)" style={{ marginBottom: '12px' }} />
              <h4 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '8px' }}>Purchase Order Submitted!</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '16px' }}>
                PO Request <code>PO-ENT-{Math.floor(100000 + Math.random() * 900000)}</code> for <strong>{orgName}</strong> has been logged to the Pinit Enterprise desk. Our team will issue your verified seat package within 2 business hours.
              </p>
              <button className="btn-secondary" onClick={() => setSubmitted(false)}>Submit Another SLA Request</button>
            </div>
          ) : (
            <form onSubmit={handleSubmitPO}>
              <div className="form-group">
                <label className="form-label">Organization / Entity Name</label>
                <input type="text" className="form-input" value={orgName} onChange={e => setOrgName(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Number of Team Seats</label>
                <input type="number" min="10" max="10000" className="form-input" value={seats} onChange={e => setSeats(Number(e.target.value))} required />
              </div>

              <div className="form-group">
                <label className="form-label">Enterprise protection coverage (demo)</label>
                <select className="form-select" value={indemnity} onChange={e => setIndemnity(e.target.value)}>
                  <option value="standard">Standard enterprise license protection</option>
                  <option value="premium">Premium enterprise protection coverage</option>
                  <option value="custom">Custom institutional terms (contact sales)</option>
                </select>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 6 }}>
                  Demo selector — not a legal indemnity or insurance guarantee.
                </p>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  <span>Estimated Institutional License SLA:</span>
                  <strong style={{ color: 'var(--emerald)', fontSize: '1.2rem' }}>${calculateEstimate().toLocaleString()} USD / yr</strong>
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Includes master RAW vault key delegation, dedicated SLA, and corporate PO billing.</span>
              </div>

              <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
                Generate &amp; Submit Corporate Purchase Order (PO)
              </button>
            </form>
          )}
        </div>

        {/* Benefits Summary */}
        <div>
          <div className="glass-panel" style={{ padding: '24px', marginBottom: '20px' }}>
            <h4 style={{ fontSize: '1.1rem', color: '#fff', marginBottom: '12px' }}>Enterprise SLA Package Includes</h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle size={16} color="var(--emerald)" /> Unlimited multi-seat deployment across regional offices</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle size={16} color="var(--emerald)" /> SHA-256 asset DNA audit logs for licensed masters</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle size={16} color="var(--emerald)" /> Net 30/60 Invoicing &amp; Corporate PO billing</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle size={16} color="var(--emerald)" /> Dedicated Pinit HUB compliance officer</li>
            </ul>
          </div>
        </div>
      </div>
      </div>
    </InfoPage>
  );
}
