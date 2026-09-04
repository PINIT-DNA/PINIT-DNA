/**
 * PINIT-DNA — Dashboard API Service
 * All HTTP calls for the Forensic Verification Dashboard.
 * Connects to the backend at /api/v1 via Vite proxy.
 */

import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { API_BASE_URL } from '../config/api.config';
import { vaultPreviewBlobLooksLikeJson } from '../lib/vault-preview-bytes';
import { refreshAccessToken, clearTokens, getAccessToken } from '../lib/auth';
import type {
  DnaRecord, VaultRecord, SupportedTypesResponse,
  ComparisonResult, DashboardStats,
  IssuedCertificate, CertVerificationResult,
} from '../types/dashboard.types';

/**
 * Derive the display file type from MIME when fileType column is NULL.
 * Records created before Phase 0 don't have fileType set in the DB.
 */
export function deriveFileType(record: DnaRecord): string {
  if (record.fileType) return record.fileType;

  const mime = (record.imageMimeType ?? '').toLowerCase();
  const name = (record.imageFilename ?? '').toLowerCase();

  if (mime.startsWith('image/'))                          return 'IMAGE';
  if (mime === 'application/pdf')                          return 'PDF';
  if (mime.includes('wordprocessingml') || name.endsWith('.docx')) return 'DOCX';
  if (mime.includes('presentationml')  || name.endsWith('.pptx'))  return 'PPTX';
  if (mime === 'text/plain'            || name.endsWith('.txt') || name.endsWith('.md')) return 'TXT';
  if (mime === 'text/csv'              || name.endsWith('.csv'))    return 'CSV';
  if (mime === 'application/json'      || name.endsWith('.json'))   return 'JSON';
  if (mime.includes('zip')             || name.endsWith('.zip'))    return 'ZIP';
  if (mime.startsWith('video/')        || name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.avi') || name.endsWith('.mkv')) return 'VIDEO';
  if (mime.startsWith('audio/')        || name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.flac') || name.endsWith('.ogg') || name.endsWith('.m4a')) return 'AUDIO';

  return 'IMAGE'; // safe fallback
}

export const api = axios.create({
  /**
   * Per-request ceiling — a busy backend (monitor/crawler) needs ~30s locally,
   * but the deployed API sleeps on Render's free tier and takes roughly 50s to
   * wake. At 30s every first request of the day failed, which surfaced as
   * "Internal server error" and a silently downgraded plan rather than a slow
   * page. Individual calls still set their own longer timeouts where needed.
   */
  timeout: 75_000,
  withCredentials: true,
});

/** Human-readable message for failed API calls (proxy offline, 5xx, etc.) */
export function formatApiError(err: unknown): string {
  if (err && typeof err === 'object' && 'isAxiosError' in err && (err as { isAxiosError?: boolean }).isAxiosError) {
    const ax = err as unknown as { response?: { status?: number; data?: { error?: string; code?: string } }; message: string };
    const data = ax.response?.data;
    if (data?.code === 'BACKEND_OFFLINE') {
      return import.meta.env.DEV
        ? 'Backend starting — auto-retrying… (or run npm run dev:all from project root)'
        : 'Backend offline — start the API from project root: npm run dev';
    }
    if (ax.response?.status === 503 && !data?.error && !(data as { status?: string })?.status) {
      return import.meta.env.DEV
        ? 'Backend starting — auto-retrying… (or run npm run dev:all from project root)'
        : 'Backend offline — start the API from project root: npm run dev';
    }
    if (typeof data?.error === 'string' && data.error) return data.error;
    if (ax.response?.status === 503) {
      return 'Service unavailable — ensure the backend is running on port 4000';
    }
    if (!ax.response) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isProd = Boolean((import.meta as any).env?.PROD);
      return isProd
        ? 'Backend waking up — Render cold start can take up to 60s. Tap Retry.'
        : 'Cannot reach API — start the backend (npm run dev) and retry';
    }
    return ax.message;
  }
  return err instanceof Error ? err.message : 'Request failed';
}

// Attach JWT to every request from this instance
api.interceptors.request.use((config) => {
  // A bare '/api/v1/…' URL only resolves locally, where Vite proxies it to the
  // backend. A production build resolves it against the site's own origin and
  // 404s — which is how Vault check shipped broken while every other call on
  // the page worked. The rule is in CLAUDE.md but nothing enforced it, so
  // enforce it here, loudly, at the moment the mistake is made.
  if (import.meta.env.DEV && config.url?.startsWith('/api/v1')) {
    // eslint-disable-next-line no-console
    console.error(
      `[api] "${config.url}" is a hardcoded path and will 404 in production. ` +
      'Use `${API_BASE_URL}/…` from config/api.config.ts instead.',
    );
  }

  const token = getAccessToken();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (token) (config.headers as any)['Authorization'] = `Bearer ${token}`;
  return config;
});

// On 401, refresh once; on network/5xx retry for Render cold starts
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const config = error.config as (typeof error.config & { _authRetried?: boolean; _netRetryCount?: number }) | undefined;
    if (!config) throw error;

    if (!config._authRetried && error.response?.status === 401) {
      const failedUrl = String(config.url ?? '');
      if (failedUrl.includes('/auth/refresh') || failedUrl.includes('/auth/logout')) {
        throw error;
      }
      config._authRetried = true;
      const newToken = await refreshAccessToken();
      if (!newToken) {
        if (!error.response) throw error;
        clearTokens();
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        throw error;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (config.headers as any)['Authorization'] = `Bearer ${newToken}`;
      return api.request(config);
    }

    const count = config._netRetryCount ?? 0;
    const status = error.response?.status;
    const backendOffline = error.response?.data?.code === 'BACKEND_OFFLINE'
      || (status === 503 && !error.response?.data?.success)
      || !error.response;
    const url = String(config.url ?? '');
    const isHeavyUpload = url.includes('/dna/generate') || url.includes('/vault/store');

    // Dev: retry while backend restarts — keep low to avoid multi-minute page loads
    const maxOfflineRetries = isHeavyUpload ? 3 : 4;
    if (import.meta.env.DEV && backendOffline && count < maxOfflineRetries) {
      config._netRetryCount = count + 1;
      await new Promise((r) => setTimeout(r, 1200 + count * 400));
      return api.request(config);
    }

    if (!error.response || error.response?.data?.code === 'BACKEND_OFFLINE') {
      error.message = formatApiError(error);
      throw error;
    }

    // Retry transient server errors (e.g. Render cold start) — not proxy offline
    const retryable = count < 4 && status >= 502 && status <= 504;
    if (retryable) {
      config._netRetryCount = count + 1;
      await new Promise((r) => setTimeout(r, 6000 + count * 2000));
      return api.request(config);
    }

    // Production: retry network failures while Render wakes from sleep
    const netFail = !error.response && error.code !== 'ECONNABORTED';
    const maxNetRetries = import.meta.env.PROD ? 4 : 0;
    if (netFail && count < maxNetRetries) {
      config._netRetryCount = count + 1;
      await new Promise((r) => setTimeout(r, 8000 + count * 3000));
      return api.request(config);
    }

    throw error;
  },
);

