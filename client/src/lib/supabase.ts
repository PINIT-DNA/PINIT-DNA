/**
 * PINIT — Supabase browser client
 *
 * Uses the public anon key (safe to ship in the bundle; access is governed by
 * Row Level Security). Reads config from Vite env vars so the same build can be
 * pointed at a different project without code changes.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _env = (import.meta as any).env as Record<string, string | undefined>;

const SUPABASE_URL =
  (_env['VITE_SUPABASE_URL'] ?? 'https://kqdqmimdqecensurjplh.supabase.co').trim();

const SUPABASE_ANON_KEY = (
  _env['VITE_SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxZHFtaW1kcWVjZW5zdXJqcGxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTQ4NTEsImV4cCI6MjA5NzA5MDg1MX0.yKoRKKuNHdsSVLEob4ZJDbsZ9Mi-b_rZoViMwq-IBGY'
).trim();

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'pinit_supabase_session',
  },
});

export const SUPABASE_PROJECT_URL = SUPABASE_URL;
