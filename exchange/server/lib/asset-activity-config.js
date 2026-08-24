/**
 * Bridge connection details for the activity emitter.
 *
 * Kept separate from hub-client.js so the emitter can be unit-tested without
 * pulling in the full Hub client surface (and its jsonwebtoken dependency).
 */
export function hubApiBase() {
  return (process.env.HUB_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
}

export function bridgeSecret() {
  return process.env.EXCHANGE_BRIDGE_SECRET || process.env.HUB_BRIDGE_SECRET || '';
}
