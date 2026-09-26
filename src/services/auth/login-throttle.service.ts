/**
 * Failed-login throttle for face / passkey sign-in.
 *
 * Face login is a 1:1 check against a CLAIMED account, and the client supplies the
 * face vector itself. The endpoint already hides similarity scores so a caller cannot
 * hill-climb toward a match, but the only cap on guesses was the per-IP request
 * limiter (30 / 15 min) — nothing limited failures per ACCOUNT. This adds two limits:
 *
 *  - per (claimed account + IP): a low limit, so one client cannot keep guessing;
 *  - per claimed account across all IPs: a higher limit, so a distributed attempt is
 *    still capped without letting one stranger lock the real owner out for long.
 *
 * Keyed on the claim AS TYPED (not on whether the account exists), so unknown and real
 * IDs behave identically and lock-outs cannot be used to discover which IDs exist.
 *
 * State is in memory, per process. On a multi-instance deployment each instance
 * enforces its own counters (the effective limit is up to N times higher); a shared
 * store (Redis / DB) is the follow-up if that matters.
 */

export interface ThrottleOptions {
  maxFailuresPerIp: number;
  maxFailuresPerAccount: number;
  windowMs: number;
  lockMs: number;
  /** Bound on tracked keys so the map cannot grow without limit. */
  maxKeys: number;
  now?: () => number;
}

export type ThrottleState = { locked: false } | { locked: true; retryAfterMs: number };

interface Entry {
  failures: number[]; // timestamps within the window
  lockedUntil: number;
}

const int = (name: string, fallback: number): number => {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const defaultThrottleOptions = (): ThrottleOptions => ({
  maxFailuresPerIp: int('LOGIN_MAX_FAILURES_PER_IP', 5),
  maxFailuresPerAccount: int('LOGIN_MAX_FAILURES_PER_ACCOUNT', 20),
  windowMs: int('LOGIN_FAILURE_WINDOW_MS', 15 * 60 * 1000),
  lockMs: int('LOGIN_LOCK_MS', 15 * 60 * 1000),
  maxKeys: 50_000,
});

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly opts: ThrottleOptions;
  private readonly now: () => number;

  constructor(opts: Partial<ThrottleOptions> = {}) {
    this.opts = { ...defaultThrottleOptions(), ...opts };
    this.now = this.opts.now ?? Date.now;
  }

  private static claimKey(claim: string): string {
    return `acct:${claim.trim().toUpperCase()}`;
  }
  private static ipKey(claim: string, ip: string): string {
    return `ip:${claim.trim().toUpperCase()}|${ip}`;
  }

  private prune(e: Entry, t: number): void {
    const cutoff = t - this.opts.windowMs;
    while (e.failures.length && e.failures[0]! <= cutoff) e.failures.shift();
  }

  private stateOf(key: string, t: number): ThrottleState {
    const e = this.entries.get(key);
    if (!e) return { locked: false };
    if (e.lockedUntil > t) return { locked: true, retryAfterMs: e.lockedUntil - t };
    return { locked: false };
  }

  /** Is this claim (from this IP) currently locked out? */
  check(claim: string, ip: string): ThrottleState {
    const t = this.now();
    const a = this.stateOf(LoginThrottle.claimKey(claim), t);
    const b = this.stateOf(LoginThrottle.ipKey(claim, ip), t);
    if (a.locked && b.locked) return { locked: true, retryAfterMs: Math.max(a.retryAfterMs, b.retryAfterMs) };
    return a.locked ? a : b;
  }

  private bump(key: string, max: number, t: number): void {
    let e = this.entries.get(key);
    if (!e) {
      if (this.entries.size >= this.opts.maxKeys) {
        // Evict the oldest tracked key (Map keeps insertion order).
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      e = { failures: [], lockedUntil: 0 };
      this.entries.set(key, e);
    }
    this.prune(e, t);
    e.failures.push(t);
    if (e.failures.length >= max) {
      e.lockedUntil = t + this.opts.lockMs;
      e.failures = [];
    }
  }

  recordFailure(claim: string, ip: string): void {
    const t = this.now();
    this.bump(LoginThrottle.claimKey(claim), this.opts.maxFailuresPerAccount, t);
    this.bump(LoginThrottle.ipKey(claim, ip), this.opts.maxFailuresPerIp, t);
  }

  /** A successful sign-in clears this client's counters and the account's. */
  recordSuccess(claim: string, ip: string): void {
    this.entries.delete(LoginThrottle.claimKey(claim));
    this.entries.delete(LoginThrottle.ipKey(claim, ip));
  }

  /** Test helper. */
  size(): number {
    return this.entries.size;
  }
}

/** Process-wide instance used by biometric sign-in. */
export const loginThrottle = new LoginThrottle();
