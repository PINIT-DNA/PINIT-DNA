/**
 * Create a tracked share link without leaving the vault.
 *
 * Sharing used to be a full page of stacked toggle rows and then a second page to
 * read the URL. Twelve toggle rows is 780px of scrolling on its own, so the whole
 * layout here is built on chips instead: a chip is on when filled and off when
 * outlined, which is the same information in a tenth of the height. Everything
 * fits on one screen, and the finished link appears in the same box.
 *
 * The full page at /vault/assets/:id/share still exists for the rest of the policy
 * set. This is the everyday path, not a replacement for it.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, Share2, CheckCircle2, Loader2, Clock, Eye, User, Globe, EyeOff, Droplet, MoreHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';

type ExistingLink = { id?: string; token: string; isActive?: boolean; viewCount?: number };

/** The API takes a number of hours, not a label. Empty means never. */
const EXPIRY = [
  { label: '1h', value: '1' },
  { label: '24h', value: '24' },
  { label: '7 days', value: '168' },
  { label: '30d', value: '720' },
  { label: 'Never', value: '' },
] as const;

const splitList = (raw: string) =>
  raw.split(',').map((s) => s.trim()).filter(Boolean);

export function ShareLinkDialog({
  vaultId,
  filename,
  sizeBytes,
  onClose,
}: {
  vaultId: string;
  filename: string;
  sizeBytes?: number;
  onClose: () => void;
}) {
  const [expiresIn, setExpiresIn] = useState<string>('168'); // 7 days, in hours
  const [maxViews, setMaxViews] = useState('');
  const [maxDownloads, setMaxDownloads] = useState('');
  const [allowDownload, setAllowDownload] = useState(false);

  const [requireName, setRequireName] = useState(false);
  const [requireOtp, setRequireOtp] = useState(false);
  const [requestLocation, setRequestLocation] = useState(true);
  const [oneDeviceOnly, setOneDeviceOnly] = useState(false);

  const [allowedCountries, setAllowedCountries] = useState('');
  const [vpnBlock, setVpnBlock] = useState(false);
  const [torBlock, setTorBlock] = useState(false);

  const [hideSensitive, setHideSensitive] = useState(false);

  const [showMore, setShowMore] = useState(false);
  const [oneTimeUse, setOneTimeUse] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [allowedIpPrefixes, setAllowedIpPrefixes] = useState('');
  const [note, setNote] = useState('');

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string; shareUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [links, setLinks] = useState<ExistingLink[] | null>(null);
  /** null = still loading, [] = genuinely none, string = the request failed. */
  const [linksError, setLinksError] = useState<string | null>(null);

  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadLinks = async () => {
    setLinksError(null);
    try {
      const { data } = await api.get(`${API_BASE_URL}/share/vault/${vaultId}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setLinks(((data as any).links ?? []) as ExistingLink[]);
    } catch (err) {
      // An empty list where the request failed reads as "your links are gone",
      // which is the one thing it must never imply.
      setLinks(null);
      setLinksError(
        (err as { response?: { status?: number } })?.response?.status === 403
          ? 'You do not have access to this file’s links.'
          : 'Could not load existing links.',
      );
    }
  };

  useEffect(() => { void loadLinks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vaultId]);

  const create = async () => {
    setCreating(true);
    try {
      const { data } = await api.post(`${API_BASE_URL}/share`, {
        vaultId,
        expiresIn: expiresIn ? Number(expiresIn) : null,
        maxViews: maxViews ? Number(maxViews) : null,
        maxDownloads: allowDownload && maxDownloads ? Number(maxDownloads) : null,
        allowDownload,
        requireName,
        requireOtp,
        requestLocation,
        oneDeviceOnly,
        allowedCountries: splitList(allowedCountries),
        vpnBlock,
        torBlock,
        // One switch in the UI, the same five flags on the wire — the granularity
        // stays in the record, the decision does not land on the sender.
        privacyMaskingEnabled: hideSensitive,
        maskEmail: hideSensitive,
        maskPhone: hideSensitive,
        maskAadhaar: hideSensitive,
        maskPan: hideSensitive,
        maskAddress: hideSensitive,
        oneTimeUse,
        recipientEmail: recipientEmail.trim() || undefined,
        allowedIpPrefixes: splitList(allowedIpPrefixes),
        note: note.trim() || undefined,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      const token = String(d.token ?? '');
      const shareUrl = String(d.shareUrl ?? '');
      if (!token || !shareUrl) throw new Error('Missing share response');
      setCreated({ token, shareUrl });
      setCopied(false);
      toast.success('Secure link created');
      void loadLinks();
    } catch {
      toast.error('Could not create the link');
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.shareUrl);
      setCopied(true);
      toast.success('Link copied');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the link and copy it manually');
    }
  };

  const activeCount = links?.filter((l) => l.isActive).length ?? 0;
  const sizeLabel = typeof sizeBytes === 'number' && sizeBytes > 0
    ? ` · ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-bg-border bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${filename}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-bg-border">
          <div className="w-8 h-8 rounded-lg bg-dna-500/20 flex items-center justify-center shrink-0">
            <Share2 size={15} className="text-dna-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white leading-tight">Share secure link</h2>
            <p className="text-2xs text-gray-500 truncate">{filename}{sizeLabel}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-white p-1 -m-1 rounded"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {created ? (
          <div className="px-5 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-success shrink-0" />
              <p className="text-xs text-white font-medium">Link ready — every open is tracked</p>
            </div>
            <div className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2">
              <p className="text-xs text-dna-400 mono break-all leading-relaxed">{created.shareUrl}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={copy} className="btn btn-primary btn-sm flex-1">
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <Link
                to={`/vault/assets/${vaultId}/shares/${encodeURIComponent(created.token)}`}
                className="btn btn-secondary btn-sm flex-1 text-center"
              >
                QR &amp; details
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="text-2xs text-gray-500 hover:text-white w-full text-center"
            >
              Create another link
            </button>
          </div>
        ) : (
          <>
            {/* Four groups, two columns — nothing stacked that can sit side by side. */}
            <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Group icon={<Clock size={13} />} label="Expires after">
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY.map((e) => (
                    <Chip key={e.label} on={expiresIn === e.value} onClick={() => setExpiresIn(e.value)}>
                      {e.label}
                    </Chip>
                  ))}
                </div>
              </Group>

              <Group icon={<Eye size={13} />} label="Limits">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <Chip on={allowDownload} onClick={() => setAllowDownload((v) => !v)}>
                    Allow download
                  </Chip>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number" min={1} value={maxViews}
                    onChange={(e) => setMaxViews(e.target.value)}
                    placeholder="Views" className="input flex-1 min-w-0 text-xs h-8"
                  />
                  <input
                    type="number" min={1} value={maxDownloads}
                    onChange={(e) => setMaxDownloads(e.target.value)}
                    placeholder="Downloads" disabled={!allowDownload}
                    className="input flex-1 min-w-0 text-xs h-8 disabled:opacity-40"
                  />
                </div>
              </Group>

              <Group icon={<User size={13} />} label="Recipient must">
                <div className="flex flex-wrap gap-1.5">
                  <Chip on={requireName} onClick={() => setRequireName((v) => !v)}>Give name</Chip>
                  <Chip on={requireOtp} onClick={() => setRequireOtp((v) => !v)}>Enter code</Chip>
                  <Chip on={requestLocation} onClick={() => setRequestLocation((v) => !v)}>Allow location</Chip>
                  <Chip on={oneDeviceOnly} onClick={() => setOneDeviceOnly((v) => !v)}>One device</Chip>
                </div>
              </Group>

              <Group icon={<Globe size={13} />} label="Where it opens">
                <input
                  value={allowedCountries}
                  onChange={(e) => setAllowedCountries(e.target.value)}
                  placeholder="India, US, UK — blank = anywhere"
                  className="input w-full text-xs h-8 mb-2"
                />
                <div className="flex gap-1.5">
                  <Chip on={vpnBlock} onClick={() => setVpnBlock((v) => !v)}>Block VPN</Chip>
                  <Chip on={torBlock} onClick={() => setTorBlock((v) => !v)}>Block TOR</Chip>
                </div>
              </Group>
            </div>

            {/* The only setting that changes what the recipient actually sees. */}
            <div className="px-5 pb-4">
              <button
                type="button"
                onClick={() => setHideSensitive((v) => !v)}
                aria-pressed={hideSensitive}
                className={`w-full flex items-center gap-3 text-left rounded-lg px-3.5 py-3 border transition-colors ${
                  hideSensitive
                    ? 'bg-warning/10 border-warning/40'
                    : 'bg-bg-elevated border-bg-border hover:border-bg-border-strong'
                }`}
              >
                <EyeOff size={17} className={hideSensitive ? 'text-warning shrink-0' : 'text-gray-500 shrink-0'} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-white leading-tight mb-0.5">Hide sensitive data</span>
                  {/* Says exactly what the masking service detects. Names are not
                      among its patterns, so they are not claimed here. */}
                  <span className="block text-2xs text-gray-500 leading-snug">
                    Masks email addresses, phone numbers, Aadhaar and PAN numbers, and postal
                    addresses before the recipient sees the file
                  </span>
                </span>
                <span
                  className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${
                    hideSensitive ? 'bg-warning' : 'bg-bg-base border border-bg-border'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                      hideSensitive ? 'left-[1.15rem]' : 'left-0.5'
                    }`}
                  />
                </span>
              </button>
            </div>

            {showMore && (
              <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Group icon={<MoreHorizontal size={13} />} label="One-time use">
                  <Chip on={oneTimeUse} onClick={() => setOneTimeUse((v) => !v)}>
                    Stop after first open
                  </Chip>
                </Group>
                <Group icon={<User size={13} />} label="Recipient email">
                  <input
                    type="email" value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="name@company.com" className="input w-full text-xs h-8"
                  />
                </Group>
                <Group icon={<Globe size={13} />} label="Allowed IP prefixes">
                  <input
                    value={allowedIpPrefixes}
                    onChange={(e) => setAllowedIpPrefixes(e.target.value)}
                    placeholder="203.0.113., 198.51.100." className="input w-full text-xs h-8"
                  />
                </Group>
                <Group icon={<Share2 size={13} />} label="Note for recipient">
                  <input
                    value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Please review this carefully" className="input w-full text-xs h-8"
                  />
                </Group>
                <div className="sm:col-span-2">
                  <Link
                    to={`/vault/assets/${vaultId}/share`}
                    className="text-2xs text-dna-400 hover:text-white"
                  >
                    Client review, device types and the full policy set →
                  </Link>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-3 px-5 py-3 border-t border-bg-border bg-bg-elevated/40">
              <span className="text-2xs text-gray-500 flex items-center gap-1.5 flex-1 min-w-0">
                <Droplet size={12} className="shrink-0" />
                <span className="truncate">Watermark and tracking always on</span>
              </span>
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="text-2xs text-gray-400 hover:text-white shrink-0"
              >
                {showMore ? 'Less' : 'More'}
              </button>
              <button
                type="button"
                onClick={create}
                disabled={creating}
                className="btn btn-primary btn-sm shrink-0 disabled:opacity-60"
              >
                {creating ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin" /> Creating
                  </span>
                ) : 'Create link'}
              </button>
            </div>
          </>
        )}

        {/* Existing links — never silently empty */}
        <div className="border-t border-bg-border px-5 py-2.5">
          {linksError ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-2xs text-danger">{linksError}</p>
              <button type="button" onClick={() => void loadLinks()}
                      className="text-2xs text-dna-400 hover:text-white shrink-0">
                Retry
              </button>
            </div>
          ) : links === null ? (
            <p className="text-2xs text-gray-500 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Loading existing links
            </p>
          ) : links.length === 0 ? (
            <p className="text-2xs text-gray-500">No links for this file yet.</p>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xs text-gray-500">
                {links.length} link{links.length === 1 ? '' : 's'} · {activeCount} active
              </span>
              {links.slice(0, 4).map((l) => (
                <span key={l.id ?? l.token} className="text-2xs mono text-dna-400">
                  {l.token}
                  <span className="text-gray-600">{l.isActive ? '' : ' (revoked)'}</span>
                </span>
              ))}
              {links.length > 4 && (
                <Link to={`/vault/assets/${vaultId}/share`} className="text-2xs text-dna-400 hover:text-white">
                  all {links.length} →
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({
  icon, label, children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-2xs text-gray-400 mb-2">
        <span className="text-gray-500">{icon}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

/** On when filled, off when outlined — the same information a toggle row carries. */
function Chip({
  on, onClick, children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
        on
          ? 'bg-dna-500/15 border-dna-500/50 text-dna-300'
          : 'border-bg-border text-gray-400 hover:text-white hover:border-bg-border-strong'
      }`}
    >
      {children}
    </button>
  );
}
