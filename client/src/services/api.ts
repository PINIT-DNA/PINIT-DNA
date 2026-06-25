/**
 * PINIT-DNA API Service
 * Connects to the backend at localhost:4000 via Vite proxy.
 */

import axios from 'axios';
import type { GenerateDnaResponse } from '../types';
import { API_BASE_URL } from '../config/api.config';

// 120s timeout — large file uploads + DNA processing can take 60-90s on free tier
const client = axios.create({ baseURL: API_BASE_URL, timeout: 120000 });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('pinit_access_token');
  if (token) config.headers = { ...config.headers, Authorization: `Bearer ${token}` } as typeof config.headers;
  return config;
});

// Handle 401 (expired token) — try to refresh, or redirect to login.
// Also retry on 5xx / network / timeout (Render free-tier cold starts ~50s).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
client.interceptors.response.use((r: any) => r, async (error: any) => {
  const config = error.config;
  const status = error.response?.status;

  // 401 = expired/invalid token → try refresh, then redirect to login
  if (status === 401 && !config._authRetried) {
    config._authRetried = true;
    try {
      const refreshToken = localStorage.getItem('pinit_refresh_token');
      if (refreshToken && refreshToken !== 'x') {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken }, { timeout: 30000 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = (data as any).data ?? data;
        if (d.accessToken) {
          localStorage.setItem('pinit_access_token', d.accessToken);
          if (d.refreshToken) localStorage.setItem('pinit_refresh_token', d.refreshToken);
          config.headers = { ...config.headers, Authorization: `Bearer ${d.accessToken}` };
          return client.request(config);
        }
      }
    } catch { /* refresh failed — fall through to redirect */ }
    // Refresh failed or no refresh token → clear session and redirect to login
    localStorage.removeItem('pinit_access_token');
    localStorage.removeItem('pinit_refresh_token');
    window.location.href = '/login';
    throw error;
  }

  // 5xx / network / timeout → retry with smart backoff
  // Only retry on actual server errors, not on slow processing
  if (!config || config._retryCount >= 3) throw error;
  const retryable = !status || status >= 500;
  if (!retryable) throw error;
  config._retryCount = (config._retryCount || 0) + 1;
  // Quick retries: 2s, 4s, 6s — total 12s, enough for a cold start wake
  await new Promise((r) => setTimeout(r, 2000 * config._retryCount));
  return client.request(config);
});

/**
 * Upload an image and generate its 10-layer DNA fingerprint.
 * Calls: POST /api/v1/dna/generate
 */
export async function generateDna(file: File): Promise<GenerateDnaResponse> {
  const form = new FormData();
  form.append('image', file);

  try {
    const { data } = await client.post<GenerateDnaResponse>('dna/generate', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  } catch (err: unknown) {
    // 409 Conflict = duplicate file — surface as a typed error with extra context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axiosErr = err as any;
    if (axiosErr?.response?.status === 409) {
      const body = axiosErr.response.data ?? {};
      const dupErr = new Error(body.error ?? 'Duplicate file detected') as Error & {
        isDuplicate: boolean;
        existingRecordId?: string;
        existingFilename?: string;
        matchType?: string;
        riskLevel?: string;
      };
      dupErr.isDuplicate        = true;
      dupErr.existingRecordId   = body.existingRecordId;
      dupErr.existingFilename   = body.existingFilename;
      dupErr.matchType          = body.matchType;
      dupErr.riskLevel          = body.riskLevel;
      throw dupErr;
    }
    throw err;
  }
}

/**
 * Get a stored DNA record.
 * Calls: GET /api/v1/dna/:id
 */
export async function getDnaRecord(id: string) {
  const { data } = await client.get(`dna/${id}`);
  return data;
}

/**
 * Encrypt image and store in vault.
 * Calls: POST /api/v1/vault/store
 */
export async function storeInVault(file: File, dnaRecordId: string) {
  const form = new FormData();
  form.append('image', file);
  form.append('dnaRecordId', dnaRecordId);

  const { data } = await client.post('vault/store', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/**
 * Get vault record metadata.
 * Calls: GET /api/v1/vault/:id
 */
export async function getVaultRecord(vaultId: string) {
  const { data } = await client.get(`vault/${vaultId}`);
  return data;
}
