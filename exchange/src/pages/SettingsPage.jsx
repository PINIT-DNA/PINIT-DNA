import React, { useState } from 'react';
import { User, Store, ShieldCheck, CreditCard, Bell, Lock, Sliders, CheckCircle, RefreshCw } from 'lucide-react';

export default function SettingsPage({ user, onUserUpdated }) {
  const [activeTab, setActiveTab] = useState('account');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');

  // Form states
  const [name, setName] = useState(user?.name || 'Elena Rostova');
  const [email, setEmail] = useState(user?.email || 'elena.rostova@pinit.io');
  const [bio, setBio] = useState(user?.bio || 'Award-winning architectural photographer and digital artist creating high-provenance visual assets.');
  const [sellerPlan, setSellerPlan] = useState(user?.seller_plan || 'pro');
  const [exchangeId, setExchangeId] = useState(user?.exchange_id || 'PX-772091');
  const [biometricVerified, setBiometricVerified] = useState(user?.biometric_verified !== undefined ? Boolean(user.biometric_verified) : true);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/onboard-seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pinit_id: user?.pinit_id || 'PINIT-90481234',
          name: name,
          email: email,
          bio: bio,
          seller_plan: sellerPlan
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSaveSuccessMsg('Settings updated successfully!');
        if (onUserUpdated) onUserUpdated(data.user);
        setTimeout(() => setSaveSuccessMsg(''), 3000);
      }
    } catch (err) {
      console.error("Error updating settings:", err);
    }
  };

  const tabs = [
    { id: 'account', label: 'Account Profile', icon: User },
    { id: 'storefront', label: 'Public Storefront', icon: Store },
    { id: 'verification', label: 'Seller Verification', icon: ShieldCheck },
    { id: 'billing', label: 'Billing & Payouts', icon: CreditCard },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security & Sessions', icon: Lock },
    { id: 'preferences', label: 'Default Presets', icon: Sliders }
  ];

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '2.2rem', color: '#fff' }}>Platform &amp; Seller Settings</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Manage your Pinit identity, storefront, biometric KYC verification, and billing.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '32px' }}>
        {/* Sidebar Tabs */}
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: activeTab === tab.id ? 'var(--primary)' : 'transparent',
                    color: activeTab === tab.id ? '#fff' : 'var(--text-muted)',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Icon size={18} /> {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content Panel */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          {saveSuccessMsg && (
            <div style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle size={18} /> {saveSuccessMsg}
            </div>
          )}

          <form onSubmit={handleSaveSettings}>
            {activeTab === 'account' && (
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '20px' }}>Account Profile</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required />
                  </div>

                </div>

                <div className="form-group">
                  <label className="form-label">Main Platform Pinit ID</label>
                  <input type="text" className="form-input" value={user?.pinit_id || 'PINIT-90481234'} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>Shared identity between Pinit HUB Vault &amp; Pinit Exchange.</span>
                </div>
              </div>
            )}

            {activeTab === 'storefront' && (
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '20px' }}>Public Storefront</h3>
                <div className="form-group">
                  <label className="form-label">Creator Biography &amp; Provenance Story</label>
                  <textarea className="form-textarea" rows="4" value={bio} onChange={e => setBio(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Primary Creative Vertical</label>
                  <select className="form-select">
                    <option value="images">Architectural &amp; Landscape Photography</option>
                    <option value="video">8K RED / Drone Cinema Video</option>
                    <option value="ui_ux">UI/UX Systems &amp; Frameworks</option>
                    <option value="3d">3D Models &amp; PBR Textures</option>
                    <option value="audio">Audio Stems &amp; Soundscapes</option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'verification' && (
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '20px' }}>Seller Onboarding &amp; Verification</h3>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#fff', fontSize: '1rem' }}>Exchange Seller ID</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Unique commerce identity minted upon seller onboarding.</div>
                    </div>
                    <span style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--primary)', padding: '4px 12px', borderRadius: '99px', fontWeight: 700, fontSize: '0.9rem' }}>
                      {exchangeId}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.9rem' }}>Biometric ID Check</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Pinit HUB biometric match verification.</div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={biometricVerified} onChange={e => setBiometricVerified(e.target.checked)} style={{ accentColor: 'var(--emerald)' }} />
                      <span style={{ color: 'var(--emerald)', fontWeight: 600, fontSize: '0.85rem' }}>Matched</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'billing' && (
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '20px' }}>Seller Subscriptions &amp; Payout Bank</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                  {['pro', 'enterprise_pro'].map(plan => (
                    <div 
                      key={plan}
                      onClick={() => setSellerPlan(plan)}
                      style={{
                        border: sellerPlan === plan ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: sellerPlan === plan ? 'rgba(59, 130, 246, 0.1)' : 'rgba(0,0,0,0.2)',
                        padding: '16px',
                        borderRadius: '8px',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ fontWeight: 700, color: '#fff', fontSize: '1rem', textTransform: 'uppercase' }}>{plan.replace('_', ' ')} PLAN</div>
                      <div style={{ color: 'var(--emerald)', fontWeight: 800, fontSize: '1.2rem', margin: '4px 0' }}>
                        {plan === 'pro' ? '$29 / mo' : '$99 / mo'}
                      </div>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {plan === 'pro' ? 'Unlimited listings + 85% creator net payout' : 'Unlimited listings + Priority SLA + 90% net payout'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '20px' }}>Notification Preferences</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#fff', fontSize: '0.9rem' }}>
                    <input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} /> Instant Sale Sealed Email Notifications
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#fff', fontSize: '0.9rem' }}>
                    <input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} /> New Buyer Brief Match Alerts
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#fff', fontSize: '0.9rem' }}>
                    <input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} /> Hub Post-Sale Tracking Alerts
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '20px' }}>Security &amp; Linked Hub Account</h3>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px', fontSize: '0.88rem' }}>
                  Linked Pinit HUB Vault ID: <strong style={{ color: 'var(--primary)' }}>HUB-VAULT-90481234</strong> (Active Session)
                </div>
              </div>
            )}

            {activeTab === 'preferences' && (
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '20px' }}>Default License Pricing Presets</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Default prices applied when listing new assets from Pinit HUB.</p>
              </div>
            )}

            <div style={{ marginTop: '28px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn-primary">Save Settings</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
