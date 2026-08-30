import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';
import { getAccessToken, clearTokens } from '../lib/auth';

export const api = axios.create({ timeout: 75_000 });

export function formatApiError(err: unknown): string {
  if (err && typeof err === 'object' && 'isAxiosError' in err && (err as { isAxiosError?: boolean }).isAxiosError) {
    const ax = err as unknown as { response?: { status?: number; data?: { error?: string } }; message: string };
    const data = ax.response?.data;
    if (typeof data?.error === 'string' && data.error) return data.error;
    if (!ax.response) {
      return 'Cannot reach the Hub API — check the backend is running.';
    }
    return ax.message;
  }
  return err instanceof Error ? err.message : 'Request failed';
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (token) (config.headers as any)['Authorization'] = `Bearer ${token}`;
  return config;
});

// No refresh-token flow here (see lib/auth.ts) — a 401 means the session is
// truly gone, so clear it and let RequireAuth redirect to the SSO gate.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      clearTokens();
    }
    return Promise.reject(error);
  },
);

export { API_BASE_URL };
