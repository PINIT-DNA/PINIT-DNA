/**
 * Web presentation-attack detection (PAD) for face login / register.
 *
 * Method: server-issued unpredictable pose challenge + server-side checks on
 * a short grayscale patch sequence (motion, sharpness, single-face, quality).
 *
 * This is NOT ISO 30107 certified, has no IR/depth sensor, and does not use a
 * commercial PAD SDK. High-quality video replay on a good display can still
 * succeed against RGB-only browser PAD. Blink/smile alone is not treated as LIVE.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';

export const PAD_ACTIONS = ['yaw_left', 'yaw_right', 'pitch_down'] as const;
export type PadAction = (typeof PAD_ACTIONS)[number];
export type PadVerdict = 'LIVE' | 'SPOOF' | 'UNKNOWN';

export const PAD_PATCH_SIZE = 24;
export const PAD_LIMITS = {
  /** Multi-step login (face → passkey → voice → submit) needs headroom past a short scan. */
  challengeTtlMs: 10 * 60_000,
  minSamples: 10,
  minDurationMs: 1800,
  maxDurationMs: 40_000,
  yaw: 0.14,
  pitch: 0.10,
  minBoxRatio: 0.08,
  maxBoxRatio: 0.72,
  minBrightness: 38,
  maxBrightness: 230,
  /** Mean abs pixel delta / 255. Still photos sit near 0. */
  minLiveMotion: 0.028,
  staticMotion: 0.012,
  minSharpness: 18,
  yawThreshold: 0.14,
  pitchThreshold: 0.10,
};

export interface PadSample {
  t: number;
  yaw: number;
  pitch: number;
  faceCount: number;
  boxRatio: number;
  brightness: number;
}

export interface PadEvidence {
  challengeToken?: string;
  samples?: PadSample[];
  patches?: string[];
}

export interface IssuedPadChallenge {
  v: 1;
  jti: string;
  nonce: string;
  actions: PadAction[];
  iat: number;
  exp: number;
}

export interface PadEvaluation {
  verdict: PadVerdict;
  reasons: string[];
  scores: {
    motion: number;
    sharpness: number;
    durationMs: number;
    sampleCount: number;
    challengeOk: boolean;
  };
  jti?: string;
}

const HMAC_KEY = crypto.createHash('sha256').update(`pad:${config.biometric.encryptionKey}`).digest();
const usedJti = new Map<string, number>();

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function signPayload(payload: IssuedPadChallenge): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const mac = b64url(crypto.createHmac('sha256', HMAC_KEY).update(body).digest());
  return `${body}.${mac}`;
}

export function parsePadChallenge(token: string | undefined): IssuedPadChallenge | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = b64url(crypto.createHmac('sha256', HMAC_KEY).update(parts[0]).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as IssuedPadChallenge;
    if (parsed?.v !== 1 || !parsed.jti || !Array.isArray(parsed.actions) || parsed.actions.length < 2) {
      return null;
    }
    if (!parsed.actions.every((a) => (PAD_ACTIONS as readonly string[]).includes(a))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function issuePadChallenge(): { token: string; challenge: IssuedPadChallenge; instructions: Record<PadAction, string> } {
  const pool = [...PAD_ACTIONS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  const now = Date.now();
  const challenge: IssuedPadChallenge = {
    v: 1,
    jti: crypto.randomUUID(),
    nonce: crypto.randomBytes(16).toString('hex'),
    actions: pool.slice(0, 2) as PadAction[],
    iat: now,
    exp: now + PAD_LIMITS.challengeTtlMs,
  };
  return {
    token: signPayload(challenge),
    challenge,
    instructions: {
      yaw_left: 'Turn your head left, then face the camera',
      yaw_right: 'Turn your head right, then face the camera',
      pitch_down: 'Look down, then look back at the camera',
    },
  };
}

export function decodePadPatch(b64: string): Uint8Array | null {
  if (typeof b64 !== 'string' || b64.length < 8 || b64.length > 2048) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== PAD_PATCH_SIZE * PAD_PATCH_SIZE) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i]! - b[i]!);
  return n ? sum / n / 255 : 0;
}

function sharpnessScore(patch: Uint8Array): number {
  const w = PAD_PATCH_SIZE;
  let acc = 0;
  let n = 0;
  for (let y = 1; y < w - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = Math.abs(
        4 * patch[i]! - patch[i - 1]! - patch[i + 1]! - patch[i - w]! - patch[i + w]!,
      );
      acc += lap;
      n++;
    }
  }
  return n ? acc / n : 0;
}

/**
 * Video is unmirrored (raw camera feed, no CSS flip) — turning the head to the
 * subject's own left shifts the nose toward larger x (screen-right) in that feed,
 * the same reason your right hand appears on the left side of an unmirrored call.
 */
