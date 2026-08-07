/**
 * Client-side Hub subscription receipt / invoice text from billing history.
 * Works with mock and live gateway rows without changing entitlement logic.
 */

export interface InvoiceReceiptInput {
  id: string;
  /** Amount already in major currency units (e.g. INR rupees). */
  amountInr: number;
  currency: string;
  status: string;
  provider: string;
  createdAt: string;
  transactionId?: string | null;
  planName?: string | null;
}

export function formatInvoiceNumber(row: InvoiceReceiptInput): string {
  const d = new Date(row.createdAt);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const seg = row.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `INV-${y}${m}-${seg}`;
}

export function buildInvoiceReceipt(row: InvoiceReceiptInput): string {
  const amount = Number(row.amountInr || 0).toFixed(2);
  const inv = formatInvoiceNumber(row);
  const currency = (row.currency || 'INR').toUpperCase();

  return [
    'PINIT HUB — PAYMENT RECEIPT',
    '===========================',
    '',
    `Invoice number: ${inv}`,
    `Date: ${new Date(row.createdAt).toUTCString()}`,
    `Status: ${row.status}`,
    `Provider: ${row.provider}`,
    `External reference: ${row.transactionId || 'N/A'}`,
    `Plan: ${row.planName || 'Subscription'}`,
    `Amount: ${currency} ${amount}`,
    '',
    'This receipt confirms a Pinit HUB subscription payment.',
    'It is not a marketplace sale or licensing invoice.',
    '',
    'Thank you for using Pinit HUB.',
  ].join('\n');
}

export function downloadInvoiceReceipt(row: InvoiceReceiptInput): void {
  const text = buildInvoiceReceipt(row);
  const inv = formatInvoiceNumber(row);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${inv}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
