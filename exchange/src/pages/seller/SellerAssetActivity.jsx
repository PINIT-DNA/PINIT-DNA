import React, { useEffect, useState } from 'react';
import {
  Activity, Eye, Heart, ShoppingCart, BadgeDollarSign, Download,
  Star, RefreshCw, AlertCircle, ArrowLeft,
} from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { apiFetch } from '../../lib/api.js';
import { formatMoney } from '../../lib/money.js';

/**
 * Asset 360 — what actually happened to one asset.
 *
 * Every figure here is a count or sum over real Exchange rows, keyed on the
 * canonical Asset.id. Nothing is seeded or estimated: an asset with no
 * activity shows zeroes, and an asset with no reviews shows "No reviews yet"
 * rather than a default score.
 */
export default function SellerAssetActivity({ user, assetId, onBack, onSelectListing }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    if (!assetId || !user?.pinit_id) return;
    setLoading(true);
    setError('');
    const { ok, data: body, error: err } = await apiFetch(
      `/api/creator/assets/${encodeURIComponent(assetId)}/activity`,
    );
    if (ok) setData(body);
    else setError(err || 'Could not load activity for this asset.');
    setLoading(false);
  };

  useEffect(() => { load(); }, [assetId, user?.pinit_id]);

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading asset activity…</div>;
  }

  if (error) {
    return (
      <StudioPage title="Asset activity">
        <EmptyState
          icon={<AlertCircle size={30} color="var(--danger, #c0392b)" />}
          title="Couldn't load this asset"
          description={`${error} This is a connection problem, not an empty asset.`}
          primaryLabel="Try again"
          onPrimary={load}
          secondaryLabel="Back to listings"
          onSecondary={onBack}
        />
      </StudioPage>
    );
  }

  if (!data) return null;

  const { listing, engagement, commerce, delivery, reviews, recent_sales: recentSales } = data;
  const money = (v, c) => formatMoney(Number(v || 0), c);

  const kpis = [
    { label: 'Views', value: engagement.views, icon: Eye, hint: 'Excludes your own visits' },
    { label: 'Saved', value: engagement.wishlisted_now, icon: Heart, hint: 'On wishlists now' },
    { label: 'In carts', value: engagement.in_carts_now, icon: ShoppingCart, hint: 'Awaiting checkout' },
    { label: 'Sales', value: commerce.sales_count, icon: BadgeDollarSign, hint: 'Sealed licences' },
    { label: 'Downloads', value: delivery.total_downloads, icon: Download, hint: 'Authorised deliveries' },
  ];

  return (
    <StudioPage
      title={listing.title || 'Asset activity'}
      subtitle="Everything recorded against this asset on Exchange. Figures are real counts — an asset with no activity shows zero."
    >
      <div className="a360-bar">
        <button type="button" className="ex-btn ex-btn--ghost ex-btn--sm" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <span className={`a360-status a360-status--${String(listing.status || '').toLowerCase()}`}>
          {listing.status}
        </span>
        {listing.badge_tier && <span className="a360-badge">{listing.badge_tier}</span>}
        <button type="button" className="ex-btn ex-btn--secondary ex-btn--sm a360-bar__refresh" onClick={load}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="a360-kpis">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="ex-card a360-kpi">
              <span className="a360-kpi__label"><Icon size={14} /> {k.label}</span>
              <strong className="a360-kpi__value">{Number(k.value || 0)}</strong>
              <em className="a360-kpi__hint">{k.hint}</em>
            </div>
          );
        })}
      </div>

      <div className="a360-cols">
        <section className="ex-card ex-card--pad">
          <h3 className="ex-h2 a360-h">Revenue</h3>
          <dl className="a360-rows">
            <div><dt>Gross</dt><dd>{money(commerce.gross_revenue)}</dd></div>
            <div><dt>Platform fee</dt><dd className="a360-neg">−{money(commerce.platform_fees)}</dd></div>
            <div className="a360-rows__total"><dt>Your net</dt><dd>{money(commerce.creator_net)}</dd></div>
            {commerce.refunds_count > 0 && (
              <div><dt>Refunded</dt><dd className="a360-neg">−{money(commerce.refunds_amount)} ({commerce.refunds_count})</dd></div>
            )}
          </dl>
          <p className="a360-note">
            Earnings are accrued. Payouts settle through the payment provider once enabled.
          </p>
        </section>

        <section className="ex-card ex-card--pad">
          <h3 className="ex-h2 a360-h">Conversion</h3>
          {engagement.conversion_rate === null ? (
            <p className="a360-empty">No views recorded yet, so there is nothing to convert.</p>
          ) : (
            <>
              <strong className="a360-big">{engagement.conversion_rate}%</strong>
              <p className="a360-note">
                {commerce.sales_count} {commerce.sales_count === 1 ? 'sale' : 'sales'} from {engagement.views} views.
              </p>
            </>
          )}
          <div className="a360-prices">
            <span className="ex-label">Published prices</span>
            <ul>
              {[
                ['Personal', listing.price_personal],
                ['Commercial', listing.price_commercial],
                ['Exclusive', listing.price_exclusive],
                ['Enterprise', listing.price_enterprise],
              ].filter(([, v]) => Number(v) > 0).map(([k, v]) => (
                <li key={k}><span>{k}</span><strong>{money(v)}</strong></li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <section className="ex-card ex-card--pad a360-section">
        <h3 className="ex-h2 a360-h">
          Reviews {reviews.count > 0 && <span className="a360-avg"><Star size={14} /> {reviews.average}</span>}
        </h3>
        {reviews.count === 0 ? (
          <p className="a360-empty">No reviews yet — the first buyer to license this can leave one.</p>
        ) : (
          <ul className="a360-reviews">
            {reviews.recent.map((r, i) => (
              <li key={i}>
                <span className="a360-stars">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                <p>{r.comment || <em>No comment left.</em>}</p>
                <span className="a360-who">{r.buyer_pinit_id || 'Verified buyer'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ex-card ex-card--pad a360-section">
        <h3 className="ex-h2 a360-h">Sales</h3>
        {(!recentSales || recentSales.length === 0) ? (
          <p className="a360-empty">No sales yet. This asset is live and discoverable in the marketplace.</p>
        ) : (
          <div className="twrap-scroll">
            <table className="studio-table">
              <thead>
                <tr>
                  <th>Seal</th><th>Licence</th><th>Paid</th><th>Your net</th>
                  <th>Licence state</th><th>Downloads</th><th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map((s) => (
                  <tr key={s.seal_id}>
                    <td className="mono">{s.seal_id}</td>
                    <td className="cap">{s.license_tier}</td>
                    <td>{money(s.price_paid, s.currency)}</td>
                    <td>{money(s.creator_net, s.currency)}</td>
                    <td>
                      <span className={`a360-pill a360-pill--${String(s.license_status || '').toLowerCase()}`}>
                        {s.license_status || '—'}
                      </span>
                    </td>
                    <td className="num">
                      {s.download_limit == null
                        ? `${s.download_count || 0} / ∞`
                        : `${s.download_count || 0} / ${s.download_limit}`}
                    </td>
                    <td>{s.sealed_at ? new Date(s.sealed_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="a360-note">
          Buyers are shown by their public Pinit ID. Names, emails and payment details are never exposed here.
        </p>
      </section>

      {listing.listing_id && (
        <div className="a360-foot">
          <button type="button" className="ex-btn ex-btn--secondary" onClick={() => onSelectListing?.(listing.listing_id)}>
            <Activity size={15} /> View public listing
          </button>
        </div>
      )}
    </StudioPage>
  );
}
