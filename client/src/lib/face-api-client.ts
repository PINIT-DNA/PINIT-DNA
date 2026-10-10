import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';
import { logFaceTiming } from './face-capture';

const BASE = `${API_BASE_URL}/auth/face`;

export interface FaceAuthResponse {
  success: boolean;
  matched?: boolean;
  message?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: { id: string; shortId: string; fullName: string; role?: string };
  /** The Pinit ID sent did not exist; the server found the account by face. */
  claimReplaced?: boolean;
  token?: string;
  nonce?: string;
  actions?: Array<'yaw_left' | 'yaw_right' | 'pitch_down'>;
  expiresAt?: number;
  instructions?: Record<string, string>;
}

async function postFace(path: string, body: unknown): Promise<{ status: number; data: FaceAuthResponse }> {
  const isLogin = path === '/login';
  // A login capture is single-use: the server rejects a resend as a replay,
  // so wait long enough for one answer instead of retrying.
  const attempts = isLogin ? 1 : 4;
  const timeout = isLogin ? 45_000 : 70_000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const attemptStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      if (isLogin) {
        console.info(`[Client:Perf] Sending /auth/face/login (attempt ${i + 1}/${attempts}, timeout ${timeout}ms)`);
      }
      const res = await axios.post(`${BASE}${path}`, body, {
        timeout,
        withCredentials: true,
      });
      if (isLogin) {
        const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - attemptStart;
        logFaceTiming('login_http_ok', ms, { attempt: i + 1 });
      }
      return { status: res.status, data: res.data as FaceAuthResponse };
    } catch (e: unknown) {
      lastErr = e;
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - attemptStart;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ax = e as any;
      const status = ax?.response?.status as number | undefined;
      const data = ax?.response?.data as FaceAuthResponse | undefined;
      if (data) return { status: status ?? 500, data };
      const timedOut =
        ax?.code === 'ECONNABORTED'
        || ax?.name === 'CanceledError'
        || ax?.code === 'ERR_CANCELED'
        || /timeout|aborted/i.test(String(ax?.message ?? ''));
      if (isLogin) {
        logFaceTiming('login_http_fail', ms, { attempt: i + 1, timedOut: Boolean(timedOut), status: status ?? 0 });
      }
      const retryable = status === undefined || status >= 500;
      if (!retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax = lastErr as any;
  const timedOut = ax?.code === 'ECONNABORTED' || /timeout/i.test(String(ax?.message ?? ''));
  if (isLogin && timedOut) {
    throw new Error('Authentication timed out. The server is taking too long to respond. Please try again.');
  }
  throw lastErr;
}

export async function beginFaceEnrollment(): Promise<{ shortId: string; enrollmentToken: string }> {
  const { status, data } = await postFace('/enroll/begin', {});
  const claim = data as FaceAuthResponse & { shortId?: string; enrollmentToken?: string };
  if (status >= 400 || claim.success === false || !claim.shortId || !claim.enrollmentToken) {
    throw new Error(claim.message ?? 'Could not reserve a Pinit ID.');
  }
  return { shortId: claim.shortId, enrollmentToken: claim.enrollmentToken };
}

export async function registerFaceIdentity(payload: {
  embedding: number[];
  samples?: Array<{ embedding: number[]; padEvidence?: FacePadEvidence }>;
  enrollmentToken?: string;
  voiceFingerprint?: number[];
  webauthnCredentialId?: string;
  deviceFingerprint?: string;
  accountType?: 'INDIVIDUAL' | 'BUSINESS';
  organizationName?: string;
  padEvidence?: FacePadEvidence;
  passkeyPendingToken?: string;
}): Promise<FaceAuthResponse> {
  const voice = payload.voiceFingerprint;
  if (voice != null) {
    if (!Array.isArray(voice) || voice.length !== 128) {
      throw new Error('Voice fingerprint is invalid. Re-record or skip voice.');
    }
    if (voice.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new Error('Voice fingerprint is invalid. Re-record or skip voice.');
    }
  }

  const { status, data } = await postFace('/register', payload);
  if (status === 409) {
    // The backend never sends which account/modality collided — surface only its
    // generic message, never construct one from response fields (account-enumeration guard).
    throw new Error(data.message ?? 'This identity is already registered. Please login instead.');
  }
  if (status >= 400 || data.success === false) {
    const detail =
      data.message
      || (data as { error?: string }).error
      || `Registration failed (${status}). Please try again.`;
    // Never map generic server errors to "already registered" or biometrics —
    // 500s are usually DB/config (e.g. unreachable DATABASE_URL).
    throw new Error(detail === 'Internal server error'
      ? 'Registration failed on the server (database/API error). Check DATABASE_URL in .env and that Supabase is reachable, then restart the backend.'
      : detail);
  }
  if (!data.accessToken) throw new Error('Registration failed. Please try again.');
  return data;
}

/** Replace the enrolled face only after this signed-in face still matches. */
export async function reenrollFace(payload: {
  embedding: number[];
  padEvidence?: FacePadEvidence;
}): Promise<void> {
  const token = localStorage.getItem('pinit_access_token');
  try {
    const res = await axios.post(`${BASE}/reenroll`, payload, {
      timeout: 70_000,
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = res.data as FaceAuthResponse;
    if (data.success === false) throw new Error(data.message ?? 'Face update failed.');
  } catch (e: unknown) {
    const data = (e as { response?: { data?: FaceAuthResponse } }).response?.data;
    if (data?.message) throw new Error(data.message);
    if (e instanceof Error) throw e;
    throw new Error('Face update failed.');
  }
}

export async function loginWithFace(payload: {
  embedding: number[];
  claimedShortId?: string;
  claimedUserId?: string;
  padEvidence?: FacePadEvidence;
  webauthnSession?: string;
  passkeyPendingToken?: string;
  voiceFingerprint?: number[];
  webauthnCredentialId?: string;
  deviceFingerprint?: string;
  lightingTelemetry?: { ambientBrightness?: number; lightingStatus?: string };
}): Promise<FaceAuthResponse> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const { data } = await postFace('/login', payload);
    logFaceTiming('login_http', (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started, {
      patchCount: payload.padEvidence?.patches?.length ?? 0,
    });
    if (data.success !== true || data.matched === false) {
      throw new Error(data.message ?? 'Could not verify this face for the claimed account.');
    }
    if (!data.accessToken) throw new Error('Login failed. Please try again.');
    return data;
  } catch (e) {
    logFaceTiming('login_http_error', (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    throw e;
  }
}

/** Thrown when 1:N identify finds no confident match — the caller shows the
 *  "Face not recognized" state rather than a generic failure. */
export class FaceNotRecognizedError extends Error {
  constructor(message = 'Face not recognized.') {
    super(message);
    this.name = 'FaceNotRecognizedError';
  }
}

/**
 * Sign in by face alone — no Pinit ID typed.
 *
 * Sends only the face and its liveness evidence: the server searches the
 * gallery and either returns a confidently identified account or refuses.
 * A refusal carries no distance and no hint about which faces are enrolled,
 * so there is nothing here to tell the two apart beyond "not recognized".
 */
export async function identifyWithFace(payload: {
  embedding: number[];
  padEvidence?: FacePadEvidence;
  deviceFingerprint?: string;
}): Promise<FaceAuthResponse> {
  const { data } = await postFace('/identify', payload);
  if (data.success !== true || data.matched === false) {
    throw new FaceNotRecognizedError(data.message ?? 'Face not recognized.');
  }
  if (!data.accessToken) throw new FaceNotRecognizedError();
  return data;
}

export interface FacePadEvidence {
  challengeToken: string;
  samples: Array<{
    t: number;
    yaw: number;
    pitch: number;
    faceCount: number;
    boxRatio: number;
    brightness: number;
  }>;
  patches: string[];
}

export interface FaceChallenge {
  token: string;
  nonce: string;
  actions: Array<'yaw_left' | 'yaw_right' | 'pitch_down'>;
  expiresAt: number;
  instructions: Record<string, string>;
}

export async function requestFaceChallenge(opts?: { mode?: 'active' | 'passive' }): Promise<FaceChallenge> {
  const { status, data } = await postFace('/challenge', opts?.mode ? { mode: opts.mode } : {});
  const body = data as FaceAuthResponse & Partial<FaceChallenge>;
  if (status >= 400 || !body.token || !Array.isArray(body.actions)) {
    throw new Error(body.message ?? 'Could not start liveness check. Try again.');
  }
  return {
    token: body.token,
    nonce: body.nonce ?? '',
    actions: body.actions,
    expiresAt: body.expiresAt ?? Date.now() + 45_000,
    instructions: body.instructions ?? {},
  };
}
