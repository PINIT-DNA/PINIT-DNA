import React, { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import SellerContextNav from '../../components/SellerContextNav.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import useSellerDesk from '../../hooks/useSellerDesk.js';
import { apiFetch } from '../../lib/api.js';
import { formatMoney } from '../../lib/money.js';
import { resolveHubAppUrl } from '../../lib/exchange-routes.js';
import {
  SALES_SECTIONS,
  initialSalesSection,
  listingTitleMap,
  groupBuyers,
  paymentLabel,
} from '../../lib/seller-workspace.js';

const HUB = resolveHubAppUrl();

function statusOf(row) {
  return String(row.license_status || row.status || 'active').toLowerCase();
}

export default function SalesCenter({
  user,
  page = 'seller_sales',
  onSelectListing,
  onNavigate,
}) {
  const { sales, listings, metrics, trackingJobs, loading } = useSellerDesk(user);
  const [section, setSection] = useState(initialSalesSection(page));
  const [payFilter, setPayFilter] = useState('all');
  const [licFilter, setLicFilter] = useState('all');
  const [buyerFilter, setBuyerFilter] = useState('all');
  const [openBuyer, setOpenBuyer] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [average, setAverage] = useState(0);

  useEffect(() => {
    setSection(initialSalesSection(page));
  }, [page]);

  useEffect(() => {
    if (!user?.pinit_id) return;
    (async () => {
      const { ok, data } = await apiFetch(
        `/api/commerce/reviews/seller?pinit_id=${encodeURIComponent(user.pinit_id)}`,
      );
      setReviews(ok ? (data.reviews || []) : []);
      setAverage(ok ? Number(data.average || 0) : 0);
    })();
  }, [user?.pinit_id]);

  const titles = listingTitleMap(listings);
  const buyers = useMemo(() => groupBuyers(sales), [sales]);
  const uniqueBuyers = buyers.filter((b) => b.buyer_pinit_id !== 'unknown').length;

  const payments = useMemo(() => {
    if (payFilter === 'all') return sales;
    return sales.filter((row) => paymentLabel(row) === payFilter || String(row.payment_status || '').toLowerCase().includes(payFilter));
  }, [sales, payFilter]);

  const licenses = useMemo(() => {
    if (licFilter === 'all' || licFilter === 'active') {
      const rows = sales.filter((row) => {
        const s = statusOf(row);
        if (licFilter === 'all') return true;
        return !s.includes('revok') && !s.includes('expir') && !s.includes('pend');
      });
      return rows;
    }
    return sales.filter((row) => statusOf(row).includes(licFilter));
  }, [sales, licFilter]);

  const visibleBuyers = useMemo(() => {
    if (buyerFilter === 'prospective') return [];
    if (buyerFilter === 'previous') return buyers.filter((b) => b.purchases > 0);
    if (buyerFilter === 'active') return buyers.filter((b) => b.licenses > 0);
    return buyers;
  }, [buyers, buyerFilter]);

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading sales…</div>;
  }

  const kpis = (
    <div className="studio-kpi">
      <div className="glass-panel studio-kpi__card">
        <span>Total revenue</span>
        <strong>{formatMoney(metrics.total_gross_revenue || 0)}</strong>
        <em>Gross sealed sales</em>
      </div>
      <div className="glass-panel studio-kpi__card">
        <span>Orders</span>
        <strong>{metrics.sealed_sales_count || sales.length}</strong>
        <em>Completed licenses</em>
      </div>
      <div className="glass-panel studio-kpi__card">
        <span>Active licenses</span>
        <strong>{sales.filter((r) => !statusOf(r).includes('revok') && !statusOf(r).includes('expir')).length}</strong>
        <em>Still in force</em>
      </div>
      <div className="glass-panel studio-kpi__card">
        <span>Pending payments</span>
        <strong>{formatMoney(metrics.payout_pending || 0)}</strong>
        <em>Awaiting settlement</em>
      </div>
      <div className="glass-panel studio-kpi__card">
        <span>Active buyers</span>
        <strong>{uniqueBuyers}</strong>
        <em>By public Pinit ID</em>
      </div>
      <div className="glass-panel studio-kpi__card">
        <span>Sales views</span>
        <strong>{metrics.total_views || 0}</strong>
        <em>{metrics.total_saves || 0} wishlist saves</em>
      </div>
    </div>
  );

  const saleTable = (rows, cols = 'full') => (
    rows.length === 0 ? (
      <EmptyState title="Nothing here yet" description="Sealed licenses appear when a buyer completes checkout on your listing." />
    ) : (
      <div className="glass-panel" style={{ padding: 8, overflowX: 'auto' }}>
        <table className="studio-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Buyer</th>
              <th>Amount</th>
              {cols === 'full' && <th>License</th>}
              {cols === 'full' && <th>Payment</th>}
              {cols === 'full' && <th>Invoice</th>}
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.seal_id || row.order_id}>
                <td>
                  <button type="button" className="link-btn" onClick={() => row.listing_id && onSelectListing?.(row.listing_id)}>
                    {titles.get(row.listing_id) || row.listing_id || row.asset_id}
                  </button>
                </td>
                <td>{row.buyer_pinit_id || '—'}</td>
                <td>{formatMoney(row.price_paid || 0, row.currency)}</td>
                {cols === 'full' && <td>{row.license_tier || 'commercial'}</td>}
                {cols === 'full' && <td className="cap">{row.payment_status || 'completed'}</td>}
                {cols === 'full' && <td className="mono">{row.invoice_number || '—'}</td>}
                <td className="cap">{row.license_status || row.status || 'licensed'}</td>
                <td>{row.sealed_at ? new Date(row.sealed_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  const hubNote = (title, body) => (
    <div className="glass-panel seller-hub-note">
      <strong>{title}</strong>
      <p>{body}</p>
      <a className="btn-secondary" href={HUB} target="_blank" rel="noreferrer">Open Pinit HUB</a>
    </div>
  );

  let body = null;
  if (section === 'overview') {
    body = (
      <>
        {kpis}
        <section className="studio-section">
          <div className="studio-section__head">
            <h2>Recent sales</h2>
          </div>
          {saleTable(sales.slice(0, 8), 'simple')}
        </section>
        <section className="studio-section">
          <h2>Sales activity</h2>
          <ul className="studio-activity">
            {(trackingJobs || []).slice(0, 8).map((job) => (
              <li key={job.job_id || job.id}>{job.event_type || job.status || 'Tracking event'} · {job.asset_id || job.listing_id || ''}</li>
            ))}
            {sales.slice(0, 4).map((row) => (
              <li key={`sale-${row.seal_id}`}>Payment received · {titles.get(row.listing_id) || row.listing_id} · {row.buyer_pinit_id}</li>
            ))}
            {(!trackingJobs?.length && !sales.length) && <li>No commercial activity yet.</li>}
          </ul>
        </section>
      </>
    );
  } else if (section === 'orders') {
    body = saleTable(sales);
  } else if (section === 'payments') {
    body = (
      <>
        <SellerContextNav
          label="Payment status"
          items={[['all', 'All'], ['completed', 'Received'], ['pending', 'Pending'], ['processing', 'Processing'], ['failed', 'Failed'], ['refunded', 'Refunded']]}
          value={payFilter}
          onChange={setPayFilter}
        />
        {payments.length === 0 ? (
          <EmptyState title="No payments in this state" description="Each row is the buyer transaction for a sealed license — not a second ledger." />
        ) : (
          <div className="sales-cards">
            {payments.map((row) => (
              <article key={row.seal_id} className="glass-panel sales-pay-card">
                <strong>{formatMoney(row.price_paid || 0, row.currency)}</strong>
                <h3>{titles.get(row.listing_id) || row.listing_id}</h3>
                <dl>
                  <div><dt>Buyer</dt><dd>{row.buyer_pinit_id || '—'}</dd></div>
                  <div><dt>License</dt><dd>{row.license_tier || 'commercial'}</dd></div>
                  <div><dt>Payment</dt><dd className="cap">{row.payment_status || 'completed'}</dd></div>
                  <div><dt>Invoice</dt><dd className="mono">{row.invoice_number || '—'}</dd></div>
                  <div><dt>Certificate</dt><dd className="mono">{row.seal_id}</dd></div>
                  <div><dt>Asset</dt><dd className="mono">{row.asset_id || '—'}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </>
    );
  } else if (section === 'buyers') {
    body = (
      <>
        <SellerContextNav
          label="Buyers"
          items={[['all', 'All buyers'], ['active', 'Active buyers'], ['previous', 'Previous buyers'], ['prospective', 'Prospective']]}
          value={buyerFilter}
          onChange={(id) => { setBuyerFilter(id); setOpenBuyer(null); }}
        />
        {buyerFilter === 'prospective' ? (
          <p className="studio-empty">Prospective demand is shown as anonymous wishlist saves on Listings and Wishlists. Buyer identity appears here only after a sealed purchase.</p>
        ) : visibleBuyers.length === 0 ? (
          <EmptyState title="No buyers yet" description="When someone licenses your work, they appear here by public Pinit ID." />
        ) : openBuyer ? (
          <div className="glass-panel sales-buyer-detail">
            <button type="button" className="btn-secondary" onClick={() => setOpenBuyer(null)}>Back</button>
            <h2>{openBuyer.buyer_pinit_id}</h2>
            <div className="studio-kpi">
              <div className="glass-panel studio-kpi__card"><span>Purchases</span><strong>{openBuyer.purchases}</strong></div>
              <div className="glass-panel studio-kpi__card"><span>Payments</span><strong>{formatMoney(openBuyer.total, openBuyer.currency)}</strong></div>
              <div className="glass-panel studio-kpi__card"><span>Licenses</span><strong>{openBuyer.licenses}</strong></div>
            </div>
            {saleTable(openBuyer.rows)}
          </div>
        ) : (
          <div className="sales-cards">
            {visibleBuyers.map((b) => (
              <article key={b.buyer_pinit_id} className="glass-panel sales-pay-card">
                <h3>{b.buyer_pinit_id}</h3>
                <p>{b.purchases} purchases · {formatMoney(b.total, b.currency)} · {b.licenses} licenses</p>
                <p>Last activity: {b.last ? new Date(b.last).toLocaleDateString() : '—'}</p>
                <button type="button" className="btn-primary" onClick={() => setOpenBuyer(b)}>View buyer</button>
              </article>
            ))}
          </div>
        )}
      </>
    );
  } else if (section === 'licenses') {
    body = (
      <>
        <SellerContextNav
          label="License status"
          items={[['all', 'All'], ['active', 'Active'], ['pending', 'Pending'], ['expired', 'Expired'], ['revoked', 'Revoked'], ['transferred', 'Transferred']]}
          value={licFilter}
          onChange={setLicFilter}
        />
        {licFilter === 'transferred' ? (
          hubNote('Transfers live in HUB Transactions', 'Exchange shows commercial transfers that already exist on a sealed sale. The master transfer record is Hub → Transactions → Transfers.')
        ) : licenses.length === 0 ? (
          <EmptyState title="No licenses in this state" description="Each license is the commercial grant on a sealed sale — not a second Hub certificate store." />
        ) : (
          <div className="sales-cards">
            {licenses.map((row) => (
              <article key={row.seal_id} className="glass-panel sales-pay-card">
                <h3>{titles.get(row.listing_id) || row.listing_id}</h3>
                <p>Licensed to {row.buyer_pinit_id || 'buyer'}</p>
                <p>{row.license_tier || 'Commercial'} · {row.sealed_at ? new Date(row.sealed_at).toLocaleDateString() : ''}</p>
                <p>Downloads {row.download_count || 0}{row.download_limit ? ` / ${row.download_limit}` : ''}</p>
                <span className="cap">{row.license_status || 'active'}</span>
              </article>
            ))}
          </div>
        )}
      </>
    );
  } else if (section === 'reviews') {
    body = reviews.length === 0 ? (
      <EmptyState icon={<Star size={32} color="var(--primary)" />} title="No reviews yet" description="Reviews are commercial reputation. They appear after a buyer licenses your work and leaves feedback." />
    ) : (
      <>
        <p className="sales-rating">{average.toFixed(1)} ★ · {reviews.length} reviews</p>
        <div className="studio-reviews">
          {reviews.map((row) => (
            <article key={row.id} className="glass-panel studio-review">
              <div className="studio-review__top">
                <strong>{row.listing_title || row.listing_id}</strong>
                <span><Star size={13} fill="currentColor" /> {row.rating}/5</span>
              </div>
              <p>{row.comment || 'No written comment.'}</p>
              <div className="studio-review__meta">
                {row.buyer_pinit_id || row.buyer_name || 'Buyer'} · {row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}
                {row.listing_id && onSelectListing ? (
                  <button type="button" className="btn-secondary" onClick={() => onSelectListing(row.listing_id)}>View listing</button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </>
    );
  } else if (section === 'wishlists') {
    const demand = [...listings].sort((a, b) => (b.saves || 0) - (a.saves || 0));
    body = demand.length === 0 ? (
      <EmptyState title="No demand signals yet" description="Wishlist saves on your listings are anonymous interest — not the buyer’s personal wishlist." />
    ) : (
      <div className="sales-cards">
        {demand.map((row) => {
          const saves = Number(row.saves || 0);
          const views = Number(row.views || 0);
          const licensed = sales.some((s) => s.listing_id === row.listing_id);
          const demandLevel = saves >= 10 ? 'HIGH' : saves >= 3 ? 'MEDIUM' : 'LOW';
          return (
            <article key={row.listing_id} className="glass-panel sales-pay-card">
              <h3>{row.title}</h3>
              <p>{saves} wishlist saves · {views} views</p>
              <p>Demand: {demandLevel}{!licensed && saves >= 3 ? ' · High interest, not yet licensed' : ''}</p>
              <button type="button" className="btn-secondary" onClick={() => onSelectListing?.(row.listing_id)}>View listing</button>
            </article>
          );
        })}
      </div>
    );
  } else if (section === 'shares') {
    body = hubNote(
      'Share links are Hub Access',
      'Who you sent work to, views and conversions belong to Hub → Access → Links. Sales only shows commercial outcomes after a share converts to a license.',
    );
  } else if (section === 'tracking') {
    body = (
      <>
        <p className="studio-empty">Commercial tracking only — listing views, wishlist interest, checkout and license activation. Full asset history stays in Hub Activity.</p>
        <ul className="studio-activity">
          {listings.slice(0, 12).map((row) => (
            <li key={row.listing_id}>Listing viewed · {row.title} · {row.views || 0} views · {row.saves || 0} saves</li>
          ))}
          {sales.map((row) => (
            <li key={row.seal_id}>Payment completed · license activated · {titles.get(row.listing_id)} · {row.buyer_pinit_id}</li>
          ))}
          {(trackingJobs || []).map((job) => (
            <li key={job.job_id || JSON.stringify(job)}>{job.event_type || job.kind || 'Event'} · {job.asset_id || ''}</li>
          ))}
        </ul>
      </>
    );
  } else if (section === 'invoices') {
    body = (
      <>
        {hubNote('Invoices are Hub Transactions', 'This is a filtered view of sales invoices. The invoice system of record is Hub → Transactions → Invoices.')}
        {saleTable(sales.filter((r) => r.invoice_number), 'full')}
      </>
    );
  } else if (section === 'transfers') {
    body = hubNote(
      'Transfers are Hub Transactions',
      'Commercial transfers (you → licensee) appear here when a sealed sale includes a transfer certificate. The master record is Hub → Transactions → Transfers.',
    );
  }

  return (
    <StudioPage
      title="Sales"
      subtitle="The commercial lifecycle for your listings — orders, buyers, licenses and demand. Hub remains the system of record for certificates, invoices and full tracking."
    >
      <SellerContextNav label="Sales" items={SALES_SECTIONS} value={section} onChange={setSection} />
      {body}
    </StudioPage>
  );
}
