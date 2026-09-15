import React, { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { apiFetch } from '../../lib/api.js';

export default function SellerPromotions({ user }) {
  const [coupons, setCoupons] = useState([]);
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState(10);
  const [msg, setMsg] = useState('');

  const load = async () => {
    if (!user?.pinit_id) return;
    const { ok, data } = await apiFetch(
      `/api/commerce/coupons?seller_pinit_id=${encodeURIComponent(user.pinit_id)}`,
    );
    setCoupons(ok ? (data.coupons || []) : []);
  };

  useEffect(() => {
    load();
  }, [user?.pinit_id]);

  const create = async (e) => {
    e.preventDefault();
    setMsg('');
    const { ok, data, error } = await apiFetch('/api/commerce/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        seller_pinit_id: user.pinit_id,
        percent_off: percent,
      }),
    });
    if (!ok) {
      setMsg(error || data?.error || 'Could not create coupon');
      return;
    }
    setCode('');
    setMsg(`Coupon ${data.code} is live (${data.percent_off}% off)`);
    load();
  };

  return (
    <StudioPage
      title="Promotions"
      subtitle="Optional percent-off codes for buyers at checkout. Never used to store payment cards."
    >
      <form className="glass-panel studio-promo" onSubmit={create}>
        <div className="form-group">
          <label className="form-label">Coupon code</label>
          <input className="form-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SPRING15" required />
        </div>
        <div className="form-group">
          <label className="form-label">Percent off</label>
          <input type="number" min="1" max="80" className="form-input" value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
        </div>
        <button type="submit" className="btn-primary">Create coupon</button>
        {msg ? <p className="studio-promo__msg">{msg}</p> : null}
      </form>

      {coupons.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={32} color="var(--primary)" />}
          title="No promotions yet"
          description="Create a coupon to offer a limited discount on your listings."
        />
      ) : (
        <ul className="studio-activity" style={{ marginTop: 20 }}>
          {coupons.map((c) => (
            <li key={c.code}><strong>{c.code}</strong> · {c.percent_off}% off · {c.active ? 'Active' : 'Off'}</li>
          ))}
        </ul>
      )}
    </StudioPage>
  );
}
