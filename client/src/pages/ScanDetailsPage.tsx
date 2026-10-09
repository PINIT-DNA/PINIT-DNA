import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config/api.config';

interface DetailBody {
  success?: boolean;
  verdict?: 'protected' | 'possible';
  message?: string;
  ownerName?: string;
  protectedAt?: string;
  title?: string;
  recipientLabel?: string;
  error?: string;
}

function formatWhen(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

export function ScanDetailsPage() {
  const { token = '' } = useParams();
  const [detail, setDetail] = useState<DetailBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.title;
    document.title = 'PINIT Scan';
    let live = true;
    fetch(`${API_BASE_URL}/scan/details/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json() as DetailBody;
        if (!live) return;
        if (!res.ok || !body.verdict) {
          setError(body.error || 'These details are no longer available.');
          return;
        }
        setDetail(body);
      })
      .catch(() => {
        if (live) setError('These details could not be loaded. Try the scan again.');
      });
    return () => {
      live = false;
      document.title = previous;
    };
  }, [token]);

  const when = formatWhen(detail?.protectedAt);

  return (
    <div className="scan-details">
      <style>{detailCss}</style>
      <div className="card">
        <p className="brand">PINIT Scan</p>
        {error && (
          <>
            <h1>Details are not available</h1>
            <p>{error}</p>
          </>
        )}
        {detail && (
          <>
            <h1>{detail.verdict === 'protected' ? 'Protected by PINIT' : 'Possible match'}</h1>
            <p>{detail.message}</p>
            <div className="kv">
              {detail.ownerName && <div><span>{detail.verdict === 'possible' ? 'Possible owner' : 'Owner'}</span><b>{detail.ownerName}</b></div>}
              {detail.title && <div><span>Asset</span><b>{detail.title}</b></div>}
              {when && <div><span>First protected</span><b>{when}</b></div>}
              {detail.recipientLabel && <div><span>Issued to</span><b>{detail.recipientLabel}</b></div>}
            </div>
            <p className="quiet">Only details the owner has allowed are shown. The original file, private contact, and account records stay hidden. The scanned image is not kept.</p>
          </>
        )}
        {!detail && !error && <p>Loading public details…</p>}
        <Link to="/scan" className="back">Back to scan</Link>
      </div>
    </div>
  );
}

const detailCss = `
.scan-details{min-height:100dvh;background:#070B1A;display:flex;justify-content:center;padding:28px 16px;font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#0B1226}
.scan-details .card{width:min(100%,430px);background:#fff;border-radius:26px;padding:22px 20px 20px;display:flex;flex-direction:column;gap:14px;align-self:center}
.scan-details .brand{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1F68DD;margin:0}
.scan-details h1{font-size:22px;line-height:1.2;margin:0}
.scan-details p{margin:0;font-size:14px;color:#5A6583;line-height:1.45}
.scan-details .kv{display:grid;gap:9px}
.scan-details .kv div{display:flex;justify-content:space-between;gap:12px;font-size:13.5px;border-bottom:1px solid #EDF0F6;padding-bottom:9px}
.scan-details .kv span{color:#5A6583}
.scan-details .kv b{text-align:right}
.scan-details .quiet{font-size:12px}
.scan-details .back{display:flex;justify-content:center;background:#2F7CF6;color:#fff;text-decoration:none;font-weight:700;border-radius:16px;padding:14px 18px}
`;
