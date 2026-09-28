/**
 * Face login verifies a CLAIMED account and the client supplies the face vector, so
 * without a per-account failure limit the vector could be guessed or iterated
 * indefinitely (the only cap was 30 requests / 15 min per IP). LoginThrottle limits
 * failures per (claim + IP) and per claim, keyed on the claim as typed so unknown IDs
 * behave exactly like real ones.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { LoginThrottle } from '../../src/services/auth/login-throttle.service';

const MIN = 60_000;

function make(over: Partial<ConstructorParameters<typeof LoginThrottle>[0]> = {}) {
  let t = 1_000_000;
  const throttle = new LoginThrottle({
    maxFailuresPerIp: 3, maxFailuresPerAccount: 6, windowMs: 15 * MIN, lockMs: 15 * MIN, maxKeys: 100,
    now: () => t, ...over,
  });
  return { throttle, advance: (ms: number) => { t += ms; } };
}

describe('LoginThrottle', () => {
  test('locks a client after its per-IP failure limit, with a retry time', () => {
    const { throttle } = make();
    for (let i = 0; i < 2; i++) throttle.recordFailure('PIN123', '1.1.1.1');
    expect(throttle.check('PIN123', '1.1.1.1').locked).toBe(false);
    throttle.recordFailure('PIN123', '1.1.1.1');
    const s = throttle.check('PIN123', '1.1.1.1');
    expect(s.locked).toBe(true);
    if (s.locked) expect(s.retryAfterMs).toBe(15 * MIN);
  });

  test('one IP being locked does not lock the real owner on another IP', () => {
    const { throttle } = make();
    for (let i = 0; i < 3; i++) throttle.recordFailure('PIN123', '9.9.9.9'); // attacker
    expect(throttle.check('PIN123', '9.9.9.9').locked).toBe(true);
    expect(throttle.check('PIN123', '2.2.2.2').locked).toBe(false);        // owner elsewhere
  });

  test('a distributed attempt is still capped per account across IPs', () => {
    const { throttle } = make();
    for (let i = 0; i < 6; i++) throttle.recordFailure('PIN123', `10.0.0.${i}`); // one failure per IP
    expect(throttle.check('PIN123', '10.0.0.200').locked).toBe(true); // a brand-new IP is locked too
  });

  test('the lock expires', () => {
    const { throttle, advance } = make();
    for (let i = 0; i < 3; i++) throttle.recordFailure('PIN123', '1.1.1.1');
    advance(14 * MIN);
    expect(throttle.check('PIN123', '1.1.1.1').locked).toBe(true);
    advance(2 * MIN);
    expect(throttle.check('PIN123', '1.1.1.1').locked).toBe(false);
  });

  test('old failures age out of the window and do not accumulate into a lock', () => {
    const { throttle, advance } = make();
    throttle.recordFailure('PIN123', '1.1.1.1');
    throttle.recordFailure('PIN123', '1.1.1.1');
    advance(16 * MIN);
    throttle.recordFailure('PIN123', '1.1.1.1');
    expect(throttle.check('PIN123', '1.1.1.1').locked).toBe(false);
  });

  test('a successful sign-in clears the counters', () => {
    const { throttle } = make();
    throttle.recordFailure('PIN123', '1.1.1.1');
    throttle.recordFailure('PIN123', '1.1.1.1');
    throttle.recordSuccess('PIN123', '1.1.1.1');
    throttle.recordFailure('PIN123', '1.1.1.1');
    expect(throttle.check('PIN123', '1.1.1.1').locked).toBe(false);
  });

  test('claims are case- and whitespace-insensitive, so casing cannot dodge the limit', () => {
    const { throttle } = make();
    throttle.recordFailure('pin123', '1.1.1.1');
    throttle.recordFailure(' PIN123 ', '1.1.1.1');
    throttle.recordFailure('Pin123', '1.1.1.1');
    expect(throttle.check('PIN123', '1.1.1.1').locked).toBe(true);
  });

  test('unknown IDs lock exactly like real ones (no account enumeration via lock-outs)', () => {
    const { throttle } = make();
    for (let i = 0; i < 3; i++) throttle.recordFailure('DOES-NOT-EXIST', '1.1.1.1');
    expect(throttle.check('DOES-NOT-EXIST', '1.1.1.1').locked).toBe(true);
  });

  test('tracked keys are bounded', () => {
    const { throttle } = make({ maxKeys: 50 });
    for (let i = 0; i < 500; i++) throttle.recordFailure(`PIN${i}`, '1.1.1.1');
    expect(throttle.size()).toBeLessThanOrEqual(50);
  });
});

// ── wiring into biometricAuthService.login ────────────────────────────────────

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const logSecurityEvent = jest.fn<AnyAsync>();

describe('biometricAuthService.login uses the throttle', () => {
  beforeEach(() => { jest.resetModules(); logSecurityEvent.mockReset(); logSecurityEvent.mockResolvedValue(undefined); });

  test('after repeated failures for a claimed ID the next attempt is refused WITHOUT running verification', async () => {
    jest.doMock('../../src/lib/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
    jest.doMock('../../src/lib/prisma', () => ({ prisma: {} }));
    jest.doMock('../../src/services/auth/biometric-audit.service', () => ({ logSecurityEvent, logLoginHistory: jest.fn() }));
    const { biometricAuthService } = await import('../../src/services/auth/biometric-auth.service');
    const { loginThrottle } = await import('../../src/services/auth/login-throttle.service');

    const verify = jest.spyOn(biometricAuthService, 'loginUnthrottled').mockResolvedValue({
      ok: false, matched: false, message: 'Could not verify this face for the claimed account.',
    } as never);

    const input = { faceEmbedding: [], claimedShortId: 'PINX1', ip: '5.5.5.5' };
    for (let i = 0; i < 5; i++) await biometricAuthService.login(input);   // 5 failures (default per-IP limit)
    expect(verify).toHaveBeenCalledTimes(5);

    const refused = await biometricAuthService.login(input);
    expect(verify).toHaveBeenCalledTimes(5);            // NOT called again — verification skipped
    expect(refused.ok).toBe(false);
    expect((refused as { message: string }).message).toMatch(/too many/i);
    expect(logSecurityEvent).toHaveBeenCalledWith('FACE_LOGIN_FAILED', expect.objectContaining({
      detail: expect.objectContaining({ reason: 'throttled' }),
    }));

    // a different client for the same account is not blocked by this IP's lock
    await biometricAuthService.login({ ...input, ip: '6.6.6.6' });
    expect(verify).toHaveBeenCalledTimes(6);
    void loginThrottle;
  });

  test('a successful login resets the failure count', async () => {
    jest.doMock('../../src/lib/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
    jest.doMock('../../src/lib/prisma', () => ({ prisma: {} }));
    jest.doMock('../../src/services/auth/biometric-audit.service', () => ({ logSecurityEvent, logLoginHistory: jest.fn() }));
    const { biometricAuthService } = await import('../../src/services/auth/biometric-auth.service');

    const verify = jest.spyOn(biometricAuthService, 'loginUnthrottled');
    const input = { faceEmbedding: [], claimedShortId: 'PINY2', ip: '7.7.7.7' };
    verify.mockResolvedValue({ ok: false, matched: false, message: 'no' } as never);
    for (let i = 0; i < 4; i++) await biometricAuthService.login(input);
    verify.mockResolvedValueOnce({ ok: true } as never);
    await biometricAuthService.login(input);                       // success clears the counters
    verify.mockResolvedValue({ ok: false, matched: false, message: 'no' } as never);
    for (let i = 0; i < 4; i++) await biometricAuthService.login(input);
    expect(verify).toHaveBeenCalledTimes(9);                      // none of those 9 were refused
  });

  test('a request with no claim at all is not throttled (it is denied by the normal path)', async () => {
    jest.doMock('../../src/lib/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
    jest.doMock('../../src/lib/prisma', () => ({ prisma: {} }));
    jest.doMock('../../src/services/auth/biometric-audit.service', () => ({ logSecurityEvent, logLoginHistory: jest.fn() }));
    const { biometricAuthService } = await import('../../src/services/auth/biometric-auth.service');
    const verify = jest.spyOn(biometricAuthService, 'loginUnthrottled').mockResolvedValue({ ok: false, matched: false, message: 'x' } as never);
    for (let i = 0; i < 12; i++) await biometricAuthService.login({ faceEmbedding: [], ip: '8.8.8.8' });
    expect(verify).toHaveBeenCalledTimes(12);
  });
});
