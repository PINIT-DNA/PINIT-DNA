import { useState, useEffect } from 'react';
import { Archive, Search, Lock, RefreshCw, Eye, Share2, Copy, Check, Clock, Ban, GitBranch, ShieldCheck, MapPin, LayoutGrid, List, Cpu } from 'lucide-react';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';
import { VaultDetailSidePanel } from '../components/VaultDetailSidePanel';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useApi, formatBytes } from '../hooks/useApi';
import {
  listVaultRecords,
  protectedDownloadFromVault,
  deleteVaultRecord,
  api,
} from '../services/dashboard.api';
import { SkeletonTable, SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { cn } from '../components/ui/utils';
import { FILE_TYPES, getVaultFileTypeLabel, getVaultFileTypeDisplay } from '../lib/file-type-utils';
import { API_BASE_URL } from '../config/api.config';
import { ShareQrBlock } from '../components/ShareQrBlock';
import type { VaultRecord } from '../types/dashboard.types';

// ─── Protected Download Modal ─────────────────────────────────────────────────

const PROTECTED_STEPS = [
  { id: 'ownership', label: 'Verifying ownership…' },
  { id: 'dna', label: 'Verifying DNA…' },
  { id: 'certificate', label: 'Verifying Certificate…' },
  { id: 'prepare', label: 'Preparing Protected File…' },
  { id: 'ready', label: 'Download Ready' },
];

function ProtectedDownloadModal({ record, onClose }: { record: VaultRecord; onClose: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [forensicPreserved, setForensicPreserved] = useState(false);
  const [recipientLabel, setRecipientLabel] = useState('');
  const [lastTep, setLastTep] = useState<string | null>(null);

  const runProtectedDownload = async () => {
    setPhase('running');
    setError(null);
    setActiveStep(0);

    const stepTimer = window.setInterval(() => {
      setActiveStep((s) => Math.min(s + 1, PROTECTED_STEPS.length - 2));
    }, 600);

    try {
      const { blob, tepCode, tracking } = await protectedDownloadFromVault(record.id, {
        recipientLabel: recipientLabel.trim() || undefined,
      });
      setForensicPreserved(true);
      setLastTep(tepCode ?? null);
      setActiveStep(PROTECTED_STEPS.length - 2);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = record.originalFileName;
      a.click();
      URL.revokeObjectURL(url);

      setActiveStep(PROTECTED_STEPS.length - 1);
      setPhase('done');
      toast.success(
        tepCode
          ? `Protected download complete — TEP ${tepCode} (${tracking ?? 'tracked'})`
          : 'Protected download complete — download event recorded',
      );
    } catch (err) {
      setPhase('error');
      const msg = err instanceof Error ? err.message : 'Protected download failed';
      setError(msg);
      toast.error(msg.length > 80 ? 'Protected download failed' : msg);
    } finally {
      window.clearInterval(stepTimer);
    }
  };

  return (
    <Modal open title="Protected Download" onClose={onClose} size="md">
      <div className="p-6 space-y-4">
        <div className="rounded-xl bg-dna-500/10 border border-dna-500/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={16} className="text-dna-400" />
            <p className="text-sm font-semibold text-white">{record.originalFileName}</p>
          </div>
          <p className="text-2xs text-gray-400 mb-2">
            Enterprise delivery: TEP tracking, download logging, and chain of custody.
            Browsers cannot force the file to open only in PINIT — recovery happens when the file
            is investigated or opened through a PINIT-controlled path.
          </p>
          <ul className="text-2xs text-dna-300 space-y-0.5">
            <li>✓ TEP Tracking</li>
            <li>✓ Dynamic Watermark</li>
            <li>✓ Download Logging (IP / device / time)</li>
            <li>✓ Chain of Custody</li>
            <li>✓ Future Identification via Investigation</li>
          </ul>
        </div>

        {phase === 'idle' && (
          <div className="space-y-3">
            <div>
              <label className="text-2xs text-gray-500">Recipient (optional label)</label>
              <input
                className="input text-sm mt-1"
                placeholder="e.g. HR team / self"
                value={recipientLabel}
                onChange={(e) => setRecipientLabel(e.target.value)}
              />
            </div>
          </div>
        )}

        <ul className="space-y-2">
          {PROTECTED_STEPS.map((step, i) => {
            const done = phase === 'done' ? true : i < activeStep;
            const current = phase === 'running' && i === activeStep;
            return (
              <li
                key={step.id}
                className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
                  done ? 'bg-success/10 text-success' : current ? 'bg-dna-500/10 text-dna-300' : 'bg-bg-elevated text-gray-500'
                }`}
              >
                {done ? <Check size={14} /> : current ? <RefreshCw size={14} className="animate-spin" /> : <Clock size={14} />}
                {step.label}
              </li>
            );
          })}
        </ul>

        {phase === 'done' && forensicPreserved && (
          <div className="text-2xs text-success text-center space-y-1">
            <p>Protected download recorded in chain of custody.</p>
            {lastTep && <p className="mono text-dna-300">TEP {lastTep}</p>}
          </div>
        )}

        {error && (
          <p className="text-xs text-danger text-center">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          {phase === 'idle' || phase === 'error' ? (
            <button onClick={runProtectedDownload} className="btn btn-primary flex-1">
              <ShieldCheck size={14} /> Generate Protected Download
            </button>
          ) : phase === 'running' ? (
            <button disabled className="btn btn-primary flex-1 opacity-70">
              <RefreshCw size={14} className="animate-spin" /> Processing…
            </button>
          ) : (
            <button onClick={onClose} className="btn btn-primary flex-1">Done</button>
          )}
          {phase !== 'running' && (
            <button onClick={onClose} className="btn btn-secondary">Close</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Share Modal ─────────────────────────────────────────────────────────────

interface ShareCreated {
  shareUrl: string;
  token: string;
  devOtp?: string;
  devOtpNote?: string;
}

function ShareModal({ record, onClose }: { record: VaultRecord; onClose: () => void }) {
  const navigate = useNavigate();
  const [expiresIn, setExpiresIn]       = useState<string>('168');  // 7 days
  const [maxViews, setMaxViews]         = useState<string>('');
  const [allowDownload, setAllowDownload] = useState(false);
  const [requireName, setRequireName]   = useState(false);
  const [note, setNote]                 = useState('');
  const [creating, setCreating]         = useState(false);
  const [created, setCreated]           = useState<ShareCreated | null>(null);
  const [copied, setCopied]             = useState(false);

  // ── Advanced policy controls (Smart Links audit additions) ────────────────
  const [showAdvanced, setShowAdvanced]   = useState(true);
  const [oneTimeUse, setOneTimeUse]       = useState(false);
  const [maxDownloads, setMaxDownloads]   = useState<string>('');
  const [allowedCountries, setAllowedCountries]     = useState<string>('');
  const [allowedDeviceTypes, setAllowedDeviceTypes] = useState<string>('');
  const [allowedIpPrefixes, setAllowedIpPrefixes]   = useState<string>('');
  const [requireOtp, setRequireOtp]       = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');

  // ── Privacy Masking controls ───────────────────────────────────────────────
  const [privacyMaskingEnabled, setPrivacyMaskingEnabled] = useState(false);
  const [maskEmail,   setMaskEmail]   = useState(false);
  const [maskPhone,   setMaskPhone]   = useState(false);
  const [maskAadhaar, setMaskAadhaar] = useState(false);
  const [maskPan,     setMaskPan]     = useState(false);
  const [maskAddress, setMaskAddress] = useState(false);
  // Auto-detection state
  const [scanning,       setScanning]      = useState(false);
  const [scanDone,       setScanDone]      = useState(false);
  const [scanSupported,  setScanSupported] = useState(true);
  const [scanMsg,        setScanMsg]       = useState('');
  const [detected, setDetected] = useState({ email: false, phone: false, aadhaar: false, pan: false, address: false });

  // ── GPS Location — optional (owner chooses at share time)
  const [requestLocation, setRequestLocation] = useState(true);

  // ── Enterprise Security Controls ──────────────────────────────────────────
  const [vpnBlock,       setVpnBlock]       = useState(false);
  const [torBlock,       setTorBlock]       = useState(false);
  const [oneDeviceOnly,  setOneDeviceOnly]  = useState(false);

  // ── Child links (kept for API compatibility) ──────────────────────────────
  const [childLinks, setChildLinks] = useState<Array<{ token: string; url: string; recipientLabel: string }>>([]);

  // ── Manage existing links — list + revoke (Smart Links audit: link revocation UI) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [existingLinks, setExistingLinks] = useState<any[]>([]);
  const [loadingLinks, setLoadingLinks]   = useState(true);

  const fetchLinks = async () => {
    setLoadingLinks(true);
    try {
      const { data } = await api.get(`${API_BASE_URL}/share/vault/${record.id}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setExistingLinks((data as any).links ?? []);
    } catch (err) {
      console.error('[ShareModal] fetchLinks failed:', err);
      setExistingLinks([]);
    }
    finally { setLoadingLinks(false); }
  };

  useEffect(() => { fetchLinks(); }, [record.id]);



  // Country name → ISO code lookup for common countries
  const COUNTRY_ISO: Record<string, string> = {
    'india': 'IN', 'united states': 'US', 'usa': 'US', 'america': 'US',
    'united kingdom': 'GB', 'uk': 'GB', 'england': 'GB',
    'australia': 'AU', 'canada': 'CA', 'germany': 'DE', 'france': 'FR',
    'japan': 'JP', 'china': 'CN', 'singapore': 'SG', 'uae': 'AE',
    'united arab emirates': 'AE', 'russia': 'RU', 'brazil': 'BR',
    'south africa': 'ZA', 'italy': 'IT', 'spain': 'ES', 'netherlands': 'NL',
    'new zealand': 'NZ', 'pakistan': 'PK', 'bangladesh': 'BD', 'sri lanka': 'LK',
  };
  // Country list: converts full names to ISO codes (e.g. "India" → "IN")
  const splitCountryList = (v: string) => v.split(',').map(s => {
    const trimmed = s.trim();
    if (!trimmed) return '';
    if (/^[A-Z]{2,3}$/.test(trimmed)) return trimmed;
    const iso = COUNTRY_ISO[trimmed.toLowerCase()];
    return iso ?? trimmed.toUpperCase().slice(0, 2);
  }).filter(Boolean);

  // Device/IP list: simple split + lowercase (no ISO conversion)
  const splitSimpleList = (v: string) => v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { data } = await api.post(`${API_BASE_URL}/share`, {
        vaultId:      record.id,
        expiresIn:    expiresIn ? Number(expiresIn) : null,
        maxViews:     maxViews  ? Number(maxViews)  : null,
        allowDownload,
        requireName,
        note: note.trim() || undefined,
        oneTimeUse,
        maxDownloads:       maxDownloads ? Number(maxDownloads) : null,
        allowedCountries:   splitCountryList(allowedCountries),
        allowedDeviceTypes: splitSimpleList(allowedDeviceTypes),
        allowedIpPrefixes:  splitSimpleList(allowedIpPrefixes),
        requireOtp,
        recipientEmail: recipientEmail.trim() || undefined,
        privacyMaskingEnabled,
        maskEmail:   privacyMaskingEnabled && maskEmail,
        maskPhone:   privacyMaskingEnabled && maskPhone,
        maskAadhaar: privacyMaskingEnabled && maskAadhaar,
        maskPan:     privacyMaskingEnabled && maskPan,
        maskAddress: privacyMaskingEnabled && maskAddress,
        requestLocation,
        vpnBlock,
        torBlock,
        oneDeviceOnly,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setCreated({ shareUrl: d.shareUrl, token: d.token, devOtp: d.devOtp, devOtpNote: d.devOtpNote });
      if (d.childLinks?.length) setChildLinks(d.childLinks);
      toast.success(d.childLinks?.length ? `Share link + ${d.childLinks.length} recipient links created!` : 'Share link created!');
      fetchLinks();
    } catch {
      toast.error('Failed to create share link');
    } finally { setCreating(false); }
  };

  const handleCopy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.shareUrl);
    setCopied(true);
    // Track copy event
    api.post(`${API_BASE_URL}/share/${created.token}/access`, { action: 'COPIED' }).catch(() => {});
    setTimeout(() => setCopied(false), 2000);
    toast.success('Link copied to clipboard!');
  };

  /** Open OS share sheet (WhatsApp, Email, etc.) — close app modal first so they don't overlap. */
  const handleNativeShareLink = async () => {
    if (!created) return;
    const { shareUrl, token } = created;
    const shareData: ShareData = {
      title: record.originalFileName,
      text: `Secure file via PinIT Hub\n${shareUrl}`,
      url: shareUrl,
    };

    const canShare =
      typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && (typeof navigator.canShare !== 'function' || navigator.canShare(shareData));

    if (canShare) {
      // Close PinIT modal first — only the OS share card should show
      onClose();
      try {
        await navigator.share(shareData);
        toast.success('Smart link shared');
        return;
      } catch (err) {
        const name = (err as { name?: string })?.name ?? '';
        const msg = err instanceof Error ? err.message : String(err);
        if (name === 'AbortError' || /canceled|cancelled/i.test(msg)) return;
        // Share sheet failed — copy so user can still paste
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        api.post(`${API_BASE_URL}/share/${token}/access`, { action: 'COPIED' }).catch(() => {});
        toast.success('Link copied — paste it in WhatsApp, Email, or any app', { duration: 4500 });
      } catch {
        toast.error('Could not share or copy the link');
      }
      return;
    }

    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    api.post(`${API_BASE_URL}/share/${token}/access`, { action: 'COPIED' }).catch(() => {});
    setTimeout(() => setCopied(false), 2000);
    toast.success('Link copied — paste it in WhatsApp, Email, or any app', { duration: 4500 });
  };

  return (
    <Modal open title="Generate Smart Share Link" onClose={onClose} size="md">
      <div className="p-5 space-y-4">

        {/* File info */}
        <div className="flex items-center gap-3 p-3 bg-bg-elevated rounded-xl border border-bg-border">
          <div className="w-8 h-8 bg-success/15 rounded-lg flex items-center justify-center shrink-0">
            <Lock size={14} className="text-success" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{record.originalFileName}</p>
            <p className="text-2xs text-gray-500">{formatBytes(record.originalSizeBytes)} · AES-256-GCM</p>
          </div>
          <Badge variant="success">Encrypted</Badge>
        </div>

        {/* Active links — manage / revoke (Smart Links audit: link revocation UI) */}
        {!created && (
          <div className="border border-bg-border rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-bg-elevated text-xs font-semibold text-gray-300 flex items-center justify-between">
              <span>Share Links for this File ({existingLinks.filter(l => l.isActive).length} active)</span>
              {loadingLinks && <RefreshCw size={11} className="animate-spin text-gray-500" />}
            </div>
            <div className="divide-y divide-bg-border max-h-44 overflow-y-auto">
              {!loadingLinks && existingLinks.length === 0 && (
                <p className="text-xs text-gray-500 px-3 py-3 text-center">No links created yet for this file</p>
              )}
              {existingLinks.map(link => (
                <div key={link.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs text-dna-400 mono truncate">{link.token}</p>
                    <p className="text-2xs text-gray-500">
                      {link.isActive ? 'Active' : 'Revoked'}
                      {typeof link.viewCount === 'number' ? ` · ${link.viewCount} views` : ''}
                      {link.expiresAt ? ` · expires ${new Date(link.expiresAt).toLocaleDateString()}` : ' · no expiry'}
                    </p>
                  </div>
                  {link.isActive ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="danger">Revoked</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!created ? (
          <>
            {/* Expiry */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-2">Link Expires After</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: '1 Hour',   value: '1'    },
                  { label: '24 Hours', value: '24'   },
                  { label: '7 Days',   value: '168'  },
                  { label: '30 Days',  value: '720'  },
                  { label: 'Never',    value: ''     },
                ].map(opt => (
                  <button key={opt.label}
                    onClick={() => setExpiresIn(opt.value)}
                    className={`text-xs py-2 rounded-lg border transition-all ${
                      expiresIn === opt.value
                        ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                        : 'border-bg-border text-gray-500 hover:text-white'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Max views */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                Max Views <span className="text-gray-500 font-normal">(leave empty for unlimited)</span>
              </label>
              <input type="number" min="1" value={maxViews}
                onChange={e => setMaxViews(e.target.value)}
                placeholder="e.g. 5"
                className="input text-sm w-full"
              />
            </div>

            {/* Toggles */}
            <div className="space-y-2">
              {[
                { label: 'Allow Download',       desc: 'Recipient can download the file',           value: allowDownload, set: setAllowDownload },
                { label: 'Require Name',         desc: 'Recipient must enter their name to access', value: requireName,   set: setRequireName   },
              ].map(opt => (
                <div key={opt.label} className="flex items-center justify-between p-3 bg-bg-elevated rounded-xl border border-bg-border">
                  <div>
                    <p className="text-xs font-semibold text-white">{opt.label}</p>
                    <p className="text-2xs text-gray-500">{opt.desc}</p>
                  </div>
                  <button onClick={() => opt.set(!opt.value)}
                    className={`w-10 h-5 rounded-full transition-all relative ${opt.value ? 'bg-dna-500' : 'bg-bg-border'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${opt.value ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>

            {/* Advanced policy controls */}
            <div className="border border-bg-border rounded-xl overflow-hidden">
              <button type="button" onClick={() => setShowAdvanced(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-gray-300 hover:text-white bg-bg-elevated">
                <span>Advanced Access Policies</span>
                <span className="text-gray-500">{showAdvanced ? '−' : '+'}</span>
              </button>
              {showAdvanced && (
                <div className="p-3 space-y-3 bg-bg-card">
                  {/* One-time use / max downloads */}
                  <div className="space-y-2">
                    {[
                      { label: 'One-Time Use',  desc: 'Link self-revokes after the first successful access', value: oneTimeUse, set: setOneTimeUse },
                      { label: 'Require Identity Verification (OTP)', desc: 'Recipient must enter a 6-digit code before viewing', value: requireOtp, set: setRequireOtp },
                    ].map(opt => (
                      <div key={opt.label} className="flex items-center justify-between p-3 bg-bg-elevated rounded-xl border border-bg-border">
                        <div>
                          <p className="text-xs font-semibold text-white">{opt.label}</p>
                          <p className="text-2xs text-gray-500">{opt.desc}</p>
                        </div>
                        <button onClick={() => opt.set(!opt.value)}
                          className={`w-10 h-5 rounded-full transition-all relative ${opt.value ? 'bg-dna-500' : 'bg-bg-border'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${opt.value ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {requireOtp && (
                    <div className="p-3 bg-dna-500/5 border border-dna-500/20 rounded-xl">
                      <p className="text-xs font-semibold text-dna-400 mb-1">ℹ️ How OTP works here</p>
                      <p className="text-2xs text-gray-400 leading-relaxed">
                        After you click <strong>"Generate Smart Link"</strong>, a 6-digit verification code will appear <strong>right here in the app</strong>. Share that code with your recipient manually (WhatsApp / Email / message). The recipient must enter it before they can view the file.
                      </p>
                      <label className="text-xs font-semibold text-gray-300 block mt-3 mb-1.5">
                        Recipient Email <span className="text-gray-500 font-normal">(optional — for your own records)</span>
                      </label>
                      <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                        placeholder="recipient@example.com" className="input text-sm w-full" />
                    </div>
                  )}

                  {/* Enterprise security controls */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-purple-400 uppercase tracking-wide">Enterprise Security</p>
                    {[
                      { label: 'Block TOR Access', desc: 'Reject requests from TOR exit nodes (enabled by default)', value: torBlock, set: setTorBlock },
                      { label: 'Block VPN Access', desc: 'Reject requests originating from VPN providers', value: vpnBlock, set: setVpnBlock },
                      { label: 'One Device Only', desc: 'Bind link to the first device that accesses it', value: oneDeviceOnly, set: setOneDeviceOnly },
                    ].map(opt => (
                      <div key={opt.label} className="flex items-center justify-between p-3 bg-bg-elevated rounded-xl border border-purple-500/20">
                        <div>
                          <p className="text-xs font-semibold text-white">{opt.label}</p>
                          <p className="text-2xs text-gray-500">{opt.desc}</p>
                        </div>
                        <button onClick={() => opt.set(!opt.value)}
                          className={`w-10 h-5 rounded-full transition-all relative ${opt.value ? 'bg-purple-500' : 'bg-bg-border'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${opt.value ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                      Max Downloads <span className="text-gray-500 font-normal">(leave empty for unlimited)</span>
                    </label>
                    <input type="number" min="1" value={maxDownloads}
                      onChange={e => setMaxDownloads(e.target.value)}
                      placeholder="e.g. 3" className="input text-sm w-full" />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                      Allowed Countries <span className="text-gray-500 font-normal">(e.g. India, US, UK — empty = any country allowed)</span>
                    </label>
                    <input type="text" value={allowedCountries} onChange={e => setAllowedCountries(e.target.value)}
                      placeholder="India, US, UK" className="input text-sm w-full" />
                    <p className="text-2xs text-gray-500 mt-1">
                      Enforced on real internet IPs. Localhost / LAN opens are not geo-tagged as India — they are allowed for testing.
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                      Allowed Device Types <span className="text-gray-500 font-normal">(comma-separated: desktop, mobile, tablet)</span>
                    </label>
                    <input type="text" value={allowedDeviceTypes} onChange={e => setAllowedDeviceTypes(e.target.value)}
                      placeholder="desktop, mobile" className="input text-sm w-full" />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                      Allowed IP Prefixes <span className="text-gray-500 font-normal">(comma-separated, e.g. 10.0., 192.168.)</span>
                    </label>
                    <input type="text" value={allowedIpPrefixes} onChange={e => setAllowedIpPrefixes(e.target.value)}
                      placeholder="10.0., 192.168." className="input text-sm w-full" />
                  </div>
                </div>
              )}
            </div>

            {/* Note */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                Note to Recipient <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder="Please review this document carefully…"
                rows={2} className="input w-full text-sm resize-none"
              />
            </div>

            {/* ── Privacy Masking ───────────────────────────────────────── */}
            <div className="border border-bg-border rounded-xl overflow-hidden">
              <button type="button"
                onClick={async () => {
                  const next = !privacyMaskingEnabled;
                  setPrivacyMaskingEnabled(next);
                  if (next && !scanDone) {
                    // Auto-scan the file for sensitive data
                    setScanning(true);
                    setScanMsg('');
                    try {
                      const { data } = await api.post(`${API_BASE_URL}/vault/${record.id}/scan-sensitive`);
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const d = data as any;
                      setScanSupported(d.supported !== false);
                      if (d.supported === false) {
                        setScanMsg(d.reason ?? 'Masking not supported for this file type.');
                        setPrivacyMaskingEnabled(false);
                      } else {
                        setDetected({ email: !!d.email, phone: !!d.phone, aadhaar: !!d.aadhaar, pan: !!d.pan, address: !!d.address });
                        // Auto-enable only the types that were actually found
                        setMaskEmail(!!d.email);
                        setMaskPhone(!!d.phone);
                        setMaskAadhaar(!!d.aadhaar);
                        setMaskPan(!!d.pan);
                        setMaskAddress(!!d.address);
                        if (!d.hasAnyMatch) setScanMsg('No sensitive data detected in this file. You can still enable types manually if needed.');
                      }
                      setScanDone(true);
                    } catch {
                      setScanMsg('Could not scan file — you can enable masks manually.');
                      setScanDone(true);
                    } finally {
                      setScanning(false);
                    }
                  }
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-gray-300 hover:text-white bg-bg-elevated">
                <span className="flex items-center gap-2">
                  <span className="text-purple-400">🔏</span> Privacy Masking
                  <span className="text-gray-500 font-normal">(auto-detects &amp; hides sensitive data)</span>
                </span>
                {scanning
                  ? <span className="text-xs text-purple-400 flex items-center gap-1"><div className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" /> Scanning…</span>
                  : <span className={`text-xs px-2 py-0.5 rounded font-semibold ${privacyMaskingEnabled ? 'bg-purple-500/20 text-purple-400' : 'text-gray-500'}`}>
                      {privacyMaskingEnabled ? 'ON' : 'OFF'}
                    </span>
                }
              </button>

              {privacyMaskingEnabled && !scanning && (
                <div className="px-3 py-3 space-y-2 bg-bg-base">
                  <p className="text-2xs text-gray-500 mb-1">
                    Original file is <strong className="text-white">never modified</strong>. Masking applies only to the recipient's view.
                  </p>
                  {scanMsg && (
                    <p className={`text-2xs px-2 py-1.5 rounded ${detected.email || detected.phone || detected.aadhaar || detected.pan || detected.address ? 'text-green-400 bg-green-500/10' : 'text-yellow-400 bg-yellow-500/10'}`}>
                      {scanMsg}
                    </p>
                  )}
                  {scanSupported && (
                    <>
                      {[
                        { key: 'email',   label: 'Email Addresses',  desc: 'john@*** → ****@gmail.com',           val: maskEmail,   set: setMaskEmail,   found: detected.email   },
                        { key: 'phone',   label: 'Phone Numbers',    desc: '9876543210 → 98******10',              val: maskPhone,   set: setMaskPhone,   found: detected.phone   },
                        { key: 'aadhaar', label: 'Aadhaar Numbers',  desc: '1234 5678 9012 → XXXX XXXX 9012',     val: maskAadhaar, set: setMaskAadhaar, found: detected.aadhaar },
                        { key: 'pan',     label: 'PAN Numbers',      desc: 'ABCDE1234F → *****1234F',              val: maskPan,     set: setMaskPan,     found: detected.pan     },
                        { key: 'address', label: 'Addresses',        desc: 'Street/area info → [ADDRESS MASKED]', val: maskAddress, set: setMaskAddress, found: detected.address },
                      ].map(({ key, label, desc, val, set, found }) => (
                        <label key={key} className={`flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-bg-elevated ${!found && scanDone ? 'opacity-50' : ''}`}>
                          <div className="flex items-center gap-2 flex-1">
                            <div>
                              <p className="text-xs text-gray-300 font-medium flex items-center gap-1.5">
                                {label}
                                {scanDone && (
                                  found
                                    ? <span className="text-2xs bg-green-500/20 text-green-400 border border-green-500/30 rounded px-1">Found ✓</span>
                                    : <span className="text-2xs bg-gray-500/10 text-gray-600 border border-gray-600/20 rounded px-1">Not found</span>
                                )}
                              </p>
                              <p className="text-2xs text-gray-500">{desc}</p>
                            </div>
                          </div>
                          <div
                            onClick={() => set((v: boolean) => !v)}
                            className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer ${val ? 'bg-purple-500' : 'bg-bg-border'}`}
                          >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${val ? 'left-4' : 'left-0.5'}`} />
                          </div>
                        </label>
                      ))}
                      {scanDone && !detected.email && !detected.phone && !detected.aadhaar && !detected.pan && !detected.address && (
                        <p className="text-2xs text-gray-600 text-center py-1">No sensitive data auto-detected — toggle manually if needed</p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Image / unsupported file warning */}
              {!scanning && scanDone && !scanSupported && (
                <div className="px-3 py-3 bg-bg-base">
                  <p className="text-2xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1.5">
                    📷 {scanMsg}
                  </p>
                </div>
              )}
            </div>

            {/* ── GPS Location — optional toggle ──────────────────── */}
            <button
              type="button"
              onClick={() => setRequestLocation((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors ${
                requestLocation
                  ? 'border-green-500/40 bg-green-500/10'
                  : 'border-bg-border bg-bg-elevated hover:border-green-500/25'
              }`}
            >
              <div>
                <p className={`text-xs font-semibold flex items-center gap-2 ${requestLocation ? 'text-green-400' : 'text-gray-300'}`}>
                  📍 GPS Location Tracking
                  <span className={`text-2xs px-1.5 py-0.5 rounded font-bold ${
                    requestLocation
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-bg-border text-gray-500'
                  }`}>
                    {requestLocation ? 'ON' : 'OFF'}
                  </span>
                </p>
                <p className="text-2xs text-gray-500 mt-0.5">
                  {requestLocation
                    ? 'Viewer must allow GPS location to access the file. No location = no access.'
                    : 'Off — open without GPS prompt; still track via IP (approximate).'}
                </p>
              </div>
              <div className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ml-3 ${requestLocation ? 'bg-green-500' : 'bg-bg-border'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${requestLocation ? 'left-4' : 'left-0.5'}`} />
              </div>
            </button>

            <button onClick={handleCreate} disabled={creating} className="btn btn-primary w-full">
              {creating
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
                : <><Share2 size={14} /> Generate Smart Link</>}
            </button>
          </>
        ) : (
          /* Link created state */
          <div className="space-y-4">
            <div className="rounded-xl bg-success/5 border border-success/20 p-4 flex items-center gap-3">
              <Check size={18} className="text-success shrink-0" />
              <div>
                <p className="text-sm font-semibold text-success">Smart Link Generated!</p>
                <p className="text-2xs text-gray-400 mt-0.5">Access is tracked — every view is logged in View in Timeline</p>
              </div>
            </div>

            {/* Dev OTP — surfaced because no SMTP provider is configured */}
            {created.devOtp && (
              <div className="rounded-xl bg-warning/5 border border-warning/20 p-3">
                <p className="text-2xs text-warning font-semibold mb-1">VERIFICATION CODE (share manually — no email service configured)</p>
                <p className="text-lg font-mono tracking-[0.4em] text-white">{created.devOtp}</p>
                {created.devOtpNote && <p className="text-2xs text-gray-500 mt-1">{created.devOtpNote}</p>}
              </div>
            )}

            {/* URL box */}
            <div className="bg-bg-elevated rounded-xl border border-bg-border p-3">
              <p className="text-2xs text-gray-500 mb-1.5 font-semibold">SHARE URL</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-dna-400 mono flex-1 truncate">{created.shareUrl}</p>
                <button onClick={handleCopy}
                  className={`btn btn-sm shrink-0 ${copied ? 'btn-secondary' : 'btn-primary'}`}>
                  {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
                </button>
              </div>
            </div>

            <ShareQrBlock url={created.shareUrl} />

            {/* Native share — opens WhatsApp / Email / etc. like Share File */}
            <button
              type="button"
              onClick={() => void handleNativeShareLink()}
              className="btn btn-primary w-full"
            >
              <Share2 size={14} /> Share Link
            </button>
            <p className="text-2xs text-gray-500 text-center -mt-2">
              Opens your device share menu — pick WhatsApp, Email, or any app
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent('Secure file: ' + created.shareUrl)}`}
                target="_blank" rel="noreferrer"
                className="btn btn-secondary btn-sm text-xs justify-center">
                WhatsApp
              </a>
              <a href={`mailto:?subject=Shared+File&body=${encodeURIComponent('Access this secure file: ' + created.shareUrl)}`}
                className="btn btn-secondary btn-sm text-xs justify-center">
                Email
              </a>
              <button type="button" onClick={() => void handleCopy()} className="btn btn-secondary btn-sm text-xs">
                <Copy size={11} /> Copy Link
              </button>
            </div>

            <div className="flex gap-2">
              <div className="flex items-center gap-1.5 text-2xs text-gray-500 bg-bg-elevated rounded-lg px-2 py-1.5">
                <Clock size={10} />
                {expiresIn ? `Expires in ${expiresIn}h` : 'Never expires'}
              </div>
              {maxViews && (
                <div className="flex items-center gap-1.5 text-2xs text-gray-500 bg-bg-elevated rounded-lg px-2 py-1.5">
                  <Eye size={10} /> Max {maxViews} views
                </div>
              )}
              {!allowDownload && (
                <div className="flex items-center gap-1.5 text-2xs text-gray-500 bg-bg-elevated rounded-lg px-2 py-1.5">
                  <Ban size={10} /> No download
                </div>
              )}
            </div>

            {/* Child recipient links */}
            {childLinks.length > 0 && (
              <div className="border border-dna-500/30 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-dna-500/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitBranch size={13} className="text-dna-400" />
                    <span className="text-xs font-semibold text-dna-300">Recipient Links ({childLinks.length})</span>
                  </div>
                  <button
                    onClick={() => navigate(`/link-tree/${created?.token}`)}
                    className="flex items-center gap-1 text-2xs text-dna-400 hover:text-white transition-colors"
                  >
                    <GitBranch size={11} /> View Tree
                  </button>
                </div>
                <div className="divide-y divide-bg-border max-h-48 overflow-y-auto">
                  {childLinks.map((cl, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{cl.recipientLabel}</p>
                        <p className="text-2xs text-dna-400 mono truncate">{cl.url}</p>
                      </div>
                      <button
                        onClick={() => { navigator.clipboard.writeText(cl.url); toast.success(`Copied link for ${cl.recipientLabel}`); }}
                        className="btn btn-secondary btn-sm text-2xs shrink-0"
                      >
                        <Copy size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-2xs text-gray-600 text-center">
              All access events appear in View in Timeline with IP, browser, and location
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function VaultGalleryCard({
  record,
  selected,
  onSelect,
}: {
  record: VaultRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'card overflow-hidden p-0 text-left transition-all hover:border-dna-500/30',
        selected && 'ring-2 ring-dna-500/60 border-dna-500/40',
      )}
    >
      <div className="w-full aspect-[4/3] bg-bg-elevated relative overflow-hidden">
        <VaultFileThumbnail
          vaultId={record.id}
          fileName={record.originalFileName}
          mimeType={record.originalMimeType}
          variant="gallery"
        />
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-semibold text-white truncate">{record.originalFileName}</p>
        <p className="text-xs text-gray-500">
          {getVaultFileTypeDisplay(record.originalMimeType, record.originalFileName)}
        </p>
        <p className="text-xs text-gray-500">
          {format(new Date(record.createdAt), 'MMM d, yyyy · h:mm a')}
        </p>
      </div>
    </button>
  );
}

export function VaultPage() {
  const { data: records, loading, error, refetch } = useApi(listVaultRecords);
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState<VaultRecord | null>(null);
  const [sharing, setSharing]   = useState<VaultRecord | null>(null);
  const [protecting, setProtecting] = useState<VaultRecord | null>(null);
  const [aiMode, setAiMode]     = useState(false);
  const [aiResults, setAiResults] = useState<string[]>([]); // dnaRecordIds matching AI search
  const [aiSearching, setAiSearching] = useState(false);
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const handleShare = (record: VaultRecord) => {
    setSharing(record);
  };

  const handleDelete = async (record: VaultRecord) => {
    if (!window.confirm(`Delete "${record.originalFileName}" from vault?`)) return;
    try {
      await deleteVaultRecord(record.id);
      if (selected?.id === record.id) setSelected(null);
      if (sharing?.id === record.id) setSharing(null);
      if (protecting?.id === record.id) setProtecting(null);
      toast.success('File removed from vault');
      refetch();
    } catch {
      toast.error('Failed to delete file');
    }
  };

  const handleSearch = async (q: string) => {
    setSearch(q);
    if (!aiMode || !q.trim()) { setAiResults([]); return; }
    setAiSearching(true);
    try {
      const { data } = await api.post(`${API_BASE_URL}/ai/search`, {
        query: q.trim(), topK: 20, threshold: 0.30, mode: 'hybrid',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = (data as any).data ?? data;
      setAiResults((payload.results ?? []).map((r: { dnaRecordId: string }) => r.dnaRecordId));
    } catch {
      setAiResults([]);
    } finally {
      setAiSearching(false);
    }
  };

  const filtered = (records ?? []).filter(r => {
    const typeLabel = getVaultFileTypeLabel(r.originalMimeType, r.originalFileName);
    if (typeFilter !== 'ALL' && typeLabel !== typeFilter) return false;

    if (!search) return true;
    const keyword = (
      r.originalFileName.toLowerCase().includes(search.toLowerCase()) ||
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      r.dnaRecordId.toLowerCase().includes(search.toLowerCase())
    );
    if (aiMode && !aiSearching) {
      return aiResults.length > 0 ? aiResults.includes(r.dnaRecordId) : keyword;
    }
    return keyword;
  });

  const typeCounts = (records ?? []).reduce<Record<string, number>>((acc, r) => {
    const label = getVaultFileTypeLabel(r.originalMimeType, r.originalFileName);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});

  if (error) return (
    <div className="flex items-center justify-center h-64 text-center">
      <div>
        <p className="text-danger text-sm mb-3">{error}</p>
        <button onClick={refetch} className="btn btn-secondary btn-sm">
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    </div>
  );

  return (
    <div className="page-shell animate-fade-in">
      <div className={cn('flex flex-col lg:flex-row gap-5 min-h-0', selected && 'lg:items-start')}>
        <div className="flex-1 min-w-0 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Vault Explorer</h1>
          <p className="text-sm text-gray-500 mt-0.5">AES-256-GCM encrypted file storage</p>
        </div>
        <div className="flex items-center gap-3">
          {!loading && records && (
            <div className="flex items-center gap-2">
              <Badge variant="purple">{records.length} records</Badge>
              <Badge variant="success" dot>AES-256-GCM</Badge>
            </div>
          )}
          <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      {!loading && records && records.length > 0 && (
        <div className="stat-grid-3 gap-3">
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-purple">{records.length}</p>
            <p className="text-2xs text-gray-500 mt-1">Encrypted Files</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-success">
              {formatBytes(records.reduce((s, r) => s + r.encryptedSizeBytes, 0))}
            </p>
            <p className="text-2xs text-gray-500 mt-1">Total Encrypted Size</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-dna-400">100%</p>
            <p className="text-2xs text-gray-500 mt-1">Encryption Coverage</p>
          </div>
        </div>
      )}

      {/* File type filter bar */}
      {!loading && records && records.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          <button
            type="button"
            onClick={() => setTypeFilter('ALL')}
            className={`shrink-0 px-3 py-2 rounded-lg border text-xs font-semibold transition-all min-h-[40px] ${
              typeFilter === 'ALL'
                ? 'bg-dna-500/15 border-dna-500/40 text-dna-400'
                : 'bg-bg-card border-bg-border text-gray-400 hover:text-white hover:border-dna-500/25'
            }`}
          >
            All · {records.length}
          </button>
          {FILE_TYPES.map(({ label, icon, color }) => {
            const count = typeCounts[label] ?? 0;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setTypeFilter(label)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all min-h-[40px] ${
                  typeFilter === label
                    ? 'bg-dna-500/15 border-dna-500/40 text-dna-400'
                    : 'bg-bg-card border-bg-border text-gray-400 hover:text-white hover:border-dna-500/25'
                }`}
              >
                <span>{icon}</span>
                <span className={typeFilter === label ? '' : color}>{label}</span>
                <span className="mono text-2xs opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search + table */}
      <div className="card overflow-hidden p-0">
        <div className="toolbar-row p-4 border-b border-bg-border">
          <div className="relative flex-1 min-w-0 w-full">
            {aiSearching
              ? <RefreshCw size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dna-400 animate-spin" />
              : <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />}
            <input
              type="text"
              placeholder={aiMode ? 'Search by meaning, content, or filename…' : 'Search by filename, vault ID, or DNA record ID…'}
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="input pl-9 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
            <button
              onClick={() => { setAiMode(m => !m); setSearch(''); setAiResults([]); }}
              title={aiMode ? 'Switch to keyword search' : 'Switch to AI semantic search'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all shrink-0 min-h-[44px] sm:min-h-0 ${
                aiMode
                  ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                  : 'border-bg-border text-gray-500 hover:text-white hover:border-gray-600'
              }`}
            >
              <Cpu size={13} />
              {aiMode ? 'AI Search ON' : 'AI Search'}
            </button>
            <div className="flex items-center rounded-lg border border-bg-border overflow-hidden shrink-0">
              <button
                onClick={() => setViewMode('gallery')}
                title="Gallery view"
                className={cn(
                  'px-2.5 py-1.5 transition-colors min-h-[44px] sm:min-h-0',
                  viewMode === 'gallery' ? 'bg-dna-500/20 text-dna-400' : 'text-gray-500 hover:text-white',
                )}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                title="List view"
                className={cn(
                  'px-2.5 py-1.5 border-l border-bg-border transition-colors min-h-[44px] sm:min-h-0',
                  viewMode === 'list' ? 'bg-dna-500/20 text-dna-400' : 'text-gray-500 hover:text-white',
                )}
              >
                <List size={14} />
              </button>
            </div>
            <Archive size={16} className="text-gray-500 shrink-0 hidden sm:block" />
          </div>
        </div>

        {viewMode === 'gallery' ? (
          <div className="p-4">
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Archive}
                title="No vault records"
                description="Encrypt and store files using the Generate DNA flow"
              />
            ) : (
              <div className={cn(
                'grid gap-4',
                selected
                  ? 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-3'
                  : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
              )}>
                {filtered.map(r => (
                  <VaultGalleryCard
                    key={r.id}
                    record={r}
                    selected={selected?.id === r.id}
                    onSelect={() => setSelected(prev => (prev?.id === r.id ? null : r))}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Vault ID</th>
                <th>Location</th>
                <th>Original Size</th>
                <th>Encryption</th>
                <th>Stored At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTable rows={5} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={Archive}
                      title="No vault records"
                      description="Encrypt and store files using the Generate DNA flow"
                    />
                  </td>
                </tr>
              ) : (
                filtered.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(prev => (prev?.id === r.id ? null : r))}
                    className={cn(
                      'cursor-pointer transition-colors',
                      selected?.id === r.id && 'bg-dna-500/10',
                    )}
                  >
                    <td>
                      <div className="flex items-center gap-2.5">
                        <VaultFileThumbnail
                          vaultId={r.id}
                          fileName={r.originalFileName}
                          mimeType={r.originalMimeType}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate max-w-[200px]">
                            {r.originalFileName}
                          </p>
                          <p className="text-2xs text-gray-500">
                            {getVaultFileTypeDisplay(r.originalMimeType, r.originalFileName)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="mono text-2xs text-dna-400">{r.id.slice(0, 16)}…</span>
                    </td>
                    <td>
                      {r.location?.status === 'AVAILABLE' ? (
                        <div className="flex items-start gap-1 max-w-[160px]">
                          <MapPin size={12} className="text-dna-400 shrink-0 mt-0.5" />
                          <span
                            className="text-2xs text-gray-300 truncate"
                            title={[
                              r.location.creationLabel && `Created: ${r.location.creationLabel}`,
                              r.location.sharedLabel && `Shared: ${r.location.sharedLabel}`,
                              (r.location.presentLabel ?? r.location.lastKnownLabel)
                                && `Present: ${r.location.presentLabel ?? r.location.lastKnownLabel}`,
                            ].filter(Boolean).join(' · ')}
                          >
                            {r.location.presentLabel
                              ?? r.location.lastKnownLabel
                              ?? r.location.creationLabel}
                          </span>
                        </div>
                      ) : (
                        <span className="text-2xs text-gray-500">Unavailable</span>
                      )}
                    </td>
                    <td>
                      <span className="mono text-xs">{formatBytes(r.originalSizeBytes)}</span>
                    </td>
                    <td>
                      <Badge variant="success">{r.encryptionAlgorithm}</Badge>
                    </td>
                    <td>
                      <span className="text-xs text-gray-400">
                        {format(new Date(r.createdAt), 'MMM d, yyyy · HH:mm')}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setSelected(r)}
                        className="btn-ghost btn-sm text-xs text-dna-400"
                      >
                        <Eye size={12} /> Open
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
        </div>

        {selected && (
          <VaultDetailSidePanel
            record={selected}
            onClose={() => setSelected(null)}
            onShare={() => handleShare(selected)}
            onDelete={() => handleDelete(selected)}
          />
        )}
      </div>

      {sharing && (
        <ShareModal record={sharing} onClose={() => setSharing(null)} />
      )}
      {protecting && (
        <ProtectedDownloadModal record={protecting} onClose={() => setProtecting(null)} />
      )}
    </div>
  );
}
