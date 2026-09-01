import { useEffect, useState } from 'react';
import { ReviewShareControls } from '../components/share/ReviewShareControls';
import type { ReviewPermissions, ReviewEligibility } from '../components/share/ReviewShareControls';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Lock,
  MapPin,
  RefreshCw,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge } from '../components/ui/Badge';
import { BRAND } from '../config/brand.config';
import { API_BASE_URL } from '../config/api.config';
import { formatBytes, getVaultFileTypeDisplay } from '../lib/file-type-utils';
import { api, getVaultRecord } from '../services/dashboard.api';
import type { VaultRecord } from '../types/dashboard.types';

const COUNTRY_ISO: Record<string, string> = {
  india: 'IN', 'united states': 'US', usa: 'US', america: 'US',
  'united kingdom': 'GB', uk: 'GB', england: 'GB',
  australia: 'AU', canada: 'CA', germany: 'DE', france: 'FR',
  japan: 'JP', china: 'CN', singapore: 'SG', uae: 'AE',
  'united arab emirates': 'AE', russia: 'RU', brazil: 'BR',
  'south africa': 'ZA', italy: 'IT', spain: 'ES', netherlands: 'NL',
  'new zealand': 'NZ', pakistan: 'PK', bangladesh: 'BD', 'sri lanka': 'LK',
};

function splitCountryList(v: string) {
  return v.split(',').map((s) => {
    const trimmed = s.trim();
    if (!trimmed) return '';
    if (/^[A-Z]{2,3}$/.test(trimmed)) return trimmed;
    return COUNTRY_ISO[trimmed.toLowerCase()] ?? trimmed.toUpperCase().slice(0, 2);
  }).filter(Boolean);
}