// ─── DNA Records ──────────────────────────────────────────────────────────────

export async function listDnaRecords(): Promise<DnaRecord[]> {
  const { data } = await api.get<{ records: DnaRecord[] }>(`${API_BASE_URL}/dna`);
  return data.records ?? [];
}

export async function getDnaRecord(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await api.get<any>(`${API_BASE_URL}/dna/${id}`);
  const rec = data.record ?? data;
  return {
    ...rec,
    filename:  rec.filename ?? rec.image?.filename ?? rec.imageFilename ?? null,
    createdAt: rec.createdAt,
  };
}

export async function getSupportedTypes(): Promise<SupportedTypesResponse> {
  const { data } = await api.get<SupportedTypesResponse>(`${API_BASE_URL}/dna/supported-types`);
  return data;
}

// ─── Vault Records ────────────────────────────────────────────────────────────

export async function listVaultRecords(): Promise<VaultRecord[]> {
  const { data } = await api.get<{ vaults: VaultRecord[] }>(`${API_BASE_URL}/vault`);
  return data.vaults ?? [];
}

export async function getVaultRecord(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await api.get<any>(`${API_BASE_URL}/vault/${id}`);
  return data.vault ?? data;
}

/** Run / re-run image analysis for Vault Explorer Details. */
export async function analyzeVaultContent(vaultId: string) {
  const { data } = await api.post<{
    success: boolean;
    contentLabel: string;
    contentAnalysis: VaultRecord['contentAnalysis'];
  }>(`${API_BASE_URL}/vault/${vaultId}/analyze-content`);
  return data;
}

