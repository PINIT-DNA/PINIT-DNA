/**
 * Fixed-window rate limiter, in process memory.
 *
 * Good enough for a single-instance deployment and for slowing down credential
 * stuffing and form spam. If this ever runs on more than one instance, swap the
 * `hits` map for Redis — the call signature is designed not to change.
 */

type Entry = { count: number; resetAt: number };

const hits = new Map<string, Entry>();

let lastSweep = 0;

function sweep(now: number) {
  // Amortised cleanup so the map cannot grow without bound.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
};

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  entry.count += 1;
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
  if (entry.count > limit) return { ok: false, remaining: 0, retryAfter };
  return { ok: true, remaining: limit - entry.count, retryAfter };
}

/** Clear a key early — used after a successful login so a good password resets the counter. */
export function resetRateLimit(key: string) {
  hits.delete(key);
}

/** Best-effort client IP from the usual proxy headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? '127.0.0.1';
}
