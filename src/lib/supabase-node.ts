/**
 * Supabase JS always constructs a Realtime client. Node 20 has no global
 * WebSocket, so createClient() throws before Storage can run.
 * Pin Hub Render to Node 20 (RAM); polyfill with `ws`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

function ensureNodeWebSocket(): void {
  const g = globalThis as unknown as { WebSocket?: unknown };
  if (typeof g.WebSocket === 'undefined') {
    g.WebSocket = WebSocket;
  }
}

export function createSupabaseNodeClient(url: string, key: string): SupabaseClient {
  ensureNodeWebSocket();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
