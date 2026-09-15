import { useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import type { HubCredential } from '../../services/dashboard.api';
import { downloadCertificatePdf } from '../../lib/certificate-download';

function formatIssued(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return format(new Date(parsed), 'd MMM yyyy');
  return raw;
}

/**
 * One download action for every place a certificate is shown, so the card, the
 * preview and the details view all produce the same file.
 *
 * Hidden for revoked certificates: the document carries no revoked marking, so a
 * downloaded copy would present an invalid certificate as a valid one.
 */
export function DownloadCertificateButton({
  item,
  recipientName,
  recipientPinitId,
  className,
  label = 'Download certificate',
  iconSize = 14,
}: {
  item: HubCredential;
  recipientName?: string | null;
  recipientPinitId?: string | null;
  className?: string;
  label?: string;
  iconSize?: number;
}) {
  const [busy, setBusy] = useState(false);

  if (item.lifecycleStatus === 'REVOKED') return null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadCertificatePdf({
        title: item.title,
        issuer: item.issuer,
        issuedLabel: formatIssued(item.issuedAt),
        recipientName: recipientName || item.recipientName,
        recipientPinitId: recipientPinitId ?? null,
        certificateId: item.source.id,
        trustLabel: 'Pinit Verified',
      });
      toast.success('Certificate downloaded');
    } catch {
      toast.error('Could not create the certificate PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={() => void run()}
      disabled={busy}
      aria-busy={busy}
    >
      <Download size={iconSize} aria-hidden />
      {busy ? 'Preparing…' : label}
    </button>
  );
}