function poseHit(action: PadAction, yaw: number, pitch: number): boolean {
  if (action === 'yaw_left') return yaw >= PAD_LIMITS.yaw;
  if (action === 'yaw_right') return yaw <= -PAD_LIMITS.yaw;
  return pitch >= PAD_LIMITS.pitch;
}

function challengeSequenceOk(actions: PadAction[], samples: PadSample[]): boolean {
  let idx = 0;
  for (const s of samples) {
    const action = actions[idx];
    if (!action) break;
    if (poseHit(action, s.yaw, s.pitch)) idx += 1;
  }
  return idx >= actions.length;
}

/**
 * Authoritative PAD decision. Client "livenessPassed" is ignored.
 * Missing patches or challenge → UNKNOWN (never LIVE).
 */
export function evaluatePad(challenge: IssuedPadChallenge | null, evidence: PadEvidence | null | undefined): PadEvaluation {
  const reasons: string[] = [];
  const emptyScores = { motion: 0, sharpness: 0, durationMs: 0, sampleCount: 0, challengeOk: false };

  if (!challenge) {
    return { verdict: 'UNKNOWN', reasons: ['missing_or_invalid_challenge'], scores: emptyScores };
  }

  const now = Date.now();
  if (now > challenge.exp) {
    return { verdict: 'UNKNOWN', reasons: ['challenge_expired'], scores: emptyScores, jti: challenge.jti };
  }
  if (now + 500 < challenge.iat) {
    return { verdict: 'UNKNOWN', reasons: ['challenge_clock'], scores: emptyScores, jti: challenge.jti };
  }

  const samples = Array.isArray(evidence?.samples) ? evidence!.samples! : [];
  const patchesRaw = Array.isArray(evidence?.patches) ? evidence!.patches! : [];
  const patches = patchesRaw.map(decodePadPatch);
  if (samples.length < PAD_LIMITS.minSamples || patches.some((p) => !p) || patches.length < PAD_LIMITS.minSamples) {
    return {
      verdict: 'UNKNOWN',
      reasons: ['insufficient_samples'],
      scores: { ...emptyScores, sampleCount: samples.length },
      jti: challenge.jti,
    };
  }

  const times = samples.map((s) => s.t);
  const durationMs = Math.max(0, (times[times.length - 1] ?? 0) - (times[0] ?? 0));
  if (durationMs < PAD_LIMITS.minDurationMs || durationMs > PAD_LIMITS.maxDurationMs) {
    return {
      verdict: 'UNKNOWN',
      reasons: ['duration_out_of_range'],
      scores: { ...emptyScores, durationMs, sampleCount: samples.length },
      jti: challenge.jti,
    };
  }
  for (let i = 1; i < times.length; i++) {
    if (!Number.isFinite(times[i]) || times[i]! < times[i - 1]!) {
      return { verdict: 'UNKNOWN', reasons: ['timestamps_invalid'], scores: emptyScores, jti: challenge.jti };
    }
  }

  let noFace = false;
  let multiFace = false;
  let poorQuality = false;
  for (const s of samples) {
    if (!Number.isFinite(s.faceCount) || s.faceCount < 1) noFace = true;
    if (s.faceCount > 1) multiFace = true;
    if (
      !Number.isFinite(s.boxRatio) || s.boxRatio < PAD_LIMITS.minBoxRatio || s.boxRatio > PAD_LIMITS.maxBoxRatio
      || !Number.isFinite(s.brightness) || s.brightness < PAD_LIMITS.minBrightness || s.brightness > PAD_LIMITS.maxBrightness
    ) {
      poorQuality = true;
    }
  }
  if (noFace) {
    return { verdict: 'UNKNOWN', reasons: ['no_face'], scores: { ...emptyScores, durationMs, sampleCount: samples.length }, jti: challenge.jti };
  }
  if (multiFace) {
    return { verdict: 'UNKNOWN', reasons: ['multiple_faces'], scores: { ...emptyScores, durationMs, sampleCount: samples.length }, jti: challenge.jti };
  }
  if (poorQuality) {
    logger.warn('[PAD] poor_quality diagnostic', {
      boxRatio: { min: Math.min(...samples.map((s) => s.boxRatio)), max: Math.max(...samples.map((s) => s.boxRatio)) },
      brightness: { min: Math.min(...samples.map((s) => s.brightness)), max: Math.max(...samples.map((s) => s.brightness)) },
      limits: {
        minBoxRatio: PAD_LIMITS.minBoxRatio, maxBoxRatio: PAD_LIMITS.maxBoxRatio,
        minBrightness: PAD_LIMITS.minBrightness, maxBrightness: PAD_LIMITS.maxBrightness,
      },
    });
    return { verdict: 'UNKNOWN', reasons: ['poor_quality'], scores: { ...emptyScores, durationMs, sampleCount: samples.length }, jti: challenge.jti };
  }

  const decoded = patches as Uint8Array[];
  let motion = 0;
  for (let i = 1; i < decoded.length; i++) motion += meanAbsDiff(decoded[i]!, decoded[i - 1]!);
  motion /= Math.max(1, decoded.length - 1);

  let sharp = 0;
  for (const p of decoded) sharp += sharpnessScore(p);
  sharp /= decoded.length;

  const challengeOk = challengeSequenceOk(challenge.actions, samples);
  const yawSpan = Math.max(...samples.map((s) => s.yaw)) - Math.min(...samples.map((s) => s.yaw));
  const pitchSpan = Math.max(...samples.map((s) => s.pitch)) - Math.min(...samples.map((s) => s.pitch));
  const claimedPoseMotion = yawSpan + pitchSpan > 0.18;

  const scores = {
    motion,
    sharpness: sharp,
    durationMs,
    sampleCount: samples.length,
    challengeOk,
  };

  if (motion <= PAD_LIMITS.staticMotion) {
    reasons.push('static_presentation');
    return { verdict: 'SPOOF', reasons, scores, jti: challenge.jti };
  }
  if (claimedPoseMotion && motion < PAD_LIMITS.minLiveMotion * 0.7) {
    reasons.push('pose_pixel_inconsistent');
    return { verdict: 'SPOOF', reasons, scores, jti: challenge.jti };
  }
  if (sharp < PAD_LIMITS.minSharpness) {
    reasons.push('low_sharpness');
    return { verdict: 'UNKNOWN', reasons, scores, jti: challenge.jti };
  }
  if (!challengeOk) {
    reasons.push('challenge_not_completed');
    return { verdict: 'UNKNOWN', reasons, scores, jti: challenge.jti };
  }
  if (motion < PAD_LIMITS.minLiveMotion) {
    reasons.push('insufficient_motion');
    return { verdict: 'UNKNOWN', reasons, scores, jti: challenge.jti };
  }

  return { verdict: 'LIVE', reasons: ['ok'], scores, jti: challenge.jti };
}

