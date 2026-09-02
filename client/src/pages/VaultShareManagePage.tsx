import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  RefreshCw,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ShareQrBlock } from '../components/ShareQrBlock';
import { Badge } from '../components/ui/Badge';
import { BRAND } from '../config/brand.config';
import { API_BASE_URL } from '../config/api.config';
import { api, getVaultRecord } from '../services/dashboard.api';
import type { VaultRecord } from '../types/dashboard.types';

interface ShareManageState {
  shareUrl?: string;
  token?: string;
  shareId?: string;
  expiresIn?: string | null;
  maxViews?: string | null;
  allowDownload?: boolean;
  requireName?: boolean;
  requestLocation?: boolean;
  privacyMaskingEnabled?: boolean;
  reviewMode?: boolean;
  allowComments?: boolean;
  allowChangeRequest?: boolean;
  allowApproval?: boolean;
  watermark?: boolean;
  tracking?: boolean;
  createdAt?: string;
  filename?: string;
  expiresAt?: string | null;
  viewCount?: number;
  isActive?: boolean;
  devOtp?: string;
  devOtpNote?: string;
}

interface VaultShareLink {
  id: string;
  token: string;
  filename?: string;
  createdAt: string;
  expiresAt: string | null;
  maxViews: number | null;
  viewCount?: number;
  allowDownload: boolean;
  isActive: boolean;
  requireName?: boolean;
  requestLocation?: boolean;
  privacyMaskingEnabled?: boolean;
  reviewMode?: boolean;
  allowComments?: boolean;
  allowChangeRequest?: boolean;
  allowApproval?: boolean;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-bg-border last:border-0">
      <span className="text-2xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-white text-right min-w-0 break-all">{value}</span>
    </div>
  );
}

function resolveShareUrl(token: string, fromState?: string) {
  if (fromState) return fromState;
  if (typeof window === 'undefined') return `/s/${token}`;
  return `${window.location.origin}/s/${token}`;
}

