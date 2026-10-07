import React, { useCallback, useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import SellerContextNav from '../../components/SellerContextNav.jsx';
import useSellerDesk from '../../hooks/useSellerDesk.js';
import { apiFetch } from '../../lib/api.js';
import { formatMoney } from '../../lib/money.js';
import { EARNINGS_SECTIONS } from '../../lib/seller-workspace.js';
import { sellerOnboardingComplete } from '../../lib/seller-onboarding.js';
import { downloadPdf } from '../../lib/download-pdf.js';

const EMPTY_FORM = { holder: '', accountNumber: '', confirmAccountNumber: '', ifsc: '' };

export default function SellerEarnings({ user, onNavigate }) {
  const { metrics, sales, loading } = useSellerDesk(user);
  const [section, setSection] = useState('overview');
  const [payout, setPayout] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState('');
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const verifiedSeller = sellerOnboardingComplete(user);

  const loadPayout = useCallback(async () => {
    if (!user?.pinit_id) return;
    const { ok, data } = await apiFetch('/api/seller/payouts');
    if (ok) setPayout(data);
  }, [user?.pinit_id]);

  useEffect(() => { loadPayout(); }, [loadPayout]);

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading earnings…</div>;
  }

  const pending = Number(metrics.payout_pending || 0);
  const net = Number(metrics.total_net_revenue || 0);
  const gross = Number(metrics.total_gross_revenue || 0);
  const fees = Math.max(0, gross - net);
  const available = Number(payout?.available ?? 0);
  const clearing = Number(payout?.clearing ?? 0);
  const account = payout?.account || null;

  const say = (text, tone) => {
    setNotice(text);
    setNoticeTone(tone || '');
  };

  const saveAccount = async (event) => {
    event.preventDefault();
    if (!verifiedSeller) {
      onNavigate?.('seller_onboarding_payment');
      return;
    }
    setBusy(true);
    say('');
    const { ok, data, error } = await apiFetch('/api/seller/payouts/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holder: form.holder,
        accountNumber: form.accountNumber,
        confirmAccountNumber: form.confirmAccountNumber,
        ifsc: form.ifsc,
      }),
    });
    setBusy(false);
    if (!ok) {
      say(data?.message || error || 'The account was not saved.', 'bad');
      return;
    }
    setForm(EMPTY_FORM);
    setFormOpen(false);
    say(data?.message || 'Payout account verified and saved.', 'ok');
    await loadPayout();
  };

  const withdraw = async () => {
    if (!confirmWithdraw) {
      setConfirmWithdraw(true);
      return;
    }
    setBusy(true);
    say('');
    const { ok, data, error } = await apiFetch('/api/seller/payouts/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    setBusy(false);
    setConfirmWithdraw(false);
    if (!ok) {
      say(data?.message || error || 'The withdrawal was not requested.', 'bad');
      return;
    }
    say(data?.message || 'Withdrawal requested.', 'ok');
    await loadPayout();
  };

  return (
    <StudioPage
      title="Earnings"
      subtitle="Available balance, payout account, and what is still clearing."
    >
      <SellerContextNav label="Earnings" items={EARNINGS_SECTIONS} value={section} onChange={setSection} />

      {notice && <p className={`earn-notice earn-notice--${noticeTone || 'ok'}`}>{notice}</p>}

      {(section === 'overview' || section === 'available' || section === 'payouts') && (
        <div className="earn-board">
          <article className="earn-card">
            <h2>Available funds</h2>
            <p className="earn-kicker">Balance available for use</p>
            <p className="earn-amount">{formatMoney(available)}</p>
            <button
              type="button"
              className="earn-withdraw"
              disabled={busy || available <= 0 || !account}
              onClick={withdraw}
            >
              {confirmWithdraw ? 'Confirm withdrawal' : 'Withdraw balance'}
            </button>
            {!account && <p className="earn-hint">Add a verified payout account before withdrawing.</p>}
            <button
              type="button"
              className="earn-textbtn"
              onClick={() => {
                if (!verifiedSeller) {
                  onNavigate?.('seller_onboarding_payment');
                  return;
                }
                setFormOpen((open) => !open);
              }}
            >
              {account ? 'Manage payout methods' : 'Add payout account'}
            </button>
            {account && (
              <p className="earn-account">
                {account.account_holder} · {account.ifsc} · account ending {account.last4}
              </p>
            )}
            {verifiedSeller && (
              <button
                type="button"
                className="earn-textbtn"
                onClick={() => downloadPdf('/api/seller/onboarding/receipt?format=pdf', 'seller-verification.pdf')}
              >
                Verification receipt
              </button>
            )}
            {formOpen && verifiedSeller && (
              <form className="earn-form" onSubmit={saveAccount}>
                <label>
                  Account holder name
                  <input value={form.holder} onChange={(e) => setForm({ ...form, holder: e.target.value })} autoComplete="name" required />
                </label>
                <label>
                  Account number
                  <input value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} inputMode="numeric" autoComplete="off" required />
                </label>
                <label>
                  Confirm account number
                  <input value={form.confirmAccountNumber} onChange={(e) => setForm({ ...form, confirmAccountNumber: e.target.value })} inputMode="numeric" autoComplete="off" required />
                </label>
                <label>
                  IFSC
                  <input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} autoComplete="off" required />
                </label>
                <button type="submit" className="earn-withdraw" disabled={busy}>
                  {busy ? 'Checking…' : 'Verify and save account'}
                </button>
              </form>
            )}
            {!verifiedSeller && (
              <p className="earn-hint">Finish seller verification before a payout account can be added.</p>
            )}
          </article>

          <article className="earn-card">
            <h2>Future payments</h2>
            <p className="earn-kicker">Withdrawals being cleared</p>
            <p className="earn-amount">{formatMoney(clearing)}</p>
            <p className="earn-hint">Requested withdrawals stay here until they are paid out. This does not move money by itself.</p>
            {(payout?.payouts || []).map((row) => (
              <button
                key={row.id}
                type="button"
                className="earn-textbtn"
                onClick={() => downloadPdf(`/api/seller/payouts/${encodeURIComponent(row.id)}/statement`, `${row.id}.pdf`)}
              >
                Statement {row.id.slice(0, 18)}
              </button>
            ))}
          </article>

          <article className="earn-card">
            <h2>Earnings and expenses</h2>
            <p className="earn-kicker">Earnings to date</p>
            <p className="earn-amount earn-amount--sm">{formatMoney(net)}</p>
            <p className="earn-hint">Your creator net since joining.</p>
            <hr className="earn-rule" />
            <p className="earn-kicker">Expenses to date</p>
            <p className="earn-amount earn-amount--sm">{formatMoney(fees)}</p>
            <p className="earn-hint">Platform fees on sealed sales.</p>
          </article>
        </div>
      )}

      {(section === 'overview' || section === 'revenue') && (
      <div className="studio-kpi">
        <div className="glass-panel studio-kpi__card">
          <span>Gross sales</span>
          <Wallet size={18} color="var(--emerald)" />
          <strong>{formatMoney(gross)}</strong>
          <em>{metrics.sealed_sales_count || 0} sealed licenses</em>
        </div>
        <div className="glass-panel studio-kpi__card">
          <span>Creator net</span>
          <Wallet size={18} color="var(--emerald)" />
          <strong>{formatMoney(net)}</strong>
          <em>After platform fee</em>
        </div>
        <div className="glass-panel studio-kpi__card">
          <span>Accrued, not yet withdrawn</span>
          <Wallet size={18} color="var(--primary)" />
          <strong>{formatMoney(pending)}</strong>
          <em>From sealed sales</em>
        </div>
      </div>
      )}

      {section === 'pending' && (
        <p className="studio-empty">Still clearing: {formatMoney(clearing)}. Available now: {formatMoney(available)}.</p>
      )}
      {section === 'fees' && (
        <p className="studio-empty">Platform fees on sealed sales: {formatMoney(fees)}.</p>
      )}
      {section === 'statements' && (
        <p className="studio-empty">Statements stay a view of sealed sales. No second ledger was added.</p>
      )}

      <div className="studio-section">
        <div className="studio-section__head">
          <h2>Recent earnings</h2>
          <button type="button" className="btn-secondary" onClick={() => onNavigate?.('seller_sales')}>View sales</button>
        </div>
        {sales.length === 0 ? (
          <p className="studio-empty">No earnings yet. Publish a listing to start licensing.</p>
        ) : (
          <ul className="studio-activity">
            {sales.slice(0, 8).map((row) => (
              <li key={row.seal_id}>
                +{formatMoney(row.creator_net || 0, row.currency)} net · {row.license_tier || 'license'} · {row.sealed_at ? new Date(row.sealed_at).toLocaleDateString() : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </StudioPage>
  );
}
