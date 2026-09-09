import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import type { HubCredential } from '../../services/dashboard.api';

function formatIssued(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return format(new Date(parsed), 'd MMM yyyy');
  return raw;
}

export function CredentialDetailsModal({
  item,
  recipientName,
  onClose,
  onPreview,
}: {
  item: HubCredential;
  recipientName?: string | null;
  onClose: () => void;
  onPreview: () => void;
}) {
  const issued = formatIssued(item.issuedAt);
  const name = recipientName || item.recipientName;
  const certId = item.source.id;

  const copyLink = async () => {
    const url = `${window.location.origin}/verify-certificate?id=${encodeURIComponent(certId)}`;
    await navigator.clipboard.writeText(url);
    toast.success('Verification link copied');
  };

  return (
    <Modal open title="Pinit Protected Asset Certificate" onClose={onClose} size="lg">
      <div className="space-y-5 pb-1">
        <p className="text-sm font-medium text-emerald-700 dark:text-[#32D583]">✓ Pinit Verified</p>

        <ul className="rounded-lg border border-slate-200 dark:border-[#252C38] bg-slate-50 dark:bg-[#0C1018] divide-y divide-slate-200 dark:divide-[#252C38] text-sm text-slate-800 dark:text-[#F5F7FA]">
          <li className="px-3 py-2">✓ Pinit identity confirmed</li>
          <li className="px-3 py-2">✓ Protection record exists</li>
          {item.relatedAsset ? (
            <li className="px-3 py-2">✓ Asset record exists</li>
          ) : (
            <li className="px-3 py-2 text-slate-600 dark:text-[#9AA6B8]">Asset identity is not linked on this certificate</li>
          )}
        </ul>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {name && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#9AA6B8]">Issued to</dt>
              <dd className="text-slate-900 dark:text-[#F5F7FA] mt-0.5">{name}</dd>
            </div>
          )}
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#9AA6B8]">Asset</dt>
            <dd className="text-slate-900 dark:text-[#F5F7FA] mt-0.5">{item.relatedAsset?.title || item.title}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#9AA6B8]">Protected by</dt>
            <dd className="text-slate-900 dark:text-[#F5F7FA] mt-0.5">Pinit HUB</dd>
          </div>
          {issued && (
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#9AA6B8]">Issued</dt>
              <dd className="text-slate-900 dark:text-[#F5F7FA] mt-0.5">{issued}</dd>
            </div>
          )}
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#9AA6B8]">Credential ID</dt>
            <dd className="text-slate-900 dark:text-[#F5F7FA] mt-0.5 font-mono text-xs break-all">{certId}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#9AA6B8]">Status</dt>
            <dd className="text-slate-900 dark:text-[#F5F7FA] mt-0.5">{item.lifecycleStatus}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={onPreview}>
            Preview
          </button>
          <Link
            to={`/verify-certificate?id=${encodeURIComponent(certId)}`}
            className="btn btn-secondary btn-sm"
          >
            Verify
          </Link>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyLink()}>
            Copy verification link
          </button>
          {item.relatedAsset?.href && (
            <Link to={item.relatedAsset.href} className="btn btn-secondary btn-sm">
              View protected asset
            </Link>
          )}
        </div>
      </div>
    </Modal>
  );
}
