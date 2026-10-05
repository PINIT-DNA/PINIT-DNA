/**
 * In local development the browser talks only to the Reader (port 3010).
 * Vite forwards /api to the Hub on port 4000.
 * Set VITE_HUB_API_BASE to call a Hub address directly.
 */
export function hubApiBase(): string {
  const configured = import.meta.env.VITE_HUB_API_BASE?.trim().replace(/\/$/, '');
  if (configured) return configured;
  if (import.meta.env.DEV) return '/api/v1';
  return 'http://127.0.0.1:4000/api/v1';
}
