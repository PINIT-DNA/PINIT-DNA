import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';

const BASE = `${API_BASE_URL}/auth/face`;

export interface FaceAuthResponse {
  success: boolean;
  matched?: boolean;
  message?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: { id: string; shortId: string; fullName: string; role?: string };
  token?: string;
  nonce?: string;
  actions?: Array<'yaw_left' | 'yaw_right' | 'pitch_down'>;
  expiresAt?: number;
  instructions?: Record<string, string>;
}

async function postFace(path: string, body: unknown): Promise<{ status: number; data: FaceAuthResponse }> {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await axios.post(`${BASE}${path}`, body, { timeout: 70000 });
      return { status: res.status, data: res.data as FaceAuthResponse };
    } catch (e: unknown) {
      lastErr = e;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (e as any)?.response?.status as number | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (e as any)?.response?.data as FaceAuthResponse | undefined;
      if (data) return { status: status ?? 500, data };
      const retryable = status === undefined || status >= 500;
      if (!retryable || i === 3) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function registerFaceIdentity(payload: {
  embedding: number[];
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
}): Promise<FaceAuthResponse> {
  const { data } = await postFace('/login', payload);
  if (data.success !== true || data.matched === false) {
    throw new Error(data.message ?? 'Could not verify this face for the claimed account.');
  }
  if (!data.accessToken) throw new Error('Login failed. Please try again.');
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

export async function requestFaceChallenge(): Promise<FaceChallenge> {
  const { status, data } = await postFace('/challenge', {});
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
