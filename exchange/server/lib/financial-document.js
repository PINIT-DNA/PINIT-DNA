/**
 * One financial document for every PINIT receipt, invoice, statement and credit note.
 * Amounts are passed in. This file does not invent fees, tax or totals.
 */
import { jsPDF } from 'jspdf';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { formatMoney } from './money.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function taxNotice() {
  return {
    applied: false,
    note: 'Tax not applied. This document is not a tax invoice.',
  };
}

function party(role, name, pinitId) {
  return {
    role,
    name: String(name || '').trim() || 'Name not on file',
    pinitId: pinitId || null,
  };
}

function line(label, amount, currency, extra = {}) {
  return {
    label,
    amount,
    display: amount == null ? '—' : formatMoney(amount, currency),
    ...extra,
  };
}

/**
 * Buyer receipt and seller copy share one sale.
 * price_paid is what the buyer paid. platform_fee is taken from that amount.
 * creator_net is the stored remainder. Tax is not calculated here.
 */
export function saleDocument({ order, sellerName, audience }) {
  const currency = order.currency || 'INR';
  const gross = Number(order.price_paid || 0);
  const fee = Number(order.platform_fee || 0);
  const net = Number(order.creator_net || 0);
  const seller = audience === 'seller';
  const tax = taxNotice();
  const title = seller ? 'Invoice' : 'Receipt';

  return {
    kind: seller ? 'seller_invoice' : 'buyer_receipt',
    title,
    number: order.invoice_number,
    issuedAt: order.sealed_at,
    status: order.payment_status || order.status,
    currency,
    brand: 'PINIT',
    parties: [
      party('Seller', sellerName, order.seller_pinit_id),
      party('Buyer', order.buyer_name, order.buyer_pinit_id),
    ],
    item: {
      title: order.title || 'Protected work',
      detail: order.license_tier || '',
    },
    lines: [
      line(order.title || 'Licence', gross, currency, { detail: order.license_tier || '' }),
    ],
    totals: seller
      ? [
          line('Sale amount', gross, currency),
          line('Platform fee', -fee, currency),
          line('Tax', null, currency, { note: tax.note }),
          line('Net to seller', net, currency, { emphasis: true }),
        ]
      : [
          line('Item amount', gross, currency),
          line('Platform fee (included)', fee, currency),
          line('Tax', null, currency, { note: tax.note }),
          line('Total paid', gross, currency, { emphasis: true }),
        ],
    notes: [
      tax.note,
      seller
        ? 'The platform fee is the fee stored on this sale. It is not added on top of the amount the buyer paid.'
        : 'The platform fee is included in the total paid. It is not an extra charge.',
    ],
    references: [
      { label: 'Order', value: order.order_id },
      { label: 'Invoice', value: order.invoice_number },
    ],
    tax,
  };
}

export function creditNoteDocument({ order, refund, sellerName }) {
  const currency = order.currency || 'INR';
  const tax = taxNotice();
  const refunded = Number(refund.amount || 0);
  return {
    kind: 'credit_note',
    title: 'Credit note',
    number: `CN-${order.invoice_number || order.seal_id}`,
    issuedAt: refund.created_at || order.sealed_at,
    status: refund.status || 'completed',
    currency,
    brand: 'PINIT',
    parties: [
      party('Seller', sellerName, order.seller_pinit_id),
      party('Buyer', order.buyer_name, order.buyer_pinit_id),
    ],
    item: { title: order.title || 'Protected work', detail: 'Refund of the original sale' },
    lines: [
      line('Original amount', Number(order.price_paid || 0), currency),
      line('Platform fee on the original sale', Number(order.platform_fee || 0), currency),
    ],
    totals: [
      line('Tax', null, currency, { note: tax.note }),
      line('Amount refunded', refunded, currency, { emphasis: true }),
    ],
    notes: [
      tax.note,
      refund.reason ? `Reason recorded: ${refund.reason}` : 'No reason was recorded on the refund.',
      'The refunded amount is the amount stored on the refund. The platform fee is the fee stored on the original order.',
    ],
    references: [
      { label: 'Credit note', value: `CN-${order.invoice_number || order.seal_id}` },
      { label: 'Original invoice', value: order.invoice_number },
      { label: 'Original order', value: order.order_id },
      { label: 'Original date', value: order.sealed_at },
      { label: 'Refund reference', value: refund.id },
    ],
    tax,
  };
}

export function verificationReceiptDocument({ user, payment }) {
  const amount = Number(payment.amount);
  const currency = payment.currency || 'INR';
  const tax = taxNotice();
  return {
    kind: 'verification_receipt',
    title: 'Payment receipt',
    number: payment.number,
    issuedAt: payment.verifiedAt,
    status: 'paid',
    currency,
    brand: 'PINIT',
    parties: [party('Seller', user.name, user.pinit_id)],
    item: { title: 'Seller verification payment', detail: 'Seller account activation' },
    lines: [line('Seller verification', amount, currency)],
    totals: [
      line('Tax', null, currency, { note: tax.note }),
      line('Amount paid', amount, currency, { emphasis: true }),
    ],
    notes: [tax.note, 'This receipt is for the seller verification payment only.'],
    references: [
      { label: 'Receipt', value: payment.number },
      { label: 'Payment reference', value: payment.reference },
    ],
    tax,
  };
}