/** Re-analyze every vault image. */
export async function reanalyzeAllVaultContent() {
  const { data } = await api.post<{
    success: boolean;
    total: number;
    updated: number;
    failed: number;
  }>(`${API_BASE_URL}/vault/reanalyze-all`, {}, { timeout: 600_000 });
  return data;
}

export async function deleteVaultRecord(vaultId: string): Promise<{ success: boolean; vaultId: string; dnaRecordId: string }> {
  const { data } = await api.delete<{ success: boolean; vaultId: string; dnaRecordId: string }>(
    `${API_BASE_URL}/vault/${vaultId}`,
  );
  return data;
}

export async function renameVaultRecord(
  vaultId: string,
  originalFileName: string,
): Promise<{ success: boolean; vaultId: string; originalFileName: string }> {
  const { data } = await api.patch<{ success: boolean; vaultId: string; originalFileName: string }>(
    `${API_BASE_URL}/vault/${vaultId}/rename`,
    { originalFileName },
  );
  return data;
}

export async function retrieveFromVault(vaultId: string): Promise<Blob> {
  const { data } = await api.post<Blob>(`${API_BASE_URL}/vault/${vaultId}/retrieve`, {}, {
    responseType: 'blob',
  });
  return data;
}

/** Clean decrypted bytes for vault gallery thumbnails (no forensic re-embedding). */
export async function previewVaultFile(vaultId: string, opts?: { thumb?: boolean }): Promise<Blob> {
  const q = opts?.thumb === false ? '' : '?thumb=1';
  const { data, headers } = await api.get<Blob>(`${API_BASE_URL}/vault/${vaultId}/preview${q}`, {
    responseType: 'blob',
    timeout: 120_000,
  });
  const rawHeader = headers['content-type'];
  const contentType = (
    typeof rawHeader === 'string' ? rawHeader
      : Array.isArray(rawHeader) ? rawHeader[0] ?? ''
        : ''
  ).toLowerCase();
  const buf = data instanceof Blob ? await data.arrayBuffer() : (data as ArrayBuffer);
  const bytes = new Uint8Array(buf);
  if (contentType.includes('application/json') || vaultPreviewBlobLooksLikeJson(bytes)) {
    const raw = new TextDecoder().decode(bytes);
    try {
      const parsed = JSON.parse(raw) as { error?: string; message?: string };
      throw new Error(parsed.error ?? parsed.message ?? 'Preview failed');
    } catch (e) {
      if (e instanceof Error && e.message !== 'Preview failed' && !e.message.startsWith('{')) throw e;
      throw new Error('Preview failed');
    }
  }
  if (bytes.byteLength === 0) {
    throw new Error('Empty preview response');
  }
  const mime = contentType.split(';')[0]?.trim() || 'application/octet-stream';
  return new Blob([buf], { type: mime });
}

export interface ProtectedDownloadStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'warning' | 'failed';
  detail?: string;
}

export interface ProtectedDownloadPrepareResult {
  success: boolean;
  ready: boolean;
  vaultId: string;
  dnaRecordId: string;
  certificateId: string | null;
  ownerShortId: string | null;
  forensicPreserved: boolean;
  steps: ProtectedDownloadStep[];
  originalFileName: string;
}

