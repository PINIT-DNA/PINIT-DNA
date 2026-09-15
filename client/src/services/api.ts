/**
 * PINIT-DNA — DNA generation & vault API (authenticated via dashboard api instance).
 */

import { api, formatApiError } from './dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import type { GenerateDnaResponse } from '../types';

/** DNA generate should finish in seconds; avoid 7×180s retry loops (~21 min spinner). */
const GENERATE_TIMEOUT_MS = 90_000;
const VAULT_TIMEOUT_MS = 90_000;

/**
 * Assets have no fixed size limit, so a fixed request timeout would quietly
 * become one: a large video spends longer uploading and being processed than a
 * photo. Allow the base budget plus time proportional to the file's size.
 */
const TIMEOUT_MS_PER_MB = 3_000;
function timeoutForFile(baseMs: number, file: File): number {
  return baseMs + Math.ceil(file.size / (1024 * 1024)) * TIMEOUT_MS_PER_MB;
}

/** Vault storage refusal: the file does not fit in the owner's remaining storage. */
export type StorageLimitErrorInfo = Error & {
  isStorageLimitExceeded: true;
  fileBytes?: number;
  remainingBytes?: number;
  requiredPlan?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function storageLimitError(axiosErr: any): StorageLimitErrorInfo | null {
  const body = axiosErr?.response?.data;
  if (axiosErr?.response?.status !== 403 || body?.code !== 'STORAGE_LIMIT_EXCEEDED') return null;
  const e = new Error(
    body.error ?? 'Not enough Vault storage. Upgrade your storage to protect this asset.',
  ) as StorageLimitErrorInfo;
  e.isStorageLimitExceeded = true;
  e.fileBytes = body.fileBytes;
  e.remainingBytes = body.remainingBytes;
  e.requiredPlan = body.requiredPlan;
  return e;
}
const COLD_START_RETRIES = 2;
const COLD_START_GAP_MS = 4_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRetryable(err: any): boolean {
  if (err?.response?.status === 409 || err?.response?.status === 401) return false;
  // Timeout already waited full budget — do not retry (was causing ~20 min hangs)
  if (err?.code === 'ECONNABORTED') return false;
  const status = err?.response?.status;
  if (status && status < 500) return false;
  return !status || status >= 500 || err?.code === 'ERR_NETWORK';
}

async function postMultipart<T>(url: string, form: FormData, timeoutMs: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < COLD_START_RETRIES; attempt++) {
    try {
      const { data } = await api.post<T>(url, form, { timeout: timeoutMs });
      return data;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt >= COLD_START_RETRIES - 1) throw err;
      await new Promise((r) => setTimeout(r, COLD_START_GAP_MS));
    }
  }
  throw lastErr;
}

/**
 * Upload a file and generate its DNA fingerprint.
 * POST /api/v1/dna/generate
 */
export async function generateDna(
  file: File,
  options?: { locationShared?: boolean; latitude?: number; longitude?: number },
): Promise<GenerateDnaResponse> {
  const form = new FormData();
  form.append('image', file);
  if (options?.locationShared && options.latitude != null && options.longitude != null) {
    form.append('locationShared', 'true');
    form.append('gpsLat', String(options.latitude));
    form.append('gpsLng', String(options.longitude));
  }

  try {
    return await postMultipart<GenerateDnaResponse>(
      `${API_BASE_URL}/dna/generate`,
      form,
      timeoutForFile(GENERATE_TIMEOUT_MS, file),
    );
  } catch (err: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axiosErr = err as any;
    if (axiosErr?.code === 'ECONNABORTED') {
      throw new Error(
        'DNA generation timed out. Ensure the backend is running (`npm run dev:all`) and try again.',
      );
    }
    const storageErr = storageLimitError(axiosErr);
    if (storageErr) throw storageErr;
    if (axiosErr?.response?.status === 409) {
      const body = axiosErr.response.data ?? {};
      const dupErr = new Error(body.error ?? 'Duplicate file') as Error & {
        isDuplicate: boolean;
        existingRecordId?: string;
        existingFilename?: string;
        matchType?: string;
        riskLevel?: string;
        ownerShortId?: string;
      };
      dupErr.isDuplicate = true;
      dupErr.existingRecordId = body.existingRecordId;
      dupErr.existingFilename = body.existingFilename;
      dupErr.matchType = body.matchType;
      dupErr.riskLevel = body.riskLevel;
      dupErr.ownerShortId = body.ownerShortId;
      throw dupErr;
    }
    throw new Error(formatApiError(err));
  }
}

export async function getDnaRecord(id: string) {
  const { data } = await api.get(`${API_BASE_URL}/dna/${id}`);
  return data;
}

export async function storeInVault(
  file: File,
  dnaRecordId: string,
  options?: { locationShared?: boolean; latitude?: number; longitude?: number; campaignId?: string },
) {
  const form = new FormData();
  form.append('image', file);
  form.append('dnaRecordId', dnaRecordId);
  if (options?.locationShared && options.latitude != null && options.longitude != null) {
    form.append('locationShared', 'true');
    form.append('gpsLat', String(options.latitude));
    form.append('gpsLng', String(options.longitude));
  }
  if (options?.campaignId) {
    form.append('campaignId', options.campaignId);
  }

  try {
    return await postMultipart(`${API_BASE_URL}/vault/store`, form, timeoutForFile(VAULT_TIMEOUT_MS, file));
  } catch (err: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axiosErr = err as any;
    const storageErr = storageLimitError(axiosErr);
    if (storageErr) throw storageErr;
    if (axiosErr?.response?.status === 403) {
      const body = axiosErr.response.data ?? {};
      if (body.code === 'ASSET_QUOTA_EXCEEDED') {
        const quotaErr = new Error(body.error ?? 'Protected asset limit reached') as Error & {
          isAssetQuotaExceeded: boolean;
          requiredPlan?: string;
        };
        quotaErr.isAssetQuotaExceeded = true;
        quotaErr.requiredPlan = body.requiredPlan;
        throw quotaErr;
      }
    }
    throw err;
  }
}

export async function getVaultRecord(vaultId: string) {
  const { data } = await api.get(`${API_BASE_URL}/vault/${vaultId}`);
  return data;
}
