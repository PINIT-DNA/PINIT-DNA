import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** In-app QR for a share URL — works better than Windows file-share QR. */
export function ShareQrBlock({ url, className = '' }: { url: string; className?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const isLocal = /localhost|127\.0\.0\.1/i.test(url);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 200,
      color: { dark: '#0b1220', light: '#ffffff' },
    })
      .then((d) => {
        if (!cancelled) setDataUrl(d);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!dataUrl) return null;

  return (
    <div className={`flex flex-col items-center gap-2 p-3 rounded-xl border border-bg-border bg-bg-elevated ${className}`}>
      <p className="text-2xs font-semibold text-gray-400 uppercase tracking-wider">Scan to open</p>
      <img
        src={dataUrl}
        alt="QR code for share link"
        className="w-40 h-40 rounded-lg bg-white p-2"
      />
      <p className="text-2xs text-gray-500 text-center">
        Point your phone camera at this code
      </p>
      {isLocal && (
        <p className="text-2xs text-amber-400/90 text-center max-w-[220px]">
          This is a localhost link — phones can only open it if they can reach this PC (e.g. ngrok / production URL).
        </p>
      )}
    </div>
  );
}