function splitSimpleList(v: string) {
  return v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function ToggleRow({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-bg-elevated rounded-xl border border-bg-border">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white">{label}</p>
        <p className="text-2xs text-gray-500">{desc}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${value ? 'bg-dna-500' : 'bg-bg-border'}`}
        aria-pressed={value}
      >
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${value ? 'left-5' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-bg-border last:border-0">
      <span className="text-2xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-white text-right min-w-0 break-words">{value}</span>
    </div>
  );
}

export function VaultSharePage() {
  const { assetId = '' } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaignReviewIntent = searchParams.get('intent') === 'review';

  const [record, setRecord] = useState<VaultRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [expiresIn, setExpiresIn] = useState('168');
  const [maxViews, setMaxViews] = useState('');
  const [allowDownload, setAllowDownload] = useState(false);
  const [requireName, setRequireName] = useState(false);
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);

  // Review permissions. Off by default so an ordinary share is unchanged.
  const [review, setReview] = useState<ReviewPermissions>({
    reviewMode: false, allowComments: false, allowChangeRequest: false, allowApproval: false,
  });
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [oneTimeUse, setOneTimeUse] = useState(false);
  const [maxDownloads, setMaxDownloads] = useState('');
  const [allowedCountries, setAllowedCountries] = useState('');
  const [allowedDeviceTypes, setAllowedDeviceTypes] = useState('');
  const [allowedIpPrefixes, setAllowedIpPrefixes] = useState('');
  const [requireOtp, setRequireOtp] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');

  const [privacyMaskingEnabled, setPrivacyMaskingEnabled] = useState(false);
  const [maskEmail, setMaskEmail] = useState(false);
  const [maskPhone, setMaskPhone] = useState(false);
  const [maskAadhaar, setMaskAadhaar] = useState(false);
  const [maskPan, setMaskPan] = useState(false);
  const [maskAddress, setMaskAddress] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanSupported, setScanSupported] = useState(true);
  const [scanMsg, setScanMsg] = useState('');
  const [detected, setDetected] = useState({
    email: false, phone: false, aadhaar: false, pan: false, address: false,
  });

  const [requestLocation, setRequestLocation] = useState(true);
  const [vpnBlock, setVpnBlock] = useState(false);
  const [torBlock, setTorBlock] = useState(false);
  const [oneDeviceOnly, setOneDeviceOnly] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [existingLinks, setExistingLinks] = useState<any[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!assetId) {
        setLoadError('Missing asset id');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const vault = await getVaultRecord(assetId) as VaultRecord;
        if (cancelled) return;
        if (!vault?.id) {
          setLoadError('Asset not found');
          setRecord(null);
        } else {
          setRecord(vault);
        }
      } catch {
        if (!cancelled) {
          setLoadError('Could not load this asset');
          setRecord(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId]);

  const fetchLinks = async (vaultId: string) => {
    setLoadingLinks(true);
    try {
      const { data } = await api.get(`${API_BASE_URL}/share/vault/${vaultId}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setExistingLinks((data as any).links ?? []);
    } catch {
      setExistingLinks([]);
    } finally {
      setLoadingLinks(false);
    }
  };

  useEffect(() => {
    if (record?.id) void fetchLinks(record.id);
  }, [record?.id]);

  // Ask whether this file can be reviewed before offering the controls, so the
  // sender is never shown an option that creation would refuse.
  useEffect(() => {
    if (!record?.id) return;
    let cancelled = false;
    setEligibilityLoading(true);
    api.get<{ eligible?: boolean; reason?: string; campaignName?: string | null;
              clientName?: string | null; versionCount?: number }>(
      `${API_BASE_URL}/business/share-eligibility/${record.id}`)
      .then(({ data }) => {
        if (cancelled) return;
        setEligibility({
          eligible: Boolean(data?.eligible),
          reason: data?.reason,
          campaignName: data?.campaignName ?? null,
          clientName: data?.clientName ?? null,
          versionCount: data?.versionCount ?? 0,
        });
      })
      // A business account is not required to share a file, so a failure here
      // means "no review", never an error over the whole page.
      .catch(() => {
        if (!cancelled) {
          setEligibility({ eligible: false, reason: 'Review is available for assets in a campaign.' });
        }
      })
      .then(() => { if (!cancelled) setEligibilityLoading(false); });
    return () => { cancelled = true; };
  }, [record?.id]);

  // Campaign Sharing tab always lands here as a review link, not a silent view-only share.
  useEffect(() => {
    if (!campaignReviewIntent || !eligibility?.eligible) return;
    setReview((prev) => (prev.reviewMode
      ? prev
      : { reviewMode: true, allowComments: true, allowChangeRequest: true, allowApproval: false }));
  }, [campaignReviewIntent, eligibility?.eligible]);

  const handleCreate = async () => {
    if (!record) return;
    if (campaignReviewIntent && !review.reviewMode) {
      toast.error('A campaign review link must have client review turned on.');
      return;
    }
    setCreating(true);
    try {
      const { data } = await api.post(`${API_BASE_URL}/share`, {
        vaultId: record.id,
        expiresIn: expiresIn ? Number(expiresIn) : null,
        maxViews: maxViews ? Number(maxViews) : null,
        allowDownload,
        requireName,
        note: note.trim() || undefined,
        oneTimeUse,
        maxDownloads: maxDownloads ? Number(maxDownloads) : null,
        allowedCountries: splitCountryList(allowedCountries),
        allowedDeviceTypes: splitSimpleList(allowedDeviceTypes),
        allowedIpPrefixes: splitSimpleList(allowedIpPrefixes),
        requireOtp,
        recipientEmail: recipientEmail.trim() || undefined,
        privacyMaskingEnabled,
        maskEmail: privacyMaskingEnabled && maskEmail,
        maskPhone: privacyMaskingEnabled && maskPhone,
        maskAadhaar: privacyMaskingEnabled && maskAadhaar,
        maskPan: privacyMaskingEnabled && maskPan,
        maskAddress: privacyMaskingEnabled && maskAddress,
        requestLocation,
        vpnBlock,
        torBlock,
        oneDeviceOnly,
        reviewMode:         review.reviewMode,
        allowComments:      review.allowComments,
        allowChangeRequest: review.allowChangeRequest,
        allowApproval:      review.allowApproval,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      const token = String(d.token ?? '');
      const shareUrl = String(d.shareUrl ?? '');
      if (!token || !shareUrl) throw new Error('Missing share response');

      toast.success('Secure link created');
      navigate(`/vault/assets/${record.id}/shares/${encodeURIComponent(token)}`, {
        replace: true,
        state: {
          shareUrl,
          token,
          shareId: d.id ?? token,
          expiresIn: expiresIn || null,
          maxViews: maxViews || null,
          allowDownload,
          requireName,
          requestLocation,
          privacyMaskingEnabled,
          reviewMode:         review.reviewMode,
          allowComments:      review.allowComments,
          allowChangeRequest: review.allowChangeRequest,
          allowApproval:      review.allowApproval,
          watermark: true,
          tracking: true,
          createdAt: new Date().toISOString(),
          filename: record.originalFileName,
          devOtp: d.devOtp,
          devOtpNote: d.devOtpNote,
          childLinks: d.childLinks ?? [],
        },
      });
    } catch {
      toast.error('Failed to create share link');
    } finally {
      setCreating(false);
    }
  };

  const runSensitiveScan = async () => {
    if (!record || scanning) return;
    setScanning(true);
    setScanMsg('Detecting sensitive fields in the background…');
    try {
      const { data } = await api.post(
        `${API_BASE_URL}/vault/${record.id}/scan-sensitive`,
        {},
        { timeout: 15_000 },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setScanSupported(d.supported !== false);
      if (d.supported === false) {
        setScanMsg(d.reason ?? 'Masking not supported for this file type.');
      } else {
        setDetected({
          email: !!d.email, phone: !!d.phone, aadhaar: !!d.aadhaar, pan: !!d.pan, address: !!d.address,
        });
        if (d.email) setMaskEmail(true);
        if (d.phone) setMaskPhone(true);
        if (d.aadhaar) setMaskAadhaar(true);
        if (d.pan) setMaskPan(true);
        if (d.address) setMaskAddress(true);
        setScanMsg(
          d.hasAnyMatch
            ? 'Detected fields highlighted below — adjust before creating the link.'
            : (d.reason ?? 'No sensitive data auto-detected — toggle types manually if needed.'),
        );
      }
      setScanDone(true);
    } catch {
      setScanSupported(true);
      setScanMsg('Scan skipped or timed out — enable mask types manually if needed.');
      setScanDone(true);
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[40vh]">
        <RefreshCw className="animate-spin text-dna-400" size={22} />
      </div>
    );
  }

  if (loadError || !record) {
    return (
      <div className="page-shell animate-fade-in space-y-4">
        <p className="text-sm text-danger">{loadError ?? 'Asset not found'}</p>
        <Link to="/vault" className="btn btn-secondary btn-sm inline-flex">
          <ArrowLeft size={14} /> Back to Digital Assets
        </Link>
      </div>
    );
  }

  const fileType = getVaultFileTypeDisplay(record.originalMimeType, record.originalFileName);
  const dnaStatus = record.dnaRecord?.status ?? 'PROTECTED';
  const activeLinks = existingLinks.filter((l) => l.isActive).length;

  return (
    <div className="page-shell animate-fade-in space-y-5">
      <nav className="flex flex-wrap items-center gap-1.5 text-2xs text-gray-500">
        <span className="text-gray-400">{BRAND.name}</span>
        <ChevronRight size={10} />
        <Link to="/vault" className="hover:text-white transition-colors">Digital Assets</Link>
        <ChevronRight size={10} />
        <span className="text-gray-300 truncate max-w-[12rem] sm:max-w-xs">{record.originalFileName}</span>
        <ChevronRight size={10} />
        <span className="text-white">Share Secure Link</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate('/vault')}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white mb-2"
          >
            <ArrowLeft size={13} /> Back to Digital Assets
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {campaignReviewIntent ? 'Create client review link' : 'Share secure link'}
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            {campaignReviewIntent
              ? 'The recipient opens this link without joining your organisation or campaign People list. They see only this file and can comment or request changes on the current version.'
              : 'Control how this protected asset can be accessed and shared.'}
          </p>
        </div>
        <Badge variant="success" dot>Protected asset</Badge>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        {/* LEFT — configuration */}
        <section className="card space-y-5 order-2 xl:order-1">
          <div>
            <h2 className="text-sm font-semibold text-white">Share configuration</h2>
            <p className="text-2xs text-gray-500 mt-0.5">
              Set limits, then create a tracked secure link for this file.
            </p>
          </div>

          <div className="border border-bg-border rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-bg-elevated text-xs font-semibold text-gray-300 flex items-center justify-between">
              <span>Existing links ({activeLinks} active)</span>
              {loadingLinks && <RefreshCw size={11} className="animate-spin text-gray-500" />}
            </div>
            <div className="divide-y divide-bg-border max-h-32 overflow-y-auto">
              {!loadingLinks && existingLinks.length === 0 && (
                <p className="text-xs text-gray-500 px-3 py-2.5 text-center">No links yet</p>
              )}
              {existingLinks.map((link) => (
                <div key={link.id ?? link.token} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs text-dna-400 mono truncate">{link.token}</p>
                    <p className="text-2xs text-gray-500">
                      {link.isActive ? 'Active' : 'Revoked'}
                      {typeof link.viewCount === 'number' ? ` · ${link.viewCount} views` : ''}
                    </p>
                  </div>
                  <Link
                    to={`/vault/assets/${record.id}/shares/${encodeURIComponent(link.token)}`}
                    className="text-2xs text-dna-400 hover:text-white shrink-0"
                  >
                    Manage
                  </Link>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-300 block mb-2">Access expires after</label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '1 Hour', value: '1' },
                { label: '24 Hours', value: '24' },
                { label: '7 Days', value: '168' },
                { label: '30 Days', value: '720' },
                { label: 'Never', value: '' },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setExpiresIn(opt.value)}
                  className={`text-xs px-3 py-2 rounded-lg border transition-all ${
                    expiresIn === opt.value
                      ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                      : 'border-bg-border text-gray-500 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-300 block mb-1.5">
              Maximum views <span className="text-gray-500 font-normal">(empty = unlimited)</span>
            </label>
            <input
              type="number"
              min="1"
              value={maxViews}
              onChange={(e) => setMaxViews(e.target.value)}
              placeholder="e.g. 5"
              className="input text-sm w-full"
            />
          </div>

          <div className="space-y-2">
            <ToggleRow
              label="Allow download"
              desc="Recipient can save a copy"
              value={allowDownload}
              onChange={setAllowDownload}
            />
            <ToggleRow
              label="Require recipient name"
              desc="Ask for a name before opening"
              value={requireName}
              onChange={setRequireName}
            />
            <div className="flex items-center justify-between gap-3 p-3 bg-bg-elevated rounded-xl border border-bg-border">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">Watermark</p>
                <p className="text-2xs text-gray-500">Applied on protected delivery and tracked views</p>
              </div>
              <Badge variant="success">On</Badge>
            </div>
            <button
              type="button"
              onClick={() => setRequestLocation((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors ${
                requestLocation
                  ? 'border-green-500/40 bg-green-500/10'
                  : 'border-bg-border bg-bg-elevated hover:border-green-500/25'
              }`}
            >
              <div className="min-w-0 pr-3">
                <p className={`text-xs font-semibold flex items-center gap-2 ${requestLocation ? 'text-green-400' : 'text-gray-300'}`}>
                  <MapPin size={12} />
                  Location restriction
                  <span className={`text-2xs px-1.5 py-0.5 rounded font-bold ${
                    requestLocation ? 'bg-green-500/20 text-green-400' : 'bg-bg-border text-gray-500'
                  }`}>
                    {requestLocation ? 'ON' : 'OFF'}
                  </span>
                </p>
                <p className="text-2xs text-gray-500 mt-0.5">
                  {requestLocation
                    ? 'Viewer must allow location to open the file.'
                    : 'Off — approximate place via network may still be logged.'}
                </p>
              </div>
              <div className={`w-8 h-4 rounded-full relative shrink-0 ${requestLocation ? 'bg-green-500' : 'bg-bg-border'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${requestLocation ? 'left-4' : 'left-0.5'}`} />
              </div>
            </button>
          </div>

          <ReviewShareControls
            value={review}
            onChange={setReview}
            eligibility={eligibility}
            loading={eligibilityLoading}
            required={campaignReviewIntent}
          />

          <div className="border border-bg-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-gray-300 hover:text-white bg-bg-elevated"
            >
              <span>More protection options</span>
              <span className="text-gray-500">{showAdvanced ? '−' : '+'}</span>
            </button>
            {showAdvanced && (
              <div className="p-3 space-y-3 bg-bg-card">
                <ToggleRow label="One-time link" desc="Stops after the first successful open" value={oneTimeUse} onChange={setOneTimeUse} />
                <ToggleRow label="Require a code (OTP)" desc="Recipient enters a 6-digit code" value={requireOtp} onChange={setRequireOtp} />
                {requireOtp && (
                  <div className="p-3 bg-dna-500/5 border border-dna-500/20 rounded-xl space-y-2">
                    <p className="text-2xs text-gray-400">
                      After create, a code appears on the manage page. Send it separately to the recipient.
                    </p>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="recipient@example.com (optional)"
                      className="input text-sm w-full"
                    />
                  </div>
                )}
                <ToggleRow label="Block TOR" desc="Block openings from TOR networks" value={torBlock} onChange={setTorBlock} />
                <ToggleRow label="Block VPN" desc="Block openings from VPN providers" value={vpnBlock} onChange={setVpnBlock} />
                <ToggleRow label="One device only" desc="Lock to the first device that opens it" value={oneDeviceOnly} onChange={setOneDeviceOnly} />
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1.5">Max downloads</label>
                  <input type="number" min="1" value={maxDownloads} onChange={(e) => setMaxDownloads(e.target.value)} placeholder="e.g. 3" className="input text-sm w-full" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1.5">Allowed countries</label>
                  <input type="text" value={allowedCountries} onChange={(e) => setAllowedCountries(e.target.value)} placeholder="India, US, UK" className="input text-sm w-full" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1.5">Allowed device types</label>
                  <input type="text" value={allowedDeviceTypes} onChange={(e) => setAllowedDeviceTypes(e.target.value)} placeholder="desktop, mobile" className="input text-sm w-full" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1.5">Allowed IP prefixes</label>
                  <input type="text" value={allowedIpPrefixes} onChange={(e) => setAllowedIpPrefixes(e.target.value)} placeholder="10.0., 192.168." className="input text-sm w-full" />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-300 block mb-1.5">
              Note for recipient <span className="text-gray-500 font-normal">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Please review this document carefully…"
              rows={2}
              className="input w-full text-sm resize-none"
            />
          </div>

          <div className="border border-bg-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => {
                const next = !privacyMaskingEnabled;
                setPrivacyMaskingEnabled(next);
                // Never block Create Link on scan — detect in background
                if (next && !scanDone && !scanning) void runSensitiveScan();
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-gray-300 hover:text-white bg-bg-elevated"
            >
              <span>Hide sensitive details</span>
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${privacyMaskingEnabled ? 'bg-dna-500/20 text-dna-400' : 'text-gray-500'}`}>
                {privacyMaskingEnabled ? 'ON' : 'OFF'}
              </span>
            </button>
            {privacyMaskingEnabled && (
              <div className="px-3 py-3 space-y-2 bg-bg-base">
                <p className="text-2xs text-gray-500">Original file is never modified. Masking applies only to the recipient view.</p>
                {scanning && (
                  <p className="text-2xs text-dna-400 flex items-center gap-1.5">
                    <RefreshCw size={11} className="animate-spin" />
                    Auto-detect running — you can still create the link or set types manually
                  </p>
                )}
                {scanMsg && !scanning && (
                  <p className="text-2xs text-yellow-400 bg-yellow-500/10 rounded px-2 py-1.5">{scanMsg}</p>
                )}
                {scanSupported && (
                  <>
                    {[
                      { label: 'Email addresses', val: maskEmail, set: setMaskEmail, found: detected.email },
                      { label: 'Phone numbers', val: maskPhone, set: setMaskPhone, found: detected.phone },
                      { label: 'Aadhaar numbers', val: maskAadhaar, set: setMaskAadhaar, found: detected.aadhaar },
                      { label: 'PAN numbers', val: maskPan, set: setMaskPan, found: detected.pan },
                      { label: 'Addresses', val: maskAddress, set: setMaskAddress, found: detected.address },
                    ].map((row) => (
                      <ToggleRow
                        key={row.label}
                        label={`${row.label}${scanDone ? (row.found ? ' · Found' : ' · Not found') : ''}`}
                        desc=""
                        value={row.val}
                        onChange={row.set}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="btn btn-primary w-full sm:w-auto sm:min-w-[220px]"
          >
            {creating
              ? <><RefreshCw size={14} className="animate-spin" /> Creating secure link…</>
              : <><Share2 size={14} /> {review.reviewMode ? 'Create Secure Review Link' : 'Create Secure Link'}</>}
          </button>
        </section>

        {/* RIGHT — asset summary */}
        <aside className="card space-y-1 order-1 xl:order-2 xl:sticky xl:top-20">
          <div className="flex items-center gap-3 pb-3 border-b border-bg-border mb-1">
            <div className="w-10 h-10 rounded-xl bg-success/15 flex items-center justify-center shrink-0">
              <Lock size={16} className="text-success" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{record.originalFileName}</p>
              <p className="text-2xs text-gray-500">Asset summary</p>
            </div>
          </div>
          <SummaryRow label="Asset name" value={record.originalFileName} />
          <SummaryRow label="File type" value={fileType} />
          <SummaryRow label="File size" value={formatBytes(record.originalSizeBytes)} />
          <SummaryRow label="Protected status" value={<span className="text-success font-semibold">Protected</span>} />
          <SummaryRow label="DNA status" value={dnaStatus} />
          <SummaryRow label="Vault status" value={<span className="inline-flex items-center gap-1 text-success"><ShieldCheck size={12} /> In vault</span>} />
          <SummaryRow label="Provenance / certificate" value="Bound to DNA record" />
          <SummaryRow
            label="Created"
            value={
              <span className="inline-flex items-center gap-1 text-gray-300">
                <Clock size={11} />
                {new Date(record.createdAt).toLocaleString()}
              </span>
            }
          />
        </aside>
      </div>
    </div>
  );
}
