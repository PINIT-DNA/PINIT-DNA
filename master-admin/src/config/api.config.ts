/**
 * PinitHUB Master Admin — API base URL.
 * This app never proxies through Vite — it always talks to the full Hub API URL,
 * since it's a separate origin from Hub's own dev server.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _env = (import.meta as any).env as Record<string, string | undefined>;
const RENDER_BACKEND = 'https://pinit-dna-uf5y.onrender.com/api/v1';
const _raw = (_env['VITE_API_BASE_URL'] ?? '').trim().replace(/\/$/, '');

export const API_BASE_URL: string =
  _raw || (_env['PROD'] ? RENDER_BACKEND : 'http://localhost:4000/api/v1');
