/**
 * PINIT-DNA — Centralised API Base URL
 *
 * Priority:
 *   1. VITE_API_BASE_URL env var  (set for ngrok / production)
 *   2. '/api/v1'                  (default — uses Vite proxy for local dev)
 *
 * DO NOT import axios here. Only export the base URL string.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _env = (import.meta as any).env as Record<string, string | undefined>;
const RENDER_BACKEND = 'https://pinit-dna-uf5y.onrender.com/api/v1';
// Use || not ?? so empty string also falls back to the hardcoded Render URL
const _raw = (_env['VITE_API_BASE_URL'] ?? '').trim().replace(/\/$/, '');
// Web dev → Vite proxy to localhost:4000. Production build → Render backend.
export const API_BASE_URL: string =
  _raw || (_env['PROD'] ? RENDER_BACKEND : '/api/v1');
