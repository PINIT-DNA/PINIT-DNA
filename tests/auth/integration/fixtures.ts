/**
 * Shared fixtures for the biometric-auth integration suite — a fresh valid
 * (LIVE-verdict) PAD evidence object, a deterministic fake face/voice embedding,
 * and a signed pending-passkey token. Mirrors the helpers in
 * tests/auth/face-liveness-pad.test.ts (PAD) and tests/auth/face-match-gate.test.ts
 * (embeddings), reused here so integration calls to register()/login() don't have
 * to hand-construct these.
 */
import { issuePadChallenge, PAD_PATCH_SIZE, type PadAction } from '../../../src/services/auth/face-liveness.service';
import { mintPendingPasskeyToken } from '../../../src/services/auth/webauthn.service';

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
  if (action === 'yaw_left') return { yaw: 0.22, pitch: 0.02 };
  if (action === 'yaw_right') return { yaw: -0.22, pitch: 0.02 };
  return { yaw: 0.02, pitch: 0.16 };
}

/** A fresh, valid (LIVE-verdict) PAD evidence object. Each challenge is single-use
 * (replay-protected), so call this again for every register()/login() attempt. */
export function freshLivePadEvidence() {
  const issued = issuePadChallenge();
  const a0 = issued.challenge.actions[0]!;
  const a1 = issued.challenge.actions[1]!;
  const samples: Array<{ t: number; yaw: number; pitch: number; faceCount: number; boxRatio: number; brightness: number }> = [];
  const patches: string[] = [];
  for (let i = 0; i < 12; i++) {
    let yaw = 0.01;
    let pitch = 0.01;
    if (i >= 3 && i < 7) ({ yaw, pitch } = poseFor(a0));
    if (i >= 7) ({ yaw, pitch } = poseFor(a1));
    samples.push({ t: i * 200, yaw, pitch, faceCount: 1, boxRatio: 0.22, brightness: 120 });
    patches.push(makePatch(i));
  }
  return { challengeToken: issued.token, samples, patches };
}

/** Deterministic 128-d embedding for a given seed — same seed = same "person". */
export function fakeEmbedding(seed: number): number[] {
  return new Array(128).fill(0).map((_, i) => Math.sin(seed * 17 + i) * 0.5);
}

/** A near-identical capture of the same "person" — small jitter, still the same face. */
export function fakeEmbeddingNearDuplicate(seed: number): number[] {
  return fakeEmbedding(seed).map((v, i) => v + (i % 7 === 0 ? 0.002 : 0));
}

export function freshPasskeyToken(credentialId: string): string {
  return mintPendingPasskeyToken({ credentialId });
}