export async function prepareProtectedDownload(vaultId: string): Promise<ProtectedDownloadPrepareResult> {
  const { data } = await api.post<ProtectedDownloadPrepareResult>(
    `${API_BASE_URL}/vault/${vaultId}/protected-download/prepare`,
    {},
  );
  return data;
}

async function readBlobApiError(err: unknown): Promise<string> {
  const ax = err as {
    response?: { status?: number; data?: unknown };
    message?: string;
  };
  const data = ax.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      if (parsed.error) return parsed.error;
      if (parsed.message) return parsed.message;
      if (text.trim()) return text.trim();
    } catch {
      /* fall through */
    }
  }
  return formatApiError(err);
}

export async function protectedDownloadFromVault(
  vaultId: string,
  options?: { recipientLabel?: string; purpose?: string; expiryDays?: number },
): Promise<{ blob: Blob; tepCode?: string; downloadEventId?: string; tracking?: string }> {
  try {
    const response = await api.post<Blob>(
      `${API_BASE_URL}/vault/${vaultId}/protected-download`,
      {
        recipientLabel: options?.recipientLabel,
        purpose: options?.purpose,
        expiryDays: options?.expiryDays,
      },
      { responseType: 'blob' },
    );
    const headers = response.headers as Record<string, string | undefined>;
    return {
      blob: response.data,
      tepCode: headers['x-tep-code'],
      downloadEventId: headers['x-pinit-download-event-id'],
      tracking: headers['x-pinit-tep-tracking'],
    };
  } catch (err) {
    throw new Error(await readBlobApiError(err));
  }
}

export async function getLiveTrackingMap(): Promise<{
  points: Array<{
    id: string;
    vaultId: string | null;
    filename: string;
    token?: string;
    lat: number;
    lng: number;
    action: string;
    locationLabel: string;
    source: 'gps' | 'ip';
    timestamp: string;
    device: string | null;
  }>;
  totalAccessPoints: number;
  recentAccessCount: number;
  updatedAt: string;
}> {
  const { data } = await api.get<{
    success?: boolean;
    points?: Array<{
      id: string;
      vaultId: string | null;
      filename: string;
      token?: string;
      lat: number;
      lng: number;
      action: string;
      locationLabel: string;
      source: 'gps' | 'ip';
      timestamp: string;
      device: string | null;
    }>;
    totalAccessPoints?: number;
    recentAccessCount?: number;
    updatedAt?: string;
  }>(`${API_BASE_URL}/share/analytics/live-map`);
  return {
    points: data.points ?? [],
    totalAccessPoints: data.totalAccessPoints ?? 0,
    recentAccessCount: data.recentAccessCount ?? 0,
    updatedAt: data.updatedAt ?? new Date().toISOString(),
  };
}

export interface DashboardSecurityInsights {
  activeShares: { count: number; items: { filename: string; views: number; ago: string }[] };
  revokedShares: { count: number; items: { filename: string; ago: string }[] };
  crawlerAlerts: { count: number; items: { filename: string; url: string; matchType: string; similarity: number }[] };
  duplicateAttempts: { count: number; items: { filename: string; matchType: string; riskLevel: string; ago: string }[] };
}

