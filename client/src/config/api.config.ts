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
const RENDER_BACKEND = 'https://pinit-dna-backend.onrender.com/api/v1';
// Use || not ?? so empty string also falls back to the hardcoded Render URL
const _raw = (_env['VITE_API_BASE_URL'] ?? '').trim().replace(/\/$/, '');
// In dev mode (no env var), use '/api/v1' so the Vite proxy forwards to localhost:4000
// In production, fall back to the hardcoded Render backend URL
export const API_BASE_URL: string = _raw || (_env['PROD'] ? RENDER_BACKEND : '/api/v1');
