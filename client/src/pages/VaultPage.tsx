import { useState, useEffect } from 'react';
import { Archive, Search, Lock, RefreshCw, Download, Eye, ExternalLink, Share2, Copy, Check, Clock, Ban, FileSearch, Cpu, GitBranch, ShieldCheck, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useApi, formatBytes } from '../hooks/useApi';
import {
  listVaultRecords,
  retrieveFromVault,
  protectedDownloadFromVault,
  getVaultTracking,
  revokeVaultTep,
  api,
  type VaultTrackingDashboard,
} from '../services/dashboard.api';
import { SkeletonTable } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';
import type { VaultRecord } from '../types/dashboard.types';

function VaultDetailModal({ record, onClose }: { record: VaultRecord; onClose: () => void }) {
  const [retrieving, setRetrieving] = useState(false);
  const { user } = useAuth();

  const handleRetrieve = async () => {
    setRetrieving(true);
    try {
      const blob = await retrieveFromVault(record.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = record.originalFileName;
      a.click(); URL.revokeObjectURL(url);
      toast.success('File downloaded with forensic identity embedded (lifetime tracking active)');
    } catch {
      toast.error('Failed to retrieve file from vault');
    } finally {
      setRetrieving(false);
    }
  };

  return (
    <Modal open title="Vault Record Details" onClose={onClose} size="lg">
      <div className="p-6 space-y-4">
        {/* File info */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Vault ID',            value: record.id,                     mono: true,  accent: true  },
            { label: 'DNA Record ID',        value: record.dnaRecordId,            mono: true,  accent: true  },
            { label: 'Original File',        value: record.originalFileName,       mono: false, accent: false },
            { label: 'MIME Type',            value: record.originalMimeType,       mono: true,  accent: false },
            { label: 'Original Size',        value: formatBytes(record.originalSizeBytes), mono: true, accent: false },
            { label: 'Encrypted Size',       value: formatBytes(record.encryptedSizeBytes), mono: true, accent: false },
            { label: 'Encryption',           value: record.encryptionAlgorithm,    mono: true,  accent: false },
            { label: 'Key Derivation',       value: record.keyDerivation,          mono: true,  accent: false },
            { label: 'Stored At',            value: format(new Date(record.createdAt), 'PPpp'), mono: false, accent: false },
            { label: 'Owner User ID',        value: user?.shortId ?? '—', mono: true, accent: true },
          ].map(row => (
            <div key={row.label} className="bg-bg-elevated rounded-lg p-3">
              <p className="text-2xs text-gray-500 mono mb-1">{row.label}</p>
              <p className={`text-xs break-all ${row.mono ? 'mono' : ''} ${row.accent ? 'text-dna-400' : 'text-gray-200'}`}>
                {row.value}
              </p>
            </div>
          ))}
        </div>

        {/* Location status — custody evidence, not DNA */}
        <div className={`rounded-xl border p-4 ${
          record.location?.status === 'AVAILABLE'
            ? 'bg-dna-500/5 border-dna-500/25'
            : 'bg-bg-elevated border-bg-border'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={14} className={record.location?.status === 'AVAILABLE' ? 'text-dna-400' : 'text-gray-500'} />
            <p className="text-xs font-semibold text-white">Location Status</p>
            <span className={`text-2xs px-1.5 py-0.5 rounded font-semibold ${
              record.location?.status === 'AVAILABLE'
                ? 'bg-success/15 text-success'
                : 'bg-gray-500/20 text-gray-400'
            }`}>
              {record.location?.status === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE'}
            </span>
          </div>
          {record.location?.status === 'AVAILABLE' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-2xs text-gray-500">Created</p>
                <p className="text-gray-200 break-all">{record.location.creationLabel ?? '—'}</p>
                {record.location.creationSource && record.location.creationSource !== 'none' && (
                  <p className="text-2xs text-gray-500">{record.location.creationSource.toUpperCase()}</p>
                )}
              </div>
              <div>
                <p className="text-2xs text-gray-500">Shared / downloaded</p>
                <p className="text-gray-200 break-all">{record.location.sharedLabel ?? '—'}</p>
                {record.location.sharedSource && record.location.sharedSource !== 'none' && (
                  <p className="text-2xs text-gray-500">{record.location.sharedSource.toUpperCase()}</p>
                )}
              </div>
              <div>
                <p className="text-2xs text-gray-500">Present (last known)</p>
                <p className="text-gray-200 break-all">
                  {record.location.presentLabel ?? record.location.lastKnownLabel ?? '—'}
                </p>
                {(record.location.presentSource || record.location.lastKnownSource)
                  && (record.location.presentSource ?? record.location.lastKnownSource) !== 'none' && (
                  <p className="text-2xs text-gray-500">
                    {(record.location.presentSource ?? record.location.lastKnownSource)!.toUpperCase()}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-2xs text-gray-400">
              No location recorded yet. On Generate DNA, enable “Allow location for custody tracking”
              and grant browser permission to store creation GPS. Protected downloads record IP/geo when
              available. WhatsApp shares do not report location to PINIT.
            </p>
          )}
        </div>

        {/* Security info */}
        <div className="rounded-xl bg-success/5 border border-success/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} className="text-success" />
            <p className="text-xs font-semibold text-success">Encryption Details</p>
          </div>
          <p className="text-2xs text-gray-400">
            File is encrypted with AES-256-GCM. The encryption key is NEVER stored —
            it is re-derived on demand from the Vault ID using HKDF-SHA256.
            The authentication tag ensures tamper detection during decryption.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 pt-2">
          <div className="flex gap-3">
            <button
              onClick={handleRetrieve}
              disabled={retrieving}
              className="btn btn-secondary flex-1"
            >
              {retrieving ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              {retrieving ? 'Decrypting…' : 'Retrieve & Decrypt'}
            </button>
            <button onClick={onClose} className="btn btn-secondary">
              Close
            </button>
          </div>
          <p className="text-2xs text-gray-500 text-center">
            Every download embeds a unique forensic identity (watermark + signature + recovery token) — like a QR code for lifetime tracking.
          </p>
        </div>
      </div>
    </Modal>
  );
}

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
  const [purpose, setPurpose] = useState('Personal');
  const [expiryDays, setExpiryDays] = useState(30);
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
        purpose,
        expiryDays,
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-2xs text-gray-500">Purpose</label>
                <select
                  className="input text-sm mt-1"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                >
                  <option>Personal</option>
                  <option>Employment</option>
                  <option>Legal</option>
                  <option>Partner Share</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label className="text-2xs text-gray-500">Expiry (days)</label>
                <select
                  className="input text-sm mt-1"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Number(e.target.value))}
                >
                  <option value={7}>7 Days</option>
                  <option value={30}>30 Days</option>
                  <option value={90}>90 Days</option>
                </select>
              </div>
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

// ─── Tracking Dashboard Modal (Phase B) ──────────────────────────────────────

function TrackingDashboardModal({ record, onClose }: { record: VaultRecord; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<VaultTrackingDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const tracking = await getVaultTracking(record.id);
      setData(tracking);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracking');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [record.id]);

  const handleRevoke = async (tepCode: string) => {
    setRevoking(tepCode);
    try {
      const result = await revokeVaultTep(record.id, tepCode, 'Owner revoked access');
      toast.success(result.message);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Modal open title="Tracking Dashboard" onClose={onClose} size="lg">
      <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">{record.originalFileName}</p>
            <p className="text-2xs text-gray-500 mono">{record.id}</p>
          </div>
          {data && (
            <span className={`text-2xs px-2 py-1 rounded font-semibold ${
              data.status === 'REVOKED' ? 'bg-danger/15 text-danger'
                : data.status === 'PROTECTED' ? 'bg-success/15 text-success'
                  : 'bg-gray-500/20 text-gray-300'
            }`}>
              {data.status}
            </span>
          )}
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-2xs text-amber-100/90 space-y-1">
          <p className="font-semibold text-amber-200">What PINIT can track</p>
          <p>
            Events appear only when someone uses <span className="font-semibold">PINIT</span>
            (Protected Download, share link, or Unified Investigation).
          </p>
          <p>
            Sending the file on <span className="font-semibold">WhatsApp / Telegram / email</span> does
            <span className="font-semibold"> not</span> notify PINIT — so you will not see Shared or Opened for those apps.
          </p>
          <p>
            <span className="font-semibold">Location:</span> shown only from the download request IP.
            Localhost / private network shows as “Local Network”, not a city. Real city/country appears when
            Protected Download runs on a deployed server (or a public IP), not from WhatsApp.
          </p>
        </div>

        {loading && (
          <p className="text-xs text-gray-500 flex items-center gap-2">
            <RefreshCw size={14} className="animate-spin" /> Loading custody timeline…
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['Downloads', String(data.summary.downloadCount)],
                ['Investigations', String(data.summary.investigationCount)],
                ['Tamper events', String(data.summary.tamperCount)],
                ['TEP packages', String(data.tepPackages.length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-bg-border bg-bg-elevated/40 px-2 py-1.5">
                  <p className="text-2xs text-gray-500">{label}</p>
                  <p className="text-sm font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-dna-500/25 bg-dna-500/5 px-3 py-2">
              <p className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
                <MapPin size={14} className="text-dna-400" /> Locations (custody)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-2xs">
                <div>
                  <p className="text-gray-500">Created</p>
                  <p className="text-gray-200 break-all">{data.location?.creationLabel ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500">Shared / downloaded</p>
                  <p className="text-gray-200 break-all">{data.location?.sharedLabel ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500">Present (last known)</p>
                  <p className="text-gray-200 break-all">
                    {data.location?.presentLabel ?? data.location?.lastKnownLabel ?? '—'}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-white mb-2">TEP Packages</p>
              {data.tepPackages.length === 0 ? (
                <p className="text-2xs text-gray-500">No TEP packages yet — use Protected Download.</p>
              ) : (
                <div className="space-y-2">
                  {data.tepPackages.map((t) => (
                    <div key={t.tepCode} className="flex items-center justify-between gap-2 rounded-lg border border-bg-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs mono text-dna-300">{t.tepCode}</p>
                        <p className="text-2xs text-gray-500">
                          {t.status} · {format(new Date(t.createdAt), 'PPp')}
                          {t.geoCity || t.geoCountry ? ` · ${[t.geoCity, t.geoCountry].filter(Boolean).join(', ')}` : ''}
                        </p>
                      </div>
                      {t.status === 'ACTIVE' && (
                        <button
                          className="btn btn-secondary btn-sm text-danger"
                          disabled={revoking === t.tepCode}
                          onClick={() => handleRevoke(t.tepCode)}
                        >
                          {revoking === t.tepCode ? '…' : 'Revoke'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-white mb-2">Download History</p>
              {data.downloads.length === 0 ? (
                <p className="text-2xs text-gray-500">No downloads recorded.</p>
              ) : (
                <div className="space-y-2">
                  {data.downloads.map((d) => (
                    <div key={d.id} className="border-l-2 border-dna-500/30 pl-3 py-1">
                      <p className="text-xs text-white">{d.summary}</p>
                      <p className="text-2xs text-gray-500">
                        {format(new Date(d.timestamp), 'PPp')}
                        {d.locationLabel ? ` · ${d.locationLabel}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-white mb-2">Chain of Custody</p>
              <div className="space-y-1">
                {data.chainOfCustody.map((c, i) => (
                  <div key={`${c.eventType}-${c.timestamp}-${i}`} className="flex gap-2 text-2xs">
                    <span className="text-dna-400 shrink-0">↓</span>
                    <div>
                      <p className="text-gray-200 font-semibold">{c.step}</p>
                      <p className="text-gray-500">{c.summary} · {format(new Date(c.timestamp), 'PPp')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
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

  // ── GPS Location — always mandatory, no toggle
  const requestLocation = true;

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
              <div className="grid grid-cols-4 gap-2">
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

            {/* ── GPS Location — Always Mandatory ──────────────────── */}
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-green-500/30 bg-green-500/5">
              <div>
                <p className="text-xs font-semibold text-green-400 flex items-center gap-2">
                  📍 GPS Location Tracking
                  <span className="text-2xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-bold">MANDATORY</span>
                </p>
                <p className="text-2xs text-gray-500 mt-0.5">Viewer must allow GPS location to access the file. No location = no access.</p>
              </div>
            </div>

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
                <p className="text-2xs text-gray-400 mt-0.5">Access is tracked — every view is logged in File Timeline</p>
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

            {/* Share via */}
            <div className="grid grid-cols-3 gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent('Secure file: ' + created.shareUrl)}`}
                target="_blank" rel="noreferrer"
                className="btn btn-secondary btn-sm text-xs justify-center">
                WhatsApp
              </a>
              <a href={`mailto:?subject=Shared+File&body=${encodeURIComponent('Access this secure file: ' + created.shareUrl)}`}
                className="btn btn-secondary btn-sm text-xs justify-center">
                Email
              </a>
              <button onClick={handleCopy} className="btn btn-secondary btn-sm text-xs">
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
              All access events appear in File Timeline with IP, browser, and location
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function VaultPage() {
  const { data: records, loading, error, refetch } = useApi(listVaultRecords);
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState<VaultRecord | null>(null);
  const [sharing, setSharing]   = useState<VaultRecord | null>(null);
  const [protecting, setProtecting] = useState<VaultRecord | null>(null);
  const [tracking, setTracking] = useState<VaultRecord | null>(null);
  const [aiMode, setAiMode]     = useState(false);
  const [aiResults, setAiResults] = useState<string[]>([]); // dnaRecordIds matching AI search
  const [aiSearching, setAiSearching] = useState(false);
  const navigate = useNavigate();

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
    if (!search) return true;
    const keyword = (
      r.originalFileName.toLowerCase().includes(search.toLowerCase()) ||
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      r.dnaRecordId.toLowerCase().includes(search.toLowerCase())
    );
    if (aiMode && !aiSearching) {
      // If AI returned results, use them; otherwise fall back to keyword
      return aiResults.length > 0 ? aiResults.includes(r.dnaRecordId) : keyword;
    }
    return keyword;
  });

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
    <div className="space-y-5 animate-fade-in">
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
        <div className="grid grid-cols-3 gap-3">
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

      {/* Search + table */}
      <div className="card overflow-hidden p-0">
        <div className="flex items-center gap-3 p-4 border-b border-bg-border">
          <div className="relative flex-1">
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
          <button
            onClick={() => { setAiMode(m => !m); setSearch(''); setAiResults([]); }}
            title={aiMode ? 'Switch to keyword search' : 'Switch to AI semantic search'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all shrink-0 ${
              aiMode
                ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                : 'border-bg-border text-gray-500 hover:text-white hover:border-gray-600'
            }`}
          >
            <Cpu size={13} />
            {aiMode ? 'AI Search ON' : 'AI Search'}
          </button>
          <Archive size={16} className="text-gray-500 shrink-0" />
        </div>

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
                  <tr key={r.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Lock size={12} className="text-success shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-white truncate max-w-[200px]">
                            {r.originalFileName}
                          </p>
                          <p className="text-2xs text-gray-500 mono">{r.originalMimeType}</p>
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
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelected(r)}
                          className="btn-ghost btn-icon text-gray-500 hover:text-white"
                          title="View details"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => setSharing(r)}
                          className="btn-ghost btn-icon text-gray-500 hover:text-dna-400"
                          title="Generate Smart Share Link"
                        >
                          <Share2 size={14} />
                        </button>
                        <button
                          onClick={() => setProtecting(r)}
                          className="btn-ghost btn-icon text-gray-500 hover:text-success"
                          title="Protected Download"
                        >
                          <ShieldCheck size={14} />
                        </button>
                        <button
                          onClick={() => setTracking(r)}
                          className="btn-ghost btn-icon text-gray-500 hover:text-dna-400"
                          title="Tracking Dashboard"
                        >
                          <MapPin size={14} />
                        </button>
                        <button
                          onClick={() => navigate(`/intelligence/${r.id}`)}
                          className="btn-ghost btn-icon text-gray-500 hover:text-purple-400"
                          title="Intelligence Report"
                        >
                          <FileSearch size={14} />
                        </button>
                        <a
                          href={`/api/v1/dna/${r.dnaRecordId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-ghost btn-icon text-gray-500 hover:text-dna-400"
                          title="Open DNA record"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <VaultDetailModal record={selected} onClose={() => setSelected(null)} />
      )}
      {sharing && (
        <ShareModal record={sharing} onClose={() => setSharing(null)} />
      )}
      {protecting && (
        <ProtectedDownloadModal record={protecting} onClose={() => setProtecting(null)} />
      )}
      {tracking && (
        <TrackingDashboardModal record={tracking} onClose={() => setTracking(null)} />
      )}
    </div>
  );
}