/** Active shares, revokes, crawler alerts, duplicate attempts — dashboard security row */
export async function getDashboardSecurityInsights(): Promise<DashboardSecurityInsights> {
  const empty: DashboardSecurityInsights = {
    activeShares: { count: 0, items: [] },
    revokedShares: { count: 0, items: [] },
    crawlerAlerts: { count: 0, items: [] },
    duplicateAttempts: { count: 0, items: [] },
  };

  try {
    const [shareRes, dupRes, monitorStatsRes, alertsRes] = await Promise.all([
      api.get(`${API_BASE_URL}/share`).catch(() => ({ data: null })),
      api.get(`${API_BASE_URL}/dna/duplicate-attempts?limit=5`).catch(() => ({ data: null })),
      api.get(`${API_BASE_URL}/monitor/stats`).catch(() => ({ data: null })),
      api.get(`${API_BASE_URL}/monitor/alerts?status=PENDING`).catch(() => ({ data: null })),
    ]);

    interface ShareLinkRow { isActive?: boolean; filename?: string; viewCount?: number; createdAt?: string }
    const links = ((shareRes.data as { links?: ShareLinkRow[] } | null)?.links ?? []) as ShareLinkRow[];
    const active = links.filter(l => l.isActive);
    const revoked = links.filter(l => !l.isActive);

    interface DupEventRow { filename?: string; matchType?: string; riskLevel?: string; timestamp?: string }
    const dupPayload = dupRes.data as { events?: DupEventRow[]; total?: number } | null;
    const dupEvents = dupPayload?.events ?? [];
    const dupTotal = dupPayload?.total ?? dupEvents.length;

    const monitorStats = monitorStatsRes.data as { pendingAlerts?: number } | null;
    interface CrawlAlertRow { url?: string; similarity?: number; matchType?: string; monitorRecord?: { filename?: string } }
    const alertsPayload = alertsRes.data as { alerts?: CrawlAlertRow[] } | CrawlAlertRow[] | null;
    const alerts: CrawlAlertRow[] = Array.isArray(alertsPayload)
      ? alertsPayload
      : alertsPayload?.alerts ?? [];

    const fmtAgo = (d: string) => formatDistanceToNow(new Date(d), { addSuffix: true });

    return {
      activeShares: {
        count: active.length,
        items: active.slice(0, 3).map(l => ({
          filename: l.filename ?? 'Shared file',
          views: l.viewCount ?? 0,
          ago: l.createdAt ? fmtAgo(l.createdAt) : '',
        })),
      },
      revokedShares: {
        count: revoked.length,
        items: revoked.slice(0, 3).map(l => ({
          filename: l.filename ?? 'Shared file',
          ago: l.createdAt ? fmtAgo(l.createdAt) : '',
        })),
      },
      crawlerAlerts: {
        count: monitorStats?.pendingAlerts ?? alerts.length,
        items: alerts
          .slice(0, 3)
          .map(a => ({
            filename: a.monitorRecord?.filename ?? 'Monitored file',
            url: a.url ?? '',
            matchType: a.matchType ?? 'MATCH',
            similarity: Math.round(a.similarity != null && a.similarity <= 1 ? a.similarity * 100 : (a.similarity ?? 0)),
          })),
      },
      duplicateAttempts: {
        count: dupTotal,
        items: dupEvents
          .slice(0, 3)
          .map(e => ({
            filename: e.filename ?? 'Unknown file',
            matchType: (e.matchType ?? 'DUPLICATE').replace(/_/g, ' '),
            riskLevel: e.riskLevel ?? 'LOW',
            ago: e.timestamp ? fmtAgo(e.timestamp) : '',
          })),
      },
    };
  } catch {
    return empty;
  }
}

export async function getVaultTracking(vaultId: string) {
  const { data } = await api.get<{ success: boolean; tracking: VaultTrackingDashboard }>(
    `${API_BASE_URL}/vault/${vaultId}/tracking`,
  );
  return data.tracking;
}

export interface ProtectedFileShare {
  kind: 'file_open' | 'protected_download';
  id: string;
  tepCode: string | null;
  token: string | null;
  vaultId: string;
  dnaRecordId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  viewCount: number;
  downloadCount: number;
  geoCountry: string | null;
  geoCity: string | null;
  ipAddress: string | null;
  deviceContext: string | null;
  recipientEmail: string | null;
  createdAt: string;
  expiresAt: string | null;
  rediscoveredAt: string | null;
  lastViewedAt: string | null;
}

export async function listProtectedFileShares() {
  const { data } = await api.get<{ success: boolean; count: number; shares: ProtectedFileShare[] }>(
    `${API_BASE_URL}/vault/protected-shares`,
  );
  return data.shares ?? [];
}