export function withdrawalStatementDocument({ user, payout, last4 }) {
  const amount = Number(payout.amount || 0);
  const currency = payout.currency || 'INR';
  return {
    kind: 'withdrawal_statement',
    title: 'Withdrawal statement',
    number: payout.id,
    issuedAt: payout.requested_at,
    status: payout.status,
    currency,
    brand: 'PINIT',
    parties: [party('Seller', user.name, user.pinit_id)],
    item: { title: 'Withdrawal request', detail: last4 ? `Account ending ${last4}` : 'Payout account on file' },
    lines: [line('Requested amount', amount, currency)],
    totals: [
      line('Fees recorded', 0, currency, { note: 'No fee is stored on this withdrawal.' }),
      line('Net amount', amount, currency, { emphasis: true }),
    ],
    notes: ['No withdrawal fee is stored. The net amount is the requested amount.'],
    references: [
      { label: 'Statement', value: payout.id },
      { label: 'Status', value: payout.status },
    ],
    tax: taxNotice(),
  };
}

export function hubSubscriptionDocument({ row, payer }) {
  const currency = (row.currency || 'INR').toUpperCase();
  const amount = Number(row.amount);
  const tax = taxNotice();
  return {
    kind: 'hub_subscription',
    title: 'Receipt',
    number: row.number,
    issuedAt: row.createdAt,
    status: row.status,
    currency,
    brand: 'PINIT',
    parties: [party('Account', payer.name, payer.pinitId)],
    item: { title: row.planName || 'Subscription', detail: 'Pinit HUB subscription' },
    lines: [line(row.planName || 'Subscription', amount, currency)],
    totals: [
      line('Tax', null, currency, { note: tax.note }),
      line('Amount paid', amount, currency, { emphasis: true }),
    ],
    notes: [
      tax.note,
      'This receipt confirms a Pinit HUB subscription payment. It is not a marketplace sale.',
    ],
    references: [
      { label: 'Receipt', value: row.number },
      { label: 'Payment reference', value: row.transactionId || 'Not stored' },
    ],
    tax,
  };
}

function logoDataUrl() {
  const file = join(__dirname, '../../public/pinit-hub-emblem-cut.png');
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

export function renderFinancialPdf(doc) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: false });
  const left = 18;
  let y = 18;
  const logo = logoDataUrl();
  if (logo) {
    try {
      pdf.addImage(logo, 'PNG', left, 12, 12, 12);
    } catch {
      /* wordmark still prints */
    }
  }
  pdf.setTextColor(17, 24, 39);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('PINIT', left + (logo ? 16 : 0), 20);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(75, 85, 99);
  pdf.text(doc.title, 150, 20);
  y = 36;
  pdf.setDrawColor(229, 231, 235);
  pdf.line(left, y, 192, y);
  y += 10;

  const meta = [
    ['Number', doc.number],
    ['Date', doc.issuedAt ? String(doc.issuedAt) : '—'],
    ['Status', doc.status || '—'],
    ['Currency', doc.currency],
  ];
  pdf.setFontSize(10);
  for (const [label, value] of meta) {
    pdf.setTextColor(107, 114, 128);
    pdf.text(label, left, y);
    pdf.setTextColor(17, 24, 39);
    pdf.text(String(value || '—'), 50, y);
    y += 6;
  }
  y += 4;

  for (const person of doc.parties || []) {
    pdf.setTextColor(107, 114, 128);
    pdf.setFontSize(9);
    pdf.text(person.role, left, y);
    pdf.setTextColor(17, 24, 39);
    pdf.setFontSize(12);
    pdf.text(person.name, left, y + 6);
    if (person.pinitId) {
      pdf.setFontSize(9);
      pdf.setTextColor(75, 85, 99);
      pdf.text(String(person.pinitId), left, y + 11);
      y += 18;
    } else {
      y += 14;
    }
  }

  y += 2;
  pdf.setFontSize(11);
  pdf.setTextColor(17, 24, 39);
  pdf.text(doc.item?.title || '', left, y);
  if (doc.item?.detail) {
    pdf.setFontSize(9);
    pdf.setTextColor(75, 85, 99);
    pdf.text(String(doc.item.detail), left, y + 5);
    y += 8;
  }
  y += 8;

  pdf.setDrawColor(229, 231, 235);
  for (const row of [...(doc.lines || []), ...(doc.totals || [])]) {
    pdf.line(left, y - 4, 192, y - 4);
    pdf.setFont('helvetica', row.emphasis ? 'bold' : 'normal');
    pdf.setFontSize(row.emphasis ? 12 : 10);
    pdf.setTextColor(17, 24, 39);
    pdf.text(row.label, left, y);
    pdf.text(row.display || row.note || '—', 150, y);
    y += row.note && row.amount == null ? 10 : 8;
    if (row.note && row.amount == null) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(107, 114, 128);
      pdf.text(row.note, left, y - 4);
    }
  }

  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(75, 85, 99);
  for (const note of doc.notes || []) {
    const wrapped = pdf.splitTextToSize(note, 170);
    pdf.text(wrapped, left, y);
    y += wrapped.length * 4 + 2;
  }
  for (const ref of doc.references || []) {
    pdf.text(`${ref.label}: ${ref.value || '—'}`, left, y);
    y += 4;
  }

  return Buffer.from(pdf.output('arraybuffer'));
}