export function padDenyMessage(verdict: PadVerdict, reasons?: string[]): string {
  if (verdict === 'SPOOF') {
    return 'Liveness check failed. Use a live camera — printed photos and phone screens are not accepted.';
  }
  if (reasons?.includes('challenge_expired')) {
    return 'Liveness expired before login finished. Scan your face again on the next try, then continue without long pauses.';
  }
  return 'Liveness was inconclusive. Face the camera in good light, follow the motion prompts, and retry.';
}

async function jtiAlreadyUsed(jti: string): Promise<boolean> {
  const mem = usedJti.get(jti);
  if (mem && mem > Date.now()) return true;
  try {
    const row = await prisma.securityEvent.findFirst({
      where: {
        eventType: 'LIVENESS_CHALLENGE_USED',
        deviceId: `pad:${jti}`,
        createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
      },
      select: { id: true },
    });
    return Boolean(row);
  } catch {
    return false;
  }
}

async function markJtiUsed(jti: string, success: boolean, detail: Record<string, unknown>): Promise<void> {
  usedJti.set(jti, Date.now() + 15 * 60 * 1000);
  if (usedJti.size > 4000) {
    const now = Date.now();
    for (const [k, exp] of usedJti) {
      if (exp < now) usedJti.delete(k);
    }
  }
  try {
    await prisma.securityEvent.create({
      data: {
        eventType: 'LIVENESS_CHALLENGE_USED',
        deviceId: `pad:${jti}`,
        success,
        detail: detail as object,
      },
    });
  } catch (err) {
    logger.warn('[PAD] Could not persist used challenge id', { error: String(err) });
  }
}

/**
 * Verify PAD and consume the challenge (success or fail) so the capture cannot be replayed.
 * Only verdict LIVE may proceed to embedding match / JWT.
 */
export async function consumePadEvidence(
  evidence: PadEvidence | null | undefined,
): Promise<PadEvaluation> {
  const challenge = parsePadChallenge(evidence?.challengeToken);
  const evaluation = evaluatePad(challenge, evidence);
  const jti = evaluation.jti ?? challenge?.jti;
  if (jti) {
    if (await jtiAlreadyUsed(jti)) {
      return {
        ...evaluation,
        verdict: 'SPOOF',
        reasons: ['replay_detected'],
        jti,
      };
    }
    await markJtiUsed(jti, evaluation.verdict === 'LIVE', {
      verdict: evaluation.verdict,
      reasons: evaluation.reasons,
      scores: evaluation.scores,
    });
  }
  return evaluation;
}
