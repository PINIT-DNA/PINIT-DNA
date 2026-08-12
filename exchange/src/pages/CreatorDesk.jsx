import React, { useState, useEffect } from 'react';
import { DollarSign, Eye, Bookmark, Layers, ShieldCheck, FileCheck, PlusCircle, Award, Activity, Search, RefreshCw, Send, CheckCircle } from 'lucide-react';
import { canList } from '../lib/roles.js';

export default function CreatorDesk({ user, onOpenListFromHub, onOpenAuth, hubAppUrl: hubAppUrlProp }) {
  const [deskData, setDeskData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [proposalSuccessMsg, setProposalSuccessMsg] = useState('');
  const [monitorSummaries, setMonitorSummaries] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [couponCode, setCouponCode] = useState('');
  const [couponPercent, setCouponPercent] = useState(10);
  const [couponMsg, setCouponMsg] = useState('');
  const hubAppUrl = (hubAppUrlProp || import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  useEffect(() => {
    if (!user?.pinit_id || !canList(user)) {
      setLoading(false);
      setDeskData(null);
      return;
    }
    fetchDeskData();
    fetchMonitoring();
    fetchCoupons();
  }, [user]);

  const fetchDeskData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/creator/desk?pinit_id=${encodeURIComponent(user.pinit_id)}`);
      if (res.ok) {
        const data = await res.json();
        setDeskData(data);
      }
    } catch (err) {
      console.error('Error fetching creator desk data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMonitoring = async () => {
    try {
      const res = await fetch(`/api/hub/monitoring-summaries?pinit_id=${encodeURIComponent(user.pinit_id)}`);
      if (res.ok) {
        const data = await res.json();
        setMonitorSummaries(data.summaries || []);
      }
    } catch {
      /* non-fatal */
    }
  };

  const fetchCoupons = async () => {
    try {
      const res = await fetch(`/api/commerce/coupons?seller_pinit_id=${encodeURIComponent(user.pinit_id)}`);
      if (res.ok) {
        const data = await res.json();
        setCoupons(data.coupons || []);
      }
    } catch {
      /* non-fatal */
    }
  };

  const createCoupon = async (e) => {
    e.preventDefault();
    setCouponMsg('');
    try {
      const res = await fetch('/api/commerce/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: couponCode,
          seller_pinit_id: user.pinit_id,
          percent_off: couponPercent,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCouponMsg(data.error || 'Could not create coupon');
        return;
      }
      setCouponCode('');
      setCouponMsg(`Coupon ${data.code} live (${data.percent_off}% off)`);
      fetchCoupons();
    } catch (err) {
      setCouponMsg(err.message);
    }
  };

  const handleSubmitProposal = async (reqId) => {
    try {
      const res = await fetch(`/api/requirements/${reqId}/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pinit-Id': user.pinit_id },
        body: JSON.stringify({ pinit_id: user.pinit_id }),
      });
      if (res.ok) {
        setProposalSuccessMsg(`Proposal submitted to brief ${reqId}`);
        fetchDeskData();
        setTimeout(() => setProposalSuccessMsg(''), 3000);
      }
    } catch (err) {
      console.error("Error submitting proposal:", err);
    }
  };

  if (!user) {
    return (
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <h2 style={{ color: '#fff', marginBottom: 10 }}>Creator Desk</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
          Sellers must have a Pinit HUB account. Protect creations in Hub, list them here, and monitor in Hub.
        </p>
        <button className="btn-primary" onClick={() => onOpenAuth?.({ mode: 'signup', intent: 'creator' })}>
          Continue with Pinit HUB
        </button>
      </div>
    );
  }

  if (!canList(user)) {
    return (
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <h2 style={{ color: '#fff', marginBottom: 10 }}>Creator tools</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
          Buyer accounts cannot access the seller dashboard. Become a Creator to list and manage sales.
        </p>
        <button className="btn-primary" onClick={() => onOpenAuth?.({ mode: 'signup', intent: 'creator' })}>
          Become a Creator
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '60px 24px', color: 'var(--text-muted)', textAlign: 'center' }}>
        Loading Creator Desk Analytics...
      </div>
    );
  }

  const { metrics, listings, sealed_sales, tracking_jobs, requirements } = deskData || {};
  const needsHub = !Number(user.hub_linked);

  return (
    <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '32px 24px' }}>
      {needsHub && (
        <div
          className="glass-panel"
          style={{
            padding: '18px 20px',
            marginBottom: 24,
            border: '1px solid rgba(99,102,241,0.35)',
            background: 'rgba(99,102,241,0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ color: '#fff', fontWeight: 700, marginBottom: 4 }}>Link Pinit HUB to sell</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Exchange sellers must use a real Pinit HUB account. Protect originals in the vault, list licenses here, monitor misuse in Hub.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn-primary" type="button" onClick={() => onOpenAuth?.({ mode: 'signup', intent: 'creator' })}>
              Continue with Pinit HUB
            </button>
          </div>
        </div>
      )}

      {!needsHub && (user.onboarding_step === 'protect_in_hub') && (
        <div
          className="glass-panel"
          style={{
            padding: '18px 20px',
            marginBottom: 24,
            border: '1px solid rgba(59,130,246,0.35)',
            background: 'rgba(59,130,246,0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ color: '#fff', fontWeight: 700, marginBottom: 4 }}>Sell a protected file</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              1) Protect in Hub if needed → 2) Open Digital Assets → 3) List on Exchange → 4) Set price &amp; publish. Monitoring stays in Hub.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a className="btn-primary" href={`${hubAppUrl}/vault`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              Open Digital Assets
            </a>
            <button className="btn-secondary" onClick={onOpenListFromHub}>
              List from Pinit HUB
            </button>
            <a className="btn-secondary" href={`${hubAppUrl}/generate`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              Protect a new file
            </a>
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: '2.2rem', color: '#fff' }}>Seller overview</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Monetize Hub-protected assets on Exchange. Open Pinit HUB for vault, DNA, and monitoring.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn-secondary" href={`${hubAppUrl}/`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            Open Pinit HUB
          </a>
          <button className="btn-primary" onClick={onOpenListFromHub}>
            <PlusCircle size={18} /> List asset
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '24px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '8px' }}>
            <span>Revenue</span>
            <DollarSign size={18} color="var(--emerald)" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--emerald)' }}>
            ${metrics?.total_net_revenue || 0}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Gross ${metrics?.total_gross_revenue || 0}</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '8px' }}>
            <span>Active listings</span>
            <Layers size={18} color="var(--primary)" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff' }}>
            {metrics?.active_listings_count || 0}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{(listings || []).length} total</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '8px' }}>
            <span>Licenses sold</span>
            <ShieldCheck size={18} color="var(--indigo)" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff' }}>
            {metrics?.sealed_sales_count || 0}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Sealed sales</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '8px' }}>
            <span>Monitoring alerts</span>
            <Activity size={18} color="var(--cyan)" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff' }}>
            {monitorSummaries?.length || metrics?.total_views || 0}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{metrics?.total_views || 0} marketplace views</span>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: 16, marginBottom: 24, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <span style={{ color: 'var(--emerald)' }}>● Protected assets linked via Hub</span>
        <span style={{ color: 'var(--primary)' }}>● Monitoring stays in Pinit HUB</span>
        <span style={{ color: 'var(--badge-gold)' }}>● Exchange = licenses &amp; sales only</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border-subtle)', marginBottom: '24px' }}>
        {[
          { id: 'overview', label: 'Overview & Activity' },
          { id: 'listings', label: `My Listings (${listings?.length || 0})` },
          { id: 'sales', label: `Sealed Sales Ledger (${sealed_sales?.length || 0})` },
          { id: 'earnings', label: 'Earnings & Payouts' },
          { id: 'tracking', label: `Hub Alerts (${monitorSummaries.length || tracking_jobs?.length || 0})` },
          { id: 'requirements', label: `Buyer Requirements (${requirements?.length || 0})` }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'none',
              color: activeTab === tab.id ? '#fff' : 'var(--text-muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {proposalSuccessMsg && (
        <div style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '0.88rem' }}>
          {proposalSuccessMsg}
        </div>
      )}

      {/* Tab Contents */}
      {activeTab === 'overview' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '16px' }}>Recent Desk Activity</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sealed_sales?.map(s => (
              <div key={s.seal_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '14px 18px', borderRadius: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <ShieldCheck size={20} color="var(--emerald)" />
                  <div>
                    <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.92rem' }}>Sale Sealed: {s.seal_id}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Buyer: {s.buyer_name} ({s.buyer_org}) • License: {s.license_tier.toUpperCase()}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'var(--emerald)', fontWeight: 800, fontSize: '1rem' }}>+${s.creator_net} USD</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Net Earnings</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'listings' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '16px' }}>My Active & Paused Listings</h3>
          <div className="listings-grid">
            {listings?.map(item => (
              <div key={item.listing_id} className="glass-card" style={{ cursor: 'default' }}>
                <div className="card-media-wrapper" style={{ height: '160px' }}>
                  <img src={item.preview_url || 'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=800&q=80'} alt={item.title} className="card-media" />
                  <div className="card-badge-container">
                    <span className={`badge-${item.badge_tier.toLowerCase()}`}>
                      <Award size={12} /> {item.badge_tier}
                    </span>
                  </div>
                </div>
                <div className="card-body">
                  <h4 style={{ fontSize: '1rem', color: '#fff', marginBottom: '4px' }}>{item.title}</h4>
                  <div style={{
                    fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '8px',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    wordBreak: 'break-all',
                  }}>
                    Asset: <span style={{ color: 'var(--primary)' }}>{item.asset_id}</span>
                    <br />
                    Listing: {item.listing_id}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    Personal: ${item.price_personal} | Commercial: ${item.price_commercial}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem' }}>
                    <span style={{
                      color: (item.status === 'live' || item.status === 'published')
                        ? 'var(--emerald)'
                        : item.status === 'sold_exclusive'
                          ? 'var(--badge-gold)'
                          : 'var(--text-muted)',
                      fontWeight: 700,
                    }}>
                      ● {(item.status === 'live' ? 'published' : item.status || 'draft').toUpperCase()}
                    </span>
                    <span style={{ color: 'var(--text-dim)' }}>{item.views || 0} Views</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'sales' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '8px' }}>Sealed Sales Ledger</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Append-only tamper-proof provenance log of all completed purchases.
          </p>
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Seal ID</th>
                <th>Order ID</th>
                <th>Buyer Name / Org</th>
                <th>License Tier</th>
                <th>Gross Paid</th>
                <th>Platform Fee (15%)</th>
                <th>Creator Net (85%)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sealed_sales?.map(s => (
                <tr key={s.seal_id}>
                  <td style={{ color: 'var(--primary)', fontWeight: 700 }}>{s.seal_id}</td>
                  <td>{s.order_id}</td>
                  <td>{s.buyer_name} ({s.buyer_org})</td>
                  <td style={{ textTransform: 'uppercase', color: 'var(--emerald)' }}>{s.license_tier}</td>
                  <td>${s.price_paid}</td>
                  <td style={{ color: 'var(--text-muted)' }}>${s.platform_fee}</td>
                  <td style={{ color: 'var(--emerald)', fontWeight: 700 }}>${s.creator_net}</td>
                  <td><span style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--emerald)', padding: '2px 8px', borderRadius: '99px', fontSize: '0.72rem', fontWeight: 700 }}>SEALED</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'earnings' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '16px' }}>Earnings & Payout Transparency</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: 28 }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: '8px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Available Payout Balance</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--emerald)', margin: '8px 0' }}>
                ${metrics?.total_net_revenue || 0} USD
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Automatic weekly payout via direct bank transfer or Stripe.</p>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: '8px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Platform Fee Model</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: '8px 0' }}>
                85% Creator Cut / 15% Platform & Provenance Fee
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Fee covers Pinit HUB vault storage, file DNA verification, and post-sale monitoring.</p>
            </div>
          </div>

          <h4 style={{ color: '#fff', fontSize: '1.05rem', marginBottom: 12 }}>Promo coupons</h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 14 }}>
            Buyers enter these codes at cart checkout. Discounts apply after Razorpay (or mock) payment.
          </p>
          <form onSubmit={createCoupon} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
            <label className="form-label" style={{ flex: '1 1 160px' }}>
              Code
              <input className="form-input" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder="SPRING20" required />
            </label>
            <label className="form-label" style={{ width: 120 }}>
              % off
              <input className="form-input" type="number" min={1} max={90} value={couponPercent} onChange={(e) => setCouponPercent(Number(e.target.value))} />
            </label>
            <button type="submit" className="btn-primary">Create coupon</button>
          </form>
          {couponMsg && <p style={{ color: 'var(--emerald)', fontSize: '0.85rem', marginBottom: 12 }}>{couponMsg}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {coupons.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>No coupons yet.</p>}
            {coupons.map((c) => (
              <div key={c.code} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.25)', padding: '10px 14px', borderRadius: 8 }}>
                <span style={{ color: '#fff', fontFamily: 'monospace', fontWeight: 700 }}>{c.code}</span>
                <span style={{ color: 'var(--emerald)' }}>{c.percent_off}% off · {c.active ? 'Active' : 'Off'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'tracking' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '8px' }}>Monitoring summaries (from Pinit HUB)</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Exchange shows alerts only. Open Pinit HUB for full investigations — never rebuilt here.
          </p>

          {monitorSummaries.length === 0 ? (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: 20 }}>
              No Hub investigation alerts yet. Post-sale tracking jobs stay active below.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: 24 }}>
              {monitorSummaries.map((s) => (
                <div key={s.id} style={{ background: 'rgba(0,0,0,0.3)', padding: '14px 18px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.92rem' }}>{s.title}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{s.summary}</div>
                  </div>
                  <a
                    className="btn-secondary"
                    href={s.hubDeepLink || `${hubAppUrl}/investigations`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'none', whiteSpace: 'nowrap', fontSize: '0.8rem' }}
                  >
                    Open in Hub
                  </a>
                </div>
              ))}
            </div>
          )}

          <h4 style={{ color: '#fff', marginBottom: 10, fontSize: '1rem' }}>Local tracking jobs</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {tracking_jobs?.map((job) => (
              <div key={job.job_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '14px 18px', borderRadius: '8px' }}>
                <div>
                  <div style={{ color: 'var(--primary)', fontWeight: 700, fontSize: '0.9rem' }}>Tracking Job: {job.job_id}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Linked Seal: {job.seal_id} • Asset: {job.asset_id}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <span style={{ color: 'var(--emerald)', fontSize: '0.8rem', fontWeight: 600 }}>● Active Monitoring</span>
                  <a href={`${hubAppUrl}/vault`} target="_blank" rel="noreferrer" className="btn-secondary" style={{ padding: '6px 10px', fontSize: '0.75rem', textDecoration: 'none' }}>
                    Open Hub
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'requirements' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '16px' }}>Open Buyer Requirements</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {requirements?.map(req => (
              <div key={req.req_id} style={{ background: 'rgba(0,0,0,0.3)', padding: '18px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <h4 style={{ fontSize: '1.05rem', color: '#fff' }}>{req.title}</h4>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Posted by: {req.buyer_name} ({req.buyer_org})</div>
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--emerald)' }}>
                    ${req.budget} USD
                  </div>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>{req.description}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Proposals: {req.proposals_count}</span>
                  <button className="btn-secondary" onClick={() => handleSubmitProposal(req.req_id)} style={{ padding: '6px 14px', fontSize: '0.82rem' }}>
                    <Send size={14} /> Submit Proposal
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
