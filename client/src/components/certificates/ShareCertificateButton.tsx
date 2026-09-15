import { Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { HubCredential } from '../../services/dashboard.api';

/** The public page anyone can open to check a certificate — the same one its QR code points at. */
export function certificateVerifyUrl(certificateId: string): string {
  return `${window.location.origin}/verify-certificate?id=${encodeURIComponent(certificateId)}`;
}

/**
 * Share a certificate by its verification link.
 *
 * What gets shared is proof, not the file: the link opens the public
 * verification page, which needs no account and shows the certificate's live
 * status — a revoked certificate says so there. Sharing the protected file
 * itself stays in the vault share dialog, where expiry and location rules apply.
 *
 * Uses the system share sheet when there is one. Closing that sheet is a choice,
 * so it does nothing; only a missing or failed sheet falls back to copying.
 */
export function ShareCertificateButton({
  item,
  className,
  label = 'Share certificate',
  iconSize = 14,
}: {
  item: HubCredential;
  className?: string;
  label?: string;
  iconSize?: number;
}) {
  const certId = item.source?.id;
  if (!certId) return null;

  const run = async () => {
    const url = certificateVerifyUrl(certId);
    const data: ShareData = {
      title: `${item.title} — Pinit certificate`,
      text: `Verify the Pinit certificate for ${item.title}`,
      url,
    };

    const canShare =
      typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && (typeof navigator.canShare !== 'function' || navigator.canShare(data));

    if (canShare) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Any other failure: fall through and copy instead.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      toast.success('Verification link copied — anyone can open it without an account');
    } catch {
      toast.error('Could not share or copy the verification link');
    }
  };

  return (
    <button type="button" className={className} onClick={() => void run()}>
      <Share2 size={iconSize} aria-hidden />
      {label}
    </button>
  );
}