export function VaultShareManagePage() {
  const { assetId = '', shareId = '' } = useParams<{ assetId: string; shareId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = (location.state ?? {}) as ShareManageState;
  const token = decodeURIComponent(shareId);

  const [record, setRecord] = useState<VaultRecord | null>(null);
  const [link, setLink] = useState<VaultShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!assetId || !token) {
        setError('Missing share reference');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [vault, linksRes] = await Promise.all([
          getVaultRecord(assetId) as Promise<VaultRecord>,
          api.get(`${API_BASE_URL}/share/vault/${assetId}`),
        ]);
        if (cancelled) return;
        setRecord(vault?.id ? vault : null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const links = ((linksRes.data as any).links ?? []) as VaultShareLink[];
        const found = links.find((l) => l.token === token || l.id === token) ?? null;
        setLink(found);
        if (!vault?.id) setError('Asset not found');
      } catch {
        if (!cancelled) setError('Could not load share details');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId, token]);

  const shareUrl = useMemo(
    () => resolveShareUrl(token, navState.shareUrl),
    [token, navState.shareUrl],
  );

  const createdAt = link?.createdAt ?? navState.createdAt ?? null;
  const expiresAt = link?.expiresAt ?? navState.expiresAt ?? null;
  const maxViews = link?.maxViews ?? (navState.maxViews ? Number(navState.maxViews) : null);
  const allowDownload = link?.allowDownload ?? navState.allowDownload ?? false;

  // Review permissions, preferring the server's copy over what we navigated with.
  const reviewMode         = link?.reviewMode ?? navState.reviewMode ?? false;
  const allowComments      = link?.allowComments ?? navState.allowComments ?? false;
  const allowChangeRequest = link?.allowChangeRequest ?? navState.allowChangeRequest ?? false;
  const allowApproval      = link?.allowApproval ?? navState.allowApproval ?? false;
  const filename = link?.filename ?? navState.filename ?? record?.originalFileName ?? 'Protected file';
  const isActive = link?.isActive ?? true;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      api.post(`${API_BASE_URL}/share/${token}/access`, { action: 'COPIED' }).catch(() => {});
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  };

  const handleNativeShare = async () => {
    const shareData: ShareData = {
      title: filename,
      text: `Secure file via ${BRAND.name}\n${shareUrl}`,
      url: shareUrl,
    };
    const canShare =
      typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && (typeof navigator.canShare !== 'function' || navigator.canShare(shareData));

    if (canShare) {
      try {
        await navigator.share(shareData);
        toast.success('Shared');
        return;
      } catch (err) {
        const name = (err as { name?: string })?.name ?? '';
        if (name === 'AbortError') return;
      }
    }
    await handleCopy();
  };

  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[40vh]">
        <RefreshCw className="animate-spin text-dna-400" size={22} />
      </div>
    );
  }

  if (error && !record && !navState.shareUrl) {
    return (
      <div className="page-shell animate-fade-in space-y-4">
        <p className="text-sm text-danger">{error}</p>
        <Link to="/vault" className="btn btn-secondary btn-sm inline-flex">
          <ArrowLeft size={14} /> Back to My Assets
        </Link>
      </div>
    );
  }

  return (
    <div className="page-shell animate-fade-in space-y-5">
      <nav className="flex flex-wrap items-center gap-1.5 text-2xs text-gray-500">
        <span className="text-gray-400">{BRAND.name}</span>
        <ChevronRight size={10} />
        <Link to="/vault" className="hover:text-white transition-colors">My Assets</Link>
        <ChevronRight size={10} />
        <Link
          to={`/vault/assets/${assetId}/share`}
          className="hover:text-white transition-colors truncate max-w-[12rem]"
        >
          {filename}
        </Link>
        <ChevronRight size={10} />
        <span className="text-white">Manage Share</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate(`/vault/assets/${assetId}/share`)}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white mb-2"
          >
            <ArrowLeft size={13} /> Back to share setup
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Secure link ready</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Copy, send, or manage this tracked share link. Every open appears in Tracking.
          </p>
        </div>
        <Badge variant={isActive ? 'success' : 'danger'} dot>
          {isActive ? 'Active' : 'Revoked'}
        </Badge>
      </div>

      {navState.devOtp && (
        <div className="rounded-xl bg-warning/5 border border-warning/20 p-4">
          <p className="text-2xs text-warning font-semibold mb-1">Verification code (share this manually)</p>
          <p className="text-lg font-mono tracking-[0.35em] text-white">{navState.devOtp}</p>
          {navState.devOtpNote && <p className="text-2xs text-gray-500 mt-1">{navState.devOtpNote}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <section className="card space-y-4">
          <div className="rounded-xl bg-success/5 border border-success/20 p-4 flex items-start gap-3">
            <ShieldCheck size={18} className="text-success shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-success">Secure link created</p>
              <p className="text-2xs text-gray-400 mt-0.5">
                Access is controlled by your policy. Recipients open via the URL below.
              </p>
            </div>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-bg-border p-3">
            <p className="text-2xs text-gray-500 mb-1.5 font-semibold">Generated secure URL</p>
            <div className="flex items-center gap-2">
              <p className="text-xs text-dna-400 mono flex-1 break-all">{shareUrl}</p>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className={`btn btn-sm shrink-0 ${copied ? 'btn-secondary' : 'btn-primary'}`}
              >
                {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
          </div>

          <ShareQrBlock url={shareUrl} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <DetailRow
              label="Expiration"
              value={
                expiresAt
                  ? format(new Date(expiresAt), 'PPp')
                  : navState.expiresIn
                    ? `In ${navState.expiresIn} hours`
                    : 'Never'
              }
            />
            <DetailRow label="Maximum views" value={maxViews ?? 'Unlimited'} />
            <DetailRow label="Download permission" value={allowDownload ? 'Allowed' : 'Blocked'} />
            <DetailRow label="Watermark status" value="Enabled" />
            <DetailRow label="Tracking status" value="Enabled — all opens logged" />
            <DetailRow
              label="Created"
              value={createdAt ? format(new Date(createdAt), 'PPp') : 'Just now'}
            />
            {(navState.requireName ?? link?.requireName) && (
              <DetailRow label="Recipient name" value="Required" />
            )}
            {(navState.requestLocation ?? link?.requestLocation) && (
              <DetailRow label="Location" value="Requested on open" />
            )}
            {(navState.privacyMaskingEnabled ?? link?.privacyMaskingEnabled) && (
              <DetailRow label="Sensitive masking" value="Enabled" />
            )}
            <DetailRow label="Review" value={reviewMode ? 'Enabled' : 'View only'} />
            {reviewMode && (
              <>
                <DetailRow label="Comments" value={allowComments ? 'Allowed' : 'Blocked'} />
                <DetailRow label="Change requests" value={allowChangeRequest ? 'Allowed' : 'Blocked'} />
                <DetailRow
                  label="Approval"
                  value={allowApproval ? 'Allowed — decision is recorded' : 'Not allowed'}
                />
              </>
            )}
          </div>

          {/* Say plainly what the recipient can do, so the sender can check it
              against what they intended before passing the link on. */}
          <div className={`rounded-xl border px-3 py-2.5 ${
            reviewMode ? 'border-dna-500/30 bg-dna-500/5' : 'border-bg-border bg-bg-elevated/50'
          }`}>
            <p className="text-2xs text-gray-400">
              This recipient can{' '}
              <span className="text-gray-200 font-medium">
                {[
                  'open the file',
                  allowDownload && 'download it',
                  reviewMode && allowComments && 'comment',
                  reviewMode && allowChangeRequest && 'request changes',
                  reviewMode && allowApproval && 'approve the current version',
                ].filter(Boolean).join(', ')}
              </span>.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => void handleCopy()} className="btn btn-primary btn-sm">
              <Copy size={13} /> Copy Link
            </button>
            <button type="button" onClick={() => void handleNativeShare()} className="btn btn-secondary btn-sm">
              <Share2 size={13} /> Send / Share
            </button>
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
            >
              <ExternalLink size={13} /> View Link
            </a>
            <Link
              to={`/access-intelligence/${encodeURIComponent(token)}`}
              className="btn btn-secondary btn-sm"
            >
              <Eye size={13} /> Manage Share
            </Link>
            <Link to="/vault" className="btn btn-ghost btn-sm text-gray-300">
              Back to Asset
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Secure file: ${shareUrl}`)}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm text-xs justify-center"
            >
              WhatsApp
            </a>
            <a
              href={`mailto:?subject=Shared+File&body=${encodeURIComponent(`Access this secure file: ${shareUrl}`)}`}
              className="btn btn-secondary btn-sm text-xs justify-center"
            >
              Email
            </a>
            <Link
              to={`/access-intelligence?vaultId=${encodeURIComponent(assetId)}`}
              className="btn btn-secondary btn-sm text-xs justify-center"
            >
              All links for file
            </Link>
          </div>
        </section>

        <aside className="card space-y-3 lg:sticky lg:top-20">
          <p className="text-xs font-semibold text-gray-300">Asset</p>
          <p className="text-sm font-semibold text-white break-words">{filename}</p>
          <DetailRow label="Share token" value={<span className="mono text-dna-400">{token}</span>} />
          <DetailRow label="Views so far" value={link?.viewCount ?? 0} />
          <DetailRow label="Status" value={isActive ? 'Active' : 'Revoked'} />
          <Link
            to={`/vault/assets/${assetId}/share`}
            className="btn btn-secondary btn-sm w-full justify-center mt-2"
          >
            Create another link
          </Link>
        </aside>
      </div>
    </div>
  );
}