export async function createFileShare(vaultId: string, opts?: { requestLocation?: boolean }) {
  const { data } = await api.post<{
    success: boolean;
    shareUrl: string;
    token: string;
    linkType: string;
    reused: boolean;
    filename: string;
  }>(`${API_BASE_URL}/share/file`, {
    vaultId,
    requestLocation: opts?.requestLocation ?? true,
  });
  return data;
}

export async function revokeVaultTep(vaultId: string, tepCode: string, reason?: string) {
  const { data } = await api.post<{ success: boolean; status: string; message: string }>(
    `${API_BASE_URL}/vault/${vaultId}/tep/${encodeURIComponent(tepCode)}/revoke`,
    { reason },
  );
  return data;
}

export interface VaultTrackingDashboard {
  vaultId: string;
  dnaRecordId: string;
  filename: string;
  status: string;
  owner?: { shortId?: string; fullName?: string } | null;
  tepPackages: Array<{
    tepCode: string;
    status: string;
    createdAt: string;
    expiresAt: string | null;
    geoCountry?: string | null;
    geoCity?: string | null;
    recipientId?: string | null;
  }>;
  downloads: Array<{
    id: string;
    timestamp: string;
    summary: string;
    locationLabel?: string;
    device?: string;
    tepCode?: string;
    actorLabel?: string;
    country?: string;
    city?: string;
  }>;
  summary: {
    downloadCount: number;
    lastDownload?: string;
    lastProtectedExport?: string;
    countriesSeen: string[];
    devicesSeen: string[];
    tamperCount: number;
    investigationCount: number;
  };
  chainOfCustody: Array<{
    step: string;
    eventType: string;
    timestamp: string;
    summary: string;
    locationLabel?: string;
    tepCode?: string;
  }>;
  location?: {
    status: 'AVAILABLE' | 'UNAVAILABLE';
    creationLabel?: string;
    sharedLabel?: string;
    presentLabel?: string;
    lastKnownLabel?: string;
  };
}

// ─── Certificate Management (Phase 2) ────────────────────────────────────────

/** Issue (or retrieve existing) certificate for a vault record — idempotent */
export async function issueCertificate(dnaRecordId: string, vaultId: string): Promise<IssuedCertificate> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await api.post<any>(`${API_BASE_URL}/certificates`, { dnaRecordId, vaultId });
  return data.certificate;
}

/** List all issued certificates */
export async function listCertificates(): Promise<IssuedCertificate[]> {
  const { data } = await api.get<{ certificates: IssuedCertificate[] }>(`${API_BASE_URL}/certificates`);
  return data.certificates ?? [];
}

/** Verify a certificate by its certificateId */
export async function verifyCertificateApi(certificateId: string): Promise<CertVerificationResult> {
  const { data } = await api.get<CertVerificationResult>(`${API_BASE_URL}/certificates/verify/${certificateId}`);
  return data;
}

/** Revoke a certificate */
export async function revokeCertificate(certificateId: string, reason: string): Promise<IssuedCertificate> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await api.post<any>(`${API_BASE_URL}/certificates/revoke/${certificateId}`, { reason });
  return data.certificate;
}

// ─── Pinit Exchange bridge ───────────────────────────────────────────────────

export async function createExchangeListIntent(vaultId: string): Promise<{
  success: boolean;
  token: string;
  listUrl: string;
  expiresIn: string;
  asset: {
    asset_id: string;
    vault_id: string;
    dna_record_id: string;
    title: string;
    badge_tier: string;
    pinit_id: string;
  };
}> {
  const { data } = await api.post<{
    success: boolean;
    token: string;
    listUrl: string;
    expiresIn: string;
    asset: {
      asset_id: string;
      vault_id: string;
      dna_record_id: string;
      title: string;
      badge_tier: string;
      pinit_id: string;
    };
  }>(`${API_BASE_URL}/exchange/list-intent`, { vaultId });
  return data;
}

