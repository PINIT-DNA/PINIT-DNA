/**
 * PAD decision tests. These use synthetic patches/samples — not a webcam.
 * They do not certify ISO 30107 spoof resistance.
 */
import {
  evaluatePad,
  issuePadChallenge,
  parsePadChallenge,
  consumePadEvidence,
  padDenyMessage,
  PAD_PATCH_SIZE,
  PAD_LIMITS,
  type PadAction,
  type PadEvidence,
  type IssuedPadChallenge,
} from '../../src/services/auth/face-liveness.service';

function makePatch(frame: number): string {
  const n = PAD_PATCH_SIZE * PAD_PATCH_SIZE;
  const buf = Buffer.alloc(n);
  for (let y = 0; y < PAD_PATCH_SIZE; y++) {
    for (let x = 0; x < PAD_PATCH_SIZE; x++) {
      buf[y * PAD_PATCH_SIZE + x] = ((x + y + frame) % 2 === 0) ? 42 : 210;
    }
  }
  return buf.toString('base64');
}

function poseFor(action: PadAction): { yaw: number; pitch: number } {
  if (action === 'yaw_left') return { yaw: -0.22, pitch: 0.02 };
  if (action === 'yaw_right') return { yaw: 0.22, pitch: 0.02 };
  return { yaw: 0.02, pitch: 0.16 };
}

function liveEvidence(challenge: IssuedPadChallenge, opts?: {
  faceCount?: number;
  boxRatio?: number;
  brightness?: number;
  staticPatches?: boolean;
  skipChallenge?: boolean;
}): PadEvidence {
  const samples: NonNullable<PadEvidence['samples']> = [];
  const patches: string[] = [];
  const a0 = challenge.actions[0]!;
  const a1 = challenge.actions[1]!;
  for (let i = 0; i < 12; i++) {
    let yaw = 0.01;
    let pitch = 0.01;
    if (!opts?.skipChallenge) {
      if (i >= 3 && i < 7) ({ yaw, pitch } = poseFor(a0));
      if (i >= 7) ({ yaw, pitch } = poseFor(a1));
    }
    samples.push({
      t: i * 200,
      yaw,
      pitch,
      faceCount: opts?.faceCount ?? 1,
      boxRatio: opts?.boxRatio ?? 0.22,
      brightness: opts?.brightness ?? 120,
    });
    patches.push(makePatch(opts?.staticPatches ? 0 : i));
  }
  return { challengeToken: '', samples, patches };
}

describe('face PAD / liveness', () => {
  it('issues an HMAC challenge with two unpredictable actions', () => {
    const a = issuePadChallenge();
    const b = issuePadChallenge();
    expect(a.challenge.actions).toHaveLength(2);
    expect(parsePadChallenge(a.token)?.jti).toBe(a.challenge.jti);
    expect(parsePadChallenge(`${a.token}x`)).toBeNull();
    expect(a.challenge.jti).not.toBe(b.challenge.jti);
  });

  it('real live-like session → LIVE', () => {
    const { challenge } = issuePadChallenge();
    const ev = liveEvidence(challenge);
    const result = evaluatePad(challenge, ev);
    expect(result.verdict).toBe('LIVE');
    expect(result.scores.challengeOk).toBe(true);
    expect(result.scores.motion).toBeGreaterThan(PAD_LIMITS.minLiveMotion);
  });

  it('printed photograph (static frames) → SPOOF', () => {
    const { challenge } = issuePadChallenge();
    const ev = liveEvidence(challenge, { staticPatches: true, skipChallenge: true });
    const result = evaluatePad(challenge, ev);
    expect(result.verdict).toBe('SPOOF');
    expect(result.reasons).toContain('static_presentation');
  });

  it('phone-screen photograph (near-static recapture) → SPOOF', () => {
    const { challenge } = issuePadChallenge();
    const ev = liveEvidence(challenge, { staticPatches: true });
    const result = evaluatePad(challenge, ev);
    expect(result.verdict).toBe('SPOOF');
  });

  it('replayed video against a new challenge is not LIVE', () => {
    const a = issuePadChallenge();
    const ev = liveEvidence(a.challenge);
    let b = issuePadChallenge();
    for (let i = 0; i < 24 && b.challenge.actions.join() === a.challenge.actions.join(); i++) {
      b = issuePadChallenge();
    }
    if (b.challenge.actions.join() === a.challenge.actions.join()) return;
    expect(evaluatePad(b.challenge, ev).verdict).not.toBe('LIVE');
  });

  it('replayed capture of the same challenge → SPOOF on second consume', async () => {
    const issued = issuePadChallenge();
    const ev: PadEvidence = {
      ...liveEvidence(issued.challenge),
      challengeToken: issued.token,
    };
    const first = await consumePadEvidence(ev);
    expect(first.verdict).toBe('LIVE');
    const second = await consumePadEvidence(ev);
    expect(second.verdict).toBe('SPOOF');
    expect(second.reasons).toContain('replay_detected');
  });

  it('no face → UNKNOWN (deny / retry)', () => {
    const { challenge } = issuePadChallenge();
    const result = evaluatePad(challenge, liveEvidence(challenge, { faceCount: 0 }));
    expect(result.verdict).toBe('UNKNOWN');
    expect(result.reasons).toContain('no_face');
  });

  it('multiple faces → UNKNOWN', () => {
    const { challenge } = issuePadChallenge();
    const result = evaluatePad(challenge, liveEvidence(challenge, { faceCount: 2 }));
    expect(result.verdict).toBe('UNKNOWN');
    expect(result.reasons).toContain('multiple_faces');
  });

  it('poor quality (too dark / too small) → UNKNOWN', () => {
    const { challenge } = issuePadChallenge();
    expect(evaluatePad(challenge, liveEvidence(challenge, { brightness: 8 })).verdict).toBe('UNKNOWN');
    expect(evaluatePad(challenge, liveEvidence(challenge, { boxRatio: 0.01 })).verdict).toBe('UNKNOWN');
  });

  it('missing challenge or patches is never LIVE', () => {
    expect(evaluatePad(null, null).verdict).toBe('UNKNOWN');
    const { challenge } = issuePadChallenge();
    expect(evaluatePad(challenge, { samples: [], patches: [] }).verdict).toBe('UNKNOWN');
  });

  it('incomplete challenge (no required head motion) → UNKNOWN, not LIVE', () => {
    const { challenge } = issuePadChallenge();
    const result = evaluatePad(challenge, liveEvidence(challenge, { skipChallenge: true }));
    expect(result.verdict).not.toBe('LIVE');
  });

  it('padDenyMessage never authenticates spoof or unknown', () => {
    expect(padDenyMessage('SPOOF')).toMatch(/photos|screens/i);
    expect(padDenyMessage('UNKNOWN')).toMatch(/inconclusive|retry/i);
  });
});
