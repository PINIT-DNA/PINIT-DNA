/**
 * PINIT-DNA — Dashboard API Service
 * All HTTP calls for the Forensic Verification Dashboard.
 * Connects to the backend at /api/v1 via Vite proxy.
 */

import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';
import { refreshAccessToken, clearTokens } from '../lib/auth';
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

export const api = axios.create({});

// Attach JWT to every request from this instance
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pinit_access_token');
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
      config._authRetried = true;
      const newToken = await refreshAccessToken();
      if (!newToken) {
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
    const retryable = count < 6 && (
      !status || status >= 500
      || error.code === 'ECONNABORTED'
      || String(error.message ?? '').toLowerCase().includes('network')
    );
    if (retryable) {
      config._netRetryCount = count + 1;
      await new Promise((r) => setTimeout(r, 6000 + count * 2000));
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

export async function retrieveFromVault(vaultId: string): Promise<Blob> {
  const { data } = await api.post<Blob>(`${API_BASE_URL}/vault/${vaultId}/retrieve`, {}, {
    responseType: 'blob',
  });
  return data;
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

export async function protectedDownloadFromVault(
  vaultId: string,
): Promise<{ blob: Blob; tepCode?: string }> {
  const response = await api.post<Blob>(
    `${API_BASE_URL}/vault/${vaultId}/protected-download`,
    {},
    { responseType: 'blob' },
  );
  const tepCode = response.headers['x-tep-code'] as string | undefined;
  return { blob: response.data, tepCode };
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

/** Read comparison count from sessionStorage (where ComparePage stores results) */
function getStoredComparisonCount(): number {
  try {
    const raw = sessionStorage.getItem('pinit_dna_reports');
    if (!raw) return 0;
    return (JSON.parse(raw) as unknown[]).length;
  } catch {
    return 0;
  }
}

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
    totalVerifications: getStoredComparisonCount(), // ← reads from sessionStorage
    completedDna,
    partialDna,
    totalEncryptedBytes,
    fileTypeBreakdown,
    recentActivity: dnaRecords.slice(0, 8),
  };
}