export async function getExchangeRole(): Promise<{
  success: boolean;
  pinitId: string;
  registered: boolean;
  role: string | null;
  exchange_role: string | null;
  can_list: boolean;
  can_purchase: boolean;
  unavailable?: boolean;
}> {
  const { data } = await api.get<{
    success: boolean;
    pinitId: string;
    registered: boolean;
    role: string | null;
    exchange_role: string | null;
    can_list: boolean;
    can_purchase: boolean;
    unavailable?: boolean;
  }>(`${API_BASE_URL}/exchange/role`);
  return data;
}

export async function getExchangeSellerSummary(): Promise<{
  success: boolean;
  pinitId: string;
  can_list: boolean;
  unavailable?: boolean;
  metrics: {
    total_net_revenue: number;
    sealed_sales_count: number;
    active_listings_count: number;
    listings_count: number;
    total_views: number;
    total_saves: number;
  };
}> {
  const { data } = await api.get(`${API_BASE_URL}/exchange/seller-summary`);
  return data;
}

export async function getExchangeListedAssets(): Promise<{
  success: boolean;
  unavailable?: boolean;
  listed: Array<{ vaultId: string; listingId: string; status: string }>;
}> {
  const { data } = await api.get(`${API_BASE_URL}/exchange/listed-assets`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  const listed = Array.isArray(data?.listed) ? data.listed : null;
  if (!listed) {
    throw new Error('listed-assets payload missing');
  }
  return {
    success: Boolean(data?.success),
    unavailable: Boolean(data?.unavailable),
    listed,
  };
}

export async function getExchangeConfig(): Promise<{ success: boolean; appUrl: string; apiUrl: string }> {
  const { data } = await api.get(`${API_BASE_URL}/exchange/config`);
  return data;
}

export async function createExchangeSso(): Promise<{
  success: boolean;
  token: string;
  exchangeUrl: string;
  pinitId: string;
}> {
  const { data } = await api.post<{
    success: boolean;
    token: string;
    exchangeUrl: string;
    pinitId: string;
  }>(`${API_BASE_URL}/exchange/sso`);
  return data;
}

export async function createAdminBridgeSso(): Promise<{
  success: boolean;
  token: string;
  adminUrl: string;
  expiresIn: string;
}> {
  const { data } = await api.post<{
    success: boolean;
    token: string;
    adminUrl: string;
    expiresIn: string;
  }>(`${API_BASE_URL}/admin-bridge/sso`);
  return data;
}

// ─── DNA Comparison ───────────────────────────────────────────────────────────

export async function compareDna(
  fileA: File,
  fileB: File
): Promise<ComparisonResult> {
  const form = new FormData();
  form.append('fileA', fileA);
  form.append('fileB', fileB);
  const { data } = await api.post<ComparisonResult>(`${API_BASE_URL}/dna/compare`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function autoCompareDna(file: File): Promise<any> {
  const form = new FormData();
  form.append('image', file);
  const { data } = await api.post(`${API_BASE_URL}/dna/auto-compare`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180_000,
  });
  return data;
}

export async function unifiedInvestigate(file: File): Promise<{ success: boolean; report: Record<string, unknown> }> {
  const form = new FormData();
  form.append('image', file);
  const { data } = await api.post<{ success: boolean; report: Record<string, unknown> }>(
    `${API_BASE_URL}/forensics/unified-investigate`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300_000 },
  );
  return data;
}

export interface InvestigationLiveSnapshot {
  phase: 1 | 2 | 3 | 'final';
  signatureFound: boolean;
  ownerName?: string;
  ownerPinitId?: string;
  vaultId?: string;
  dnaRecordId?: string;
  originalFilename?: string;
  confidence?: number;
  patchVotes?: number;
  orbScore?: number;
  similarityScore?: number;
  watermarkStatus?: string;
  certificateStatus?: string;
  dnaMatchPercent?: number;
  statusMessage?: string;
  deepVerificationRunning?: boolean;
}

export interface InvestigationProgressEvent {
  type: 'timeline' | 'partial' | 'phase' | 'complete' | 'error';
  stepId: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'warning' | 'failed' | 'skipped';
  detail?: string;
  elapsedMs?: number;
  snapshot?: InvestigationLiveSnapshot;
  partial?: {
    vaultId?: string;
    ownerPinitId?: string;
    ownerName?: string;
    ownershipConfidence?: number;
    candidateCount?: number;
    originalFilename?: string;
    patchVotes?: number;
    orbScore?: number;
  };
}

/** SSE streaming investigation — progressive UI updates */
export async function unifiedInvestigateStream(
  file: File,
  onProgress: (event: InvestigationProgressEvent) => void,
  options?: { admin?: boolean },
): Promise<{ success: boolean; report: Record<string, unknown> }> {
  const form = new FormData();
  form.append('image', file);
  const token = getAccessToken();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 600_000);
  const endpoint = options?.admin
    ? `${API_BASE_URL}/super-admin/unified-investigate?stream=true`
    : `${API_BASE_URL}/forensics/unified-investigate?stream=true`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: controller.signal,
    });
  } catch (e) {
    window.clearTimeout(timeoutId);
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Investigation timed out after 10 minutes — try a smaller file or retry');
    }
    throw new Error('Connection lost during investigation — ensure the backend is running (npm run dev)');
  }
  window.clearTimeout(timeoutId);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText, message: res.statusText }));
    const body = err as { message?: string; error?: string };
    throw new Error(body.message ?? body.error ?? 'Investigation failed');
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Streaming not supported');

  const decoder = new TextDecoder();
  let buffer = '';
  let finalReport: Record<string, unknown> | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6)) as InvestigationProgressEvent & { report?: Record<string, unknown> };
        if (event.type === 'complete' && event.report) {
          finalReport = event.report;
        } else if (event.type === 'error') {
          throw new Error((event as { message?: string }).message ?? 'Investigation failed');
        } else {
          onProgress(event);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  if (!finalReport) throw new Error('Investigation ended without a report');
  return { success: true, report: finalReport };
}

