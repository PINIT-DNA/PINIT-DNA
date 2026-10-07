import React, { useEffect, useState } from 'react';
import { Receipt, Download, FileText, AlertCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { formatMoney } from '../../lib/money.js';
import EmptyState from '../../components/EmptyState.jsx';
import FinancialDocument from '../../components/FinancialDocument.jsx';
import { downloadPdf } from '../../lib/download-pdf.js';

/**
 * Buyer order history — the commercial record, distinct from My Licences.
 *
 * My Licences answers "what may I use?". This answers "what did I pay, when,
 * in which currency, and where is my invoice?" — the questions a business
 * buyer needs at expense time.
 *
 * Amounts render in the currency each order was actually charged in, so a
 * historical order does not silently re-label itself when the platform
 * currency changes.
 */
export default function BuyerOrders({ user, onNavigate }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [invoiceError, setInvoiceError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      const { ok, data, error: err } = await apiFetch('/api/orders/my-orders');
      if (cancelled) return;
      if (!ok) {
        setError(err || 'Could not load your orders.');
        setOrders([]);
      } else {
        setOrders(Array.isArray(data) ? data : []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.pinit_id]);

  const openInvoice = async (sealId) => {
    setInvoiceError('');
    setInvoice(null);
    const { ok, data, error: err } = await apiFetch(`/api/orders/invoice/${encodeURIComponent(sealId)}`);
    if (!ok) {
      setInvoiceError(err || 'Could not load the invoice.');
      return;
    }
    setInvoice(data);
  };

  const printInvoice = async () => {
    if (!invoice?.seal_id && !invoice?.document) return;
    const seal = invoice.seal_id;
    try {
      await downloadPdf(
        `/api/orders/invoice/${encodeURIComponent(seal)}?format=pdf`,
        `${invoice.invoice_number || 'receipt'}.pdf`,
      );
    } catch (err) {
      setInvoiceError(err.message || 'The PDF could not be downloaded.');
    }
  };

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading your orders…</div>;
  }

  if (error) {
    return (
      <EmptyState
        icon={<AlertCircle size={36} color="var(--danger, #c0392b)" />}
        title="Couldn't load your orders"
        description={`${error} Your purchases are safe — this is a connection problem.`}
        primaryLabel="Try again"
        onPrimary={() => window.location.reload()}
      />
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<Receipt size={36} color="var(--primary)" />}
        title="No orders yet"
        description="Licences you purchase on Exchange will appear here with their receipts."
        primaryLabel="Browse the marketplace"
        onPrimary={() => onNavigate?.('marketplace')}
      />
    );
  }

  return (
    <div className="orders-page">
      <header className="orders-page__head">
        <h1>Orders</h1>
        <p>Your purchase history and receipts. Licence usage rights live under Purchases.</p>
      </header>

      <div className="orders-table-wrap">
        <table className="orders-table">
          <thead>
            <tr>
              <th scope="col">Invoice</th>
              <th scope="col">Asset</th>
              <th scope="col">Licence</th>
              <th scope="col">Date</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col">Downloads</th>
              <th scope="col"><span className="sr-only">Receipt</span></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.seal_id}>
                <td className="mono">{o.invoice_number || '—'}</td>
                <td>
                  <span className="orders-table__title">{o.title || "Protected asset"}</span>
                  <span className="orders-table__sub mono">{o.seal_id}</span>
                </td>
                <td className="cap">{o.license_tier}</td>
                <td>{o.sealed_at ? new Date(o.sealed_at).toLocaleDateString() : '—'}</td>
                <td>
                  <span className={`ostatus ostatus--${String(o.status || '').toLowerCase()}`}>
                    {o.status}
                  </span>
                </td>
                <td className="num">{o.amount_display || formatMoney(o.price_paid, o.currency)}</td>
                <td className="num">
                  {o.download_limit == null
                    ? <span title="Unlimited downloads">{o.download_count || 0} / ∞</span>
                    : <span>{o.download_count || 0} / {o.download_limit}</span>}
                </td>
                <td>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => openInvoice(o.seal_id)}>
                    <FileText size={14} /> Receipt
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invoiceError && <p className="orders-error">{invoiceError}</p>}

      {invoice && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Invoice">
          <div className="modal invoice-modal">
            <div className="modal-header">
              <h2>Receipt {invoice.invoice_number}</h2>
              <button type="button" className="modal-close" onClick={() => setInvoice(null)} aria-label="Close receipt">×</button>
            </div>

            <div className="invoice-body">
              <FinancialDocument document={invoice.document} />
              <p className="invoice-note">
                Licence terms {invoice.terms?.version}
                {invoice.terms?.accepted_at
                  ? ` accepted ${new Date(invoice.terms.accepted_at).toLocaleString()}`
                  : ' — acceptance not recorded for this order'}.
              </p>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setInvoice(null)}>Close</button>
              <button type="button" className="btn-primary" onClick={printInvoice}>
                <Download size={16} /> Download PDF
              </button>
              {String(invoice.payment_status || invoice.status || '').toLowerCase().includes('refund') && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => downloadPdf(`/api/orders/credit-note/${encodeURIComponent(invoice.seal_id)}?format=pdf`, `CN-${invoice.invoice_number}.pdf`)}
                >
                  Credit note
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
