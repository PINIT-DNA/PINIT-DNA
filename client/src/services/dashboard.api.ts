/**
 * PINIT-DNA — Dashboard API Service
 * All HTTP calls for the Forensic Verification Dashboard.
 * Connects to the backend at /api/v1 via Vite proxy.
 */

import axios from 'axios';
import type {
  DnaRecord, VaultRecord, SupportedTypesResponse,
  ComparisonResult, DashboardStats,
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

const api = axios.create({ baseURL: '/api/v1' });

// ─── DNA Records ──────────────────────────────────────────────────────────────

export async function listDnaRecords(): Promise<DnaRecord[]> {
  const { data } = await api.get('/dna');
  return data.records ?? [];
}

export async function getDnaRecord(id: string) {
  const { data } = await api.get(`/dna/${id}`);
  // API returns { success, record: { id, status, image: { filename, ... }, ... } }
  // Flatten image fields to top level for easier consumption
  const rec = data.record ?? data;
  return {
    ...rec,
    filename:  rec.filename ?? rec.image?.filename ?? rec.imageFilename ?? null,
    createdAt: rec.createdAt,
  };
}

export async function getSupportedTypes(): Promise<SupportedTypesResponse> {
  const { data } = await api.get('/dna/supported-types');
  return data;
}

// ─── Vault Records ────────────────────────────────────────────────────────────

export async function listVaultRecords(): Promise<VaultRecord[]> {
  const { data } = await api.get('/vault');
  return data.vaults ?? [];
}

export async function getVaultRecord(id: string) {
  const { data } = await api.get(`/vault/${id}`);
  // API wraps in { success, vault: {...} } — unwrap to get the vault object directly
  return data.vault ?? data;
}

export async function retrieveFromVault(vaultId: string): Promise<Blob> {
  const { data } = await api.post(`/vault/${vaultId}/retrieve`, {}, {
    responseType: 'blob',
  });
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
  const { data } = await api.post<ComparisonResult & { success: boolean }>('/dna/compare', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
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
