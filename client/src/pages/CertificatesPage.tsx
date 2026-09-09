/**
 * PINIT HUB — Credentials
 *
 * Phase 1: Pinit-issued certificates only.
 * Portfolio awards/certificates are not shown here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Ban, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Link, useSearchParams } from 'react-router-dom';

import { listMyHubCredentials, revokeCertificate, type HubCredential } from '../services/dashboard.api';
import { useAuth } from '../context/AuthContext';
import { toRootPinitId } from '../lib/pinit-identity';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { cn } from '../components/ui/utils';
import { CredentialPreviewModal } from '../components/certificates/CredentialPreviewModal';
import { CredentialDetailsModal } from '../components/certificates/CredentialDetailsModal';

type FilterTab = 'all' | 'certificate' | 'award' | 'license' | 'course' | 'workshop';

const TABS: Array<{ key: FilterTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'certificate', label: 'Certificates' },
  { key: 'award', label: 'Awards' },
  { key: 'license', label: 'Licenses' },
  { key: 'course', label: 'Courses' },
  { key: 'workshop', label: 'Workshops' },
];

function trustLabel(state: HubCredential['trustState']): string {
  if (state === 'PINIT_VERIFIED') return 'Pinit Verified';
  if (state === 'PINIT_ISSUED') return 'Pinit Issued';
  if (state === 'SELF_ADDED_EVIDENCE_PROTECTED') return 'Self-added · Evidence protected';
  if (state === 'SELF_ADDED') return 'Self-added';
  return 'Coming soon';
}

function formatIssued(raw: string | null): string {
  if (!raw) return 'Date not recorded';
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return format(new Date(parsed), 'd MMM yyyy');
  return raw;
}

function publicCertId(item: HubCredential): string | null {
  return item.source?.id || null;
}

function matchesDeepLink(item: HubCredential, deep: string): boolean {
  return item.id === deep || item.source.id === deep;
}

function RevokeDialog({
  certId,
  filename,
  onConfirm,
  onCancel,
}: {
  certId: string;
  filename: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!reason.trim()) { toast.error('Revocation reason is required'); return; }
    setLoading(true);
    onConfirm(reason.trim());
  };

  return (
    <Modal open title="Revoke Certificate" onClose={onCancel} size="md">
      <div className="p-1 space-y-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Revoking <span className="text-slate-900 dark:text-white font-medium">{filename}</span> marks credential{' '}
          <span className="font-mono text-xs">{certId}</span> as invalid.
        </p>
        <label className="block">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Revocation reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="input resize-none text-sm mt-2"
          />
        </label>
        <div className="flex gap-3">
          <button type="button" onClick={handle} disabled={loading || !reason.trim()} className="btn btn-danger flex-1">
            {loading ? 'Revoking…' : 'Revoke Certificate'}
          </button>
          <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function CredentialCard({
  item,
  onPreview,
  onDetails,
  onRevoke,
}: {
  item: HubCredential;
  onPreview: () => void;
  onDetails: () => void;
  onRevoke: () => void;
}) {
  const isRevoked = item.lifecycleStatus === 'REVOKED';
  const certId = publicCertId(item);

  return (
    <article className="rounded-xl border border-slate-200 dark:border-[#252C38] bg-white dark:bg-[#11151D] p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-block text-[10px] tracking-[0.14em] uppercase text-slate-600 dark:text-[#9AA6B8] border border-slate-200 dark:border-[#252C38] rounded-full px-2 py-0.5">
          Certificate
        </span>
        <span className="shrink-0 text-[11px] font-medium text-emerald-700 dark:text-[#32D583]">
          ✓ {trustLabel(item.trustState)}
        </span>
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-slate-900 dark:text-[#F5F7FA] leading-snug">{item.title}</h3>
        <p className="text-[13px] text-slate-600 dark:text-[#9AA6B8] mt-1">{item.issuer}</p>
      </div>

      <dl className="border-t border-slate-200 dark:border-[#252C38] pt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div>
          <dt className="text-slate-500 dark:text-[#9AA6B8] text-[11px]">Issued</dt>
          <dd className="text-slate-900 dark:text-[#F5F7FA] mt-0.5">{formatIssued(item.issuedAt)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-[#9AA6B8] text-[11px]">Status</dt>
          <dd className="text-slate-900 dark:text-[#F5F7FA] mt-0.5 capitalize">{item.lifecycleStatus.toLowerCase()}</dd>
        </div>
      </dl>

      {isRevoked && (
        <p className="text-xs text-danger">This Pinit certificate is revoked</p>
      )}

      <div className="mt-auto flex items-center gap-1 overflow-x-auto pb-0.5">
        <button
          type="button"
          className="shrink-0 h-7 min-h-0 px-2 rounded-md bg-[#2f7cf6] text-[10px] font-medium leading-none whitespace-nowrap"
          style={{ color: '#fff' }}
          onClick={onPreview}
        >
          Preview certificate
        </button>
        <button
          type="button"
          className="shrink-0 h-7 min-h-0 px-2 rounded-md border border-slate-300 bg-white text-[10px] font-medium text-slate-800 leading-none whitespace-nowrap dark:border-[#2A3040] dark:bg-[#171B24] dark:text-[#F5F7FA]"
          onClick={onDetails}
        >
          View verification
        </button>
        {item.relatedAsset?.href && (
          <Link
            to={item.relatedAsset.href}
            className="shrink-0 h-7 min-h-0 px-2 rounded-md border border-slate-300 bg-white text-[10px] font-medium text-slate-800 leading-none whitespace-nowrap inline-flex items-center dark:border-[#2A3040] dark:bg-[#171B24] dark:text-[#F5F7FA]"
          >
            View protected asset
          </Link>
        )}
        {item.lifecycleStatus === 'ACTIVE' && certId && (
          <button
            type="button"
            className="shrink-0 h-7 min-h-0 px-2 rounded-md text-[10px] font-medium text-danger leading-none whitespace-nowrap"
            onClick={onRevoke}
          >
            Revoke
          </button>
        )}
      </div>
    </article>
  );
}

export function CertificatesPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<HubCredential[]>([]);
  const [counts, setCounts] = useState({ total: 0, pinitVerified: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [revokeItem, setRevokeItem] = useState<HubCredential | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listMyHubCredentials();
      setItems(result.credentials);
      setCounts(result.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const deep = searchParams.get('id');
    if (!deep || !items.length) return;
    const match = items.find((i) => matchesDeepLink(i, deep));
    if (match) setDetailsId(match.id);
  }, [searchParams, items]);

  const filtered = useMemo(() => {
    if (filter === 'all' || filter === 'certificate') return items;
    return [];
  }, [items, filter]);

  const previewItem = items.find((i) => i.id === previewId) ?? null;
  const detailsItem = items.find((i) => i.id === detailsId) ?? null;

  const handleRevoke = async (reason: string) => {
    const item = revokeItem;
    setRevokeItem(null);
    const certId = item ? publicCertId(item) : null;
    if (!certId) return;
    const loadingToast = toast.loading('Processing revocation…');
    try {
      await revokeCertificate(certId, reason);
      await load();
      toast.dismiss(loadingToast);
      toast.success('Certificate revoked');
    } catch (err) {
      toast.dismiss(loadingToast);
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? (err instanceof Error ? err.message : 'Unknown error');
      toast.error(`Revocation failed: ${msg}`, { duration: 6000 });
    }
  };

  const emptyCopy = () => {
    if (filter === 'award') {
      return {
        title: 'Awards come in the next phase',
        description: 'You will be able to add achievements and optionally protect their supporting evidence with Pinit.',
      };
    }
    if (filter === 'license') {
      return {
        title: 'No Exchange licenses yet',
        description: 'Licenses from your Pinit Exchange purchases will appear here.',
      };
    }
    if (filter === 'course') {
      return {
        title: 'Courses are coming soon',
        description: 'Learning credentials from Pinit Career will appear here when available.',
      };
    }
    if (filter === 'workshop') {
      return {
        title: 'Workshops are coming soon',
        description: 'Workshop credentials from Pinit Business will appear here.',
      };
    }
    if (filter === 'certificate') {
      return {
        title: 'No Pinit certificates yet.',
        description: 'Certificates issued by Pinit will appear here.',
      };
    }
    return {
      title: 'No credentials yet.',
      description: 'Certificates issued by Pinit for your protected assets will appear here.',
    };
  };

  return (
    <div className="page-shell max-w-[1600px] space-y-6 animate-fade-in pb-10">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Credentials</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            Certificates, awards, licenses and professional achievements connected to your Pinit identity.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn btn-secondary btn-sm" aria-label="Refresh credentials">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border border-slate-200 dark:border-[#252C38] bg-white dark:bg-[#11151D] px-3 py-2.5 h-16 animate-pulse" />
          <div className="rounded-lg border border-slate-200 dark:border-[#252C38] bg-white dark:bg-[#11151D] px-3 py-2.5 h-16 animate-pulse" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border border-slate-200 dark:border-[#252C38] bg-white dark:bg-[#11151D] px-3 py-2.5">
            <p className="text-[11px] text-slate-500 dark:text-[#9AA6B8]">Total credentials</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-[#F5F7FA]">{counts.total}</p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-[#252C38] bg-white dark:bg-[#11151D] px-3 py-2.5">
            <p className="text-[11px] text-slate-500 dark:text-[#9AA6B8]">Pinit verified</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-[#F5F7FA]">{counts.pinitVerified}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-md border transition-colors',
                filter === tab.key
                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-[#1C2130] dark:border-[#35D6A2]/50 dark:text-[#F5F7FA]'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-[#F5F7FA]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-slate-200 dark:border-[#2A3040] bg-white dark:bg-[#171B24] p-6 text-center">
          <p className="text-danger text-sm mb-3">{error}</p>
          <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={filter === 'all' || filter === 'certificate' ? Award : Ban}
          title={emptyCopy().title}
          description={emptyCopy().description}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {filtered.map((item) => (
            <CredentialCard
              key={item.id}
              item={item}
              onPreview={() => setPreviewId(item.id)}
              onDetails={() => setDetailsId(item.id)}
              onRevoke={() => setRevokeItem(item)}
            />
          ))}
        </div>
      )}

      {previewItem && (
        <CredentialPreviewModal
          item={previewItem}
          recipientName={user?.name || previewItem.recipientName}
          recipientPinitId={toRootPinitId(user?.shortId) || user?.shortId || null}
          onClose={() => setPreviewId(null)}
          onViewDetails={() => { setPreviewId(null); setDetailsId(previewItem.id); }}
        />
      )}
      {detailsItem && (
        <CredentialDetailsModal
          item={detailsItem}
          recipientName={user?.name || detailsItem.recipientName}
          onClose={() => setDetailsId(null)}
          onPreview={() => { setDetailsId(null); setPreviewId(detailsItem.id); }}
        />
      )}
      {revokeItem && publicCertId(revokeItem) && (
        <RevokeDialog
          certId={publicCertId(revokeItem)!}
          filename={revokeItem.title}
          onConfirm={(reason) => void handleRevoke(reason)}
          onCancel={() => setRevokeItem(null)}
        />
      )}
    </div>
  );
}
