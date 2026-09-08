/**
 * PINIT-DNA — Credential registry
 *
 * Information cards for issued certificates and portfolio credentials.
 * Certificate artwork is shown only in Preview.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award, Ban, Plus, RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';

import {
  listVaultRecords,
  issueCertificate,
  listCertificates,
  revokeCertificate,
  api,
} from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { cn } from '../components/ui/utils';
import { CredentialPreviewModal } from '../components/certificates/CredentialPreviewModal';
import { CredentialDetailsModal } from '../components/certificates/CredentialDetailsModal';
import { AddCredentialModal } from '../components/certificates/AddCredentialModal';
import { CredentialBadge } from '../components/certificates/CredentialBadge';
import {
  KIND_LABEL,
  buildRegistryCredentials,
  compactCredentialId,
  credentialSeal,
  earliestYear,
  parsePortfolioHints,
  registryMetrics,
  sortCredentials,
  type CredentialKind,
  type RegistryCredential,
} from '../lib/credential-registry';
import type { IssuedCertificate, VaultRecord } from '../types/dashboard.types';

type FilterTab = 'all' | CredentialKind;
type SortKey = 'newest' | 'oldest' | 'verified' | 'alpha';

const TABS: Array<{ key: FilterTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'award', label: 'Awards' },
  { key: 'license', label: 'Licenses' },
  { key: 'course', label: 'Courses' },
  { key: 'workshop', label: 'Workshops' },
  { key: 'certificate', label: 'Certifications' },
];

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
        <p className="text-sm text-gray-400">
          Revoking <span className="text-white font-medium">{filename}</span> marks credential{' '}
          <span className="font-mono text-xs">{certId}</span> as invalid.
        </p>
        <label className="block">
          <span className="text-xs font-semibold text-gray-300">Revocation reason</span>
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

function formatIssued(raw: string | null): string {
  if (!raw) return 'Date not recorded';
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return format(new Date(parsed), 'd MMM yyyy');
  return raw;
}

function CredentialCard({
  item,
  onPreview,
  onDetails,
  onShare,
  onRevoke,
}: {
  item: RegistryCredential;
  onPreview: () => void;
  onDetails: () => void;
  onShare: () => void;
  onRevoke: () => void;
}) {
  const cert = item.certificate;
  const isRevoked = cert?.status === 'REVOKED';
  const seal = credentialSeal(item.human);
  const credId = compactCredentialId(cert?.certificateId);

  return (
    <article className="rounded-xl border border-[#252C38] bg-[#11151D] hover:bg-[#161C27] p-5 flex flex-col gap-4 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <CredentialBadge human={item.human} size={64} />
          <div className="min-w-0">
            {seal.tier && (
              <p className="text-[10px] tracking-[0.18em] uppercase font-semibold" style={{ color: seal.tier === 'gold' ? '#D9A441' : seal.tier === 'silver' ? '#C5CDD8' : '#C4845A' }}>
                {seal.headline} · {seal.tier}
              </p>
            )}
            <span className="inline-block mt-1 text-[10px] tracking-[0.14em] uppercase text-[#9AA6B8] border border-[#252C38] rounded-full px-2 py-0.5">
              {KIND_LABEL[item.kind]}
            </span>
          </div>
        </div>
        {item.protectedInHub && (
          <span className="shrink-0 text-[11px] text-[#32D583]">✓ Pinit HUB Protected</span>
        )}
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-[#F5F7FA] leading-snug">{item.title}</h3>
        <p className="text-[13px] text-[#9AA6B8] mt-1">
          {KIND_LABEL[item.kind]}
          {item.issuer ? ` · ${item.issuer}` : ''}
        </p>
      </div>

      {item.recipientName && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[#9AA6B8]">Awarded to</p>
          <p className="text-[14px] text-[#F5F7FA] mt-0.5">{item.recipientName}</p>
        </div>
      )}

      <dl className="border-t border-[#252C38] pt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div>
          <dt className="text-[#9AA6B8] text-[11px]">Issued</dt>
          <dd className="text-[#F5F7FA] mt-0.5">{formatIssued(item.issuedAt)}</dd>
        </div>
        {credId && (
          <div>
            <dt className="text-[#9AA6B8] text-[11px]">Credential</dt>
            <dd className="text-[#F5F7FA] mt-0.5 font-mono text-[12px] break-all">{credId}</dd>
          </div>
        )}
        {seal.percent != null && (
          <div>
            <dt className="text-[#9AA6B8] text-[11px]">Human</dt>
            <dd className="text-[#F5F7FA] mt-0.5">{seal.percent}%</dd>
          </div>
        )}
      </dl>

      {isRevoked && (
        <p className="text-xs text-danger">This Pinit certificate is revoked</p>
      )}

      <div className="flex flex-wrap gap-2 mt-auto">
        <button type="button" className="btn btn-primary btn-sm" onClick={onPreview}>
          Preview certificate
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDetails}>
          View verification
        </button>
        {cert?.certificateId && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onShare}>
            Share credential
          </button>
        )}
        {cert?.status === 'ACTIVE' && (
          <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={onRevoke}>
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
  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [items, setItems] = useState<RegistryCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [revokeItem, setRevokeItem] = useState<RegistryCredential | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vaultRows, certs, portfolioRes] = await Promise.all([
        listVaultRecords(),
        listCertificates().catch((): IssuedCertificate[] => []),
        api.get(`${API_BASE_URL}/portfolio/me`).catch(() => ({ data: null })),
      ]);
      setVaults(vaultRows);
      const hints = parsePortfolioHints(portfolioRes.data);
      setItems(buildRegistryCredentials({
        vaults: vaultRows,
        certificates: certs,
        hints,
        recipientName: user?.name || null,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }, [user?.name]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const deep = searchParams.get('id');
    if (!deep || !items.length) return;
    const match = items.find((i) => i.certificate?.certificateId === deep || i.id === deep);
    if (match) setDetailsId(match.id);
  }, [searchParams, items]);

  const filtered = useMemo(() => {
    const byTab = filter === 'all' ? items : items.filter((i) => i.kind === filter);
    return sortCredentials(byTab, sort);
  }, [items, filter, sort]);

  const metrics = registryMetrics(items);
  const sinceYear = earliestYear(items);
  const previewItem = items.find((i) => i.id === previewId) ?? null;
  const detailsItem = items.find((i) => i.id === detailsId) ?? null;

  const shareCredential = async (item: RegistryCredential) => {
    const id = item.certificate?.certificateId;
    if (!id) { toast.error('No public credential URL until a Pinit certificate is issued'); return; }
    const url = `${window.location.origin}/verify-certificate?id=${encodeURIComponent(id)}`;
    await navigator.clipboard.writeText(url);
    toast.success('Verification link copied');
  };

  const handleRevoke = async (reason: string) => {
    const item = revokeItem;
    setRevokeItem(null);
    if (!item?.vault) return;
    const loadingToast = toast.loading('Processing revocation…');
    try {
      const issued = item.certificate ?? await issueCertificate(item.vault.dnaRecordId, item.vault.id);
      const updated = await revokeCertificate(issued.certificateId, reason);
      setItems((prev) => prev.map((row) => (
        row.id === item.id || row.vault?.id === item.vault?.id
          ? { ...row, certificate: updated }
          : row
      )));
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
    if (filter === 'award') return { title: 'No awards added yet.', description: 'Awards you record in Pinit will appear here.' };
    if (filter === 'license') return { title: 'No licenses added yet.', description: 'Licenses linked to protected documents will appear here.' };
    if (filter === 'course') return { title: 'No courses added yet.', description: 'Course credentials will appear here.' };
    if (filter === 'workshop') return { title: 'No workshops added yet.', description: 'Workshop credentials will appear here.' };
    if (filter === 'certificate') return { title: 'No certificates yet', description: 'Certificates, awards and other professional achievements will appear here.' };
    return {
      title: 'No credentials have been added yet.',
      description: 'Certificates, awards and licenses connected to your Pinit identity will appear here.',
    };
  };

  return (
    <div className="page-shell max-w-[1280px] space-y-6 animate-fade-in pb-10">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#F5F7FA]">Certificates</h1>
          <p className="text-sm text-[#9AA6B8] mt-1">Credentials, recognitions and licenses connected to your Pinit identity.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add credential
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="btn btn-secondary btn-sm" aria-label="Refresh credentials">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border border-[#252C38] bg-[#11151D] px-3 py-2.5">
            <p className="text-[11px] text-[#9AA6B8]">Credentials</p>
            <p className="text-lg font-semibold text-[#F5F7FA]">{metrics.total}</p>
          </div>
          <div className="rounded-lg border border-[#252C38] bg-[#11151D] px-3 py-2.5">
            <p className="text-[11px] text-[#9AA6B8]">Human Verified</p>
            <p className="text-lg font-semibold text-[#F5F7FA]">{metrics.humanVerifiedCount}</p>
          </div>
          <div className="rounded-lg border border-[#252C38] bg-[#11151D] px-3 py-2.5">
            <p className="text-[11px] text-[#9AA6B8]">Protected</p>
            <p className="text-lg font-semibold text-[#F5F7FA]">{metrics.protectedCount}</p>
          </div>
          {sinceYear != null && (
            <div className="rounded-lg border border-[#252C38] bg-[#11151D] px-3 py-2.5">
              <p className="text-[11px] text-[#9AA6B8]">Since</p>
              <p className="text-lg font-semibold text-[#F5F7FA]">{sinceYear}</p>
            </div>
          )}
        </div>
      )}

      {!loading && items.length > 0 && (
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
                    ? 'bg-[#1C2130] border-[#35D6A2]/50 text-[#F5F7FA]'
                    : 'border-transparent text-[#A7B0C0] hover:text-white',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <label className="text-xs text-[#A7B0C0] flex items-center gap-2">
            <span className="sr-only">Sort credentials</span>
            <select
              className="bg-[#171B24] border border-[#2A3040] rounded-md px-2 py-1 text-xs text-[#F5F7FA]"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="verified">Most recently verified</option>
              <option value="alpha">Alphabetical</option>
            </select>
          </label>
        </div>
      )}

      {error ? (
        <div className="rounded-xl border border-[#2A3040] bg-[#171B24] p-6 text-center">
          <p className="text-danger text-sm mb-3">{error}</p>
          <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={filter === 'all' ? Award : Ban}
          title={emptyCopy().title}
          description={emptyCopy().description}
          action={(
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Add credential
            </button>
          )}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((item) => (
            <CredentialCard
              key={item.id}
              item={item}
              onPreview={() => setPreviewId(item.id)}
              onDetails={() => setDetailsId(item.id)}
              onShare={() => void shareCredential(item)}
              onRevoke={() => setRevokeItem(item)}
            />
          ))}
        </div>
      )}

      {previewItem && (
        <CredentialPreviewModal
          item={previewItem}
          onClose={() => setPreviewId(null)}
          onViewDetails={() => { setPreviewId(null); setDetailsId(previewItem.id); }}
          onPrev={(() => {
            const i = filtered.findIndex((row) => row.id === previewItem.id);
            if (i <= 0) return undefined;
            return () => setPreviewId(filtered[i - 1].id);
          })()}
          onNext={(() => {
            const i = filtered.findIndex((row) => row.id === previewItem.id);
            if (i < 0 || i >= filtered.length - 1) return undefined;
            return () => setPreviewId(filtered[i + 1].id);
          })()}
        />
      )}
      {detailsItem && (
        <CredentialDetailsModal
          item={detailsItem}
          onClose={() => setDetailsId(null)}
          onPreview={() => { setDetailsId(null); setPreviewId(detailsItem.id); }}
          onHumanUpdate={(next) => {
            setItems((prev) => prev.map((row) => (row.id === next.id ? next : row)));
          }}
        />
      )}
      {revokeItem && (
        <RevokeDialog
          certId={revokeItem.certificate?.certificateId || revokeItem.id}
          filename={revokeItem.title}
          onConfirm={(reason) => void handleRevoke(reason)}
          onCancel={() => setRevokeItem(null)}
        />
      )}
      {addOpen && (
        <AddCredentialModal vaults={vaults} onClose={() => setAddOpen(false)} onAdded={() => void load()} />
      )}
    </div>
  );
}