export interface SignedReportManifest {
  reportId: string;
  reportType: string;
  investigationId: string;
  reportHash: string;
  issuedAt: string;
  signature: string;
  verifyUrl: string;
  certificateStatus?: string;
  engineVersion: string;
  publicKeyFingerprint: string;
}

export async function signReportManifest(payload: {
  investigationId: string;
  reportType: 'INVESTIGATION' | 'DNA' | 'TIMELINE' | 'EVIDENCE_PACKAGE';
  reportHash: string;
  certificateStatus?: string;
}): Promise<SignedReportManifest | null> {
  try {
    const { data } = await api.post<{ success: boolean; manifest: SignedReportManifest }>(
      `${API_BASE_URL}/evidence/sign-manifest`,
      payload,
    );
    return data.manifest ?? null;
  } catch {
    return null;
  }
}

// ─── Dashboard Aggregation ────────────────────────────────────────────────────

import { getForensicReportCount } from '../lib/forensic-reports-storage';

export async function getDashboardStats(): Promise<DashboardStats> {
  const [dnaRecords, vaultRecords] = await Promise.all([
    listDnaRecords(),
    listVaultRecords(),
  ]);

  const completedDna = dnaRecords.filter(r => r.status === 'COMPLETE').length;
  const partialDna   = dnaRecords.filter(r => r.status === 'PARTIAL').length;

  const totalEncryptedBytes = vaultRecords.reduce(
    (sum, v) => sum + v.encryptedSizeBytes, 0
  );

  // File type breakdown — use deriveFileType so NULL records show correct type
  const typeMap: Record<string, number> = {};
  for (const r of dnaRecords) {
    const t = deriveFileType(r);
    typeMap[t] = (typeMap[t] ?? 0) + 1;
  }
  const fileTypeBreakdown = Object.entries(typeMap)
    .map(([fileType, count]) => ({ fileType, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalDnaRecords:    dnaRecords.length,
    totalVaultRecords:  vaultRecords.length,
    totalVerifications: getForensicReportCount(),
    completedDna,
    partialDna,
    totalEncryptedBytes,
    fileTypeBreakdown,
    recentActivity: dnaRecords.slice(0, 8),
    vaultRecords,
  };
}
