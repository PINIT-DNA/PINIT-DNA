/**
 * PINIT-DNA — DNA generation & vault API (authenticated via dashboard api instance).
 */

import { api, formatApiError } from './dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import type { GenerateDnaResponse } from '../types';

const GENERATE_TIMEOUT_MS = 180_000;
const VAULT_TIMEOUT_MS = 120_000;
const COLD_START_RETRIES = 7;
const COLD_START_GAP_MS = 8_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRetryable(err: any): boolean {
  if (err?.response?.status === 409 || err?.response?.status === 401) return false;
  const status = err?.response?.status;
  if (status && status < 500) return false;
  return !status || status >= 500 || err?.code === 'ECONNABORTED' || err?.code === 'ERR_NETWORK';
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
      GENERATE_TIMEOUT_MS,
    );
  } catch (err: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axiosErr = err as any;
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
  options?: { locationShared?: boolean; latitude?: number; longitude?: number },
) {
  const form = new FormData();
  form.append('image', file);
  form.append('dnaRecordId', dnaRecordId);
  if (options?.locationShared && options.latitude != null && options.longitude != null) {
    form.append('locationShared', 'true');
    form.append('gpsLat', String(options.latitude));
    form.append('gpsLng', String(options.longitude));
  }

  return postMultipart(`${API_BASE_URL}/vault/store`, form, VAULT_TIMEOUT_MS);
}

export async function getVaultRecord(vaultId: string) {
  const { data } = await api.get(`${API_BASE_URL}/vault/${vaultId}`);
  return data;
}
