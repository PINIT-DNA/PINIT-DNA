/**
 * Hub subscription receipt. The PDF is built by the same document renderer as Exchange.
 */
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';

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

export async function downloadInvoiceReceipt(row: InvoiceReceiptInput): Promise<void> {
  const res = await api.get(`${API_BASE_URL}/subscription/billing/${row.id}/document`, {
    responseType: 'blob',
  });
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${formatInvoiceNumber(row)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
