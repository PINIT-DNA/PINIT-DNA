/**
 * A face-duplicate and a voice-duplicate registration failure must produce
 * byte-identical response shapes — no shortId, distance, or ambiguous flag,
 * and the same message either way, so an attacker can't tell which modality
 * collided or which account it collided with.
 *
 * register() itself needs a live Postgres transaction (the advisory lock is a
 * real SQL statement) — that's covered by the integration suite. Here we mock
 * prisma.$transaction to throw the exact typed errors register() throws
 * internally, and assert the outer catch maps both to the same response.
 */
import {
  biometricAuthService,
  DuplicateFaceError,
  DuplicateVoiceError,
} from '../../src/services/auth/biometric-auth.service';

const mockTransaction = jest.fn();
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    securityEvent: { create: jest.fn().mockResolvedValue({}) },
  },
}));

jest.mock('../../src/services/auth/face-liveness.service', () => ({
  consumePadEvidence: jest.fn().mockResolvedValue({ verdict: 'LIVE', reasons: ['ok'], scores: {} }),
  padDenyMessage: jest.fn().mockReturnValue('denied'),
}));

jest.mock('../../src/services/auth/webauthn.service', () => ({
  assertPendingPasskey: jest.fn().mockReturnValue({ ok: true }),
  attachPendingPasskey: jest.fn(),
  consumeWebAuthnSession: jest.fn(),
  isSimulatedCredentialId: jest.fn().mockReturnValue(true), // no webauthnCredentialId in this test's input
}));

jest.mock('../../src/services/auth/biometric-audit.service', () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
  logLoginHistory: jest.fn().mockResolvedValue(undefined),
}));

function validFaceEmbedding(seed: number): number[] {
  return new Array(128).fill(0).map((_, i) => Math.sin(seed * 17 + i) * 0.5);
}

describe('duplicate registration — generic response shape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('face duplicate → generic message, no shortId/distance/ambiguous leaked', async () => {
    mockTransaction.mockRejectedValue(
      new DuplicateFaceError({ shortId: 'PINIT-OTHERUSER', distance: 0.12, ambiguous: false }),
    );
    const result = await biometricAuthService.register({ faceEmbedding: validFaceEmbedding(1) });
    expect(result).toEqual({
      ok: false,
      status: 409,
      message: "You're already registered with PINIT.",
    });
    expect(Object.keys(result)).toEqual(['ok', 'status', 'message']);
  });

  it('voice duplicate → the exact same generic message and shape as a face duplicate', async () => {
    mockTransaction.mockRejectedValue(
      new DuplicateVoiceError({ shortId: 'PINIT-SOMEONEELSE', distance: 0.2, ambiguous: true }),
    );
    const result = await biometricAuthService.register({
      faceEmbedding: validFaceEmbedding(2),
      voiceFingerprint: validFaceEmbedding(3),
    });
    expect(result).toEqual({
      ok: false,
      status: 409,
      message: "You're already registered with PINIT.",
    });
    expect(Object.keys(result)).toEqual(['ok', 'status', 'message']);
  });
});
