/**
 * Minimal in-memory rate limiter.
 *
 * Deliberately dependency-free. This previously used `express-rate-limit`,
 * which resolved in local development only because Node walked up from
 * exchange/server/ into the repository root's node_modules, where the Hub
 * declares it. The Exchange service deploys from exchange/ alone, so the
 * import failed at boot on Render with ERR_MODULE_NOT_FOUND.
 *
 * A fixed-window counter is adequate here: the Exchange web service runs
 * single-instance (WEB_CONCURRENCY=1), so process-local state is the whole
 * picture. If Exchange is ever scaled to multiple instances this becomes
 * per-instance rather than global, and should move to a shared store.
 */

/**
 * @param {object}  opts
 * @param {number}  opts.windowMs how long a window lasts
 * @param {number}  opts.max      requests allowed per key per window
 * @param {string} [opts.message] body returned on limit
 */
export function rateLimit({ windowMs = 60_000, max = 120, message = 'Too many requests. Slow down.' } = {}) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const hits = new Map();
  let lastSweep = Date.now();

  function keyFor(req) {
    // Render terminates TLS upstream, so the client address arrives in
    // X-Forwarded-For. Take the first entry — the rest are proxies.
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
  }

  function sweep(now) {
    // Drop expired buckets occasionally so the map cannot grow without bound
    // under a rotating-IP scraper.
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    sweep(now);

    const key = keyFor(req);
    let bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.set({
      'RateLimit-Limit': String(max),
      'RateLimit-Remaining': String(remaining),
      'RateLimit-Reset': String(Math.ceil((bucket.resetAt - now) / 1000)),
    });

    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

export default rateLimit;
