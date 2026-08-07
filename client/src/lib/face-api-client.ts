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
  shortId?: string;
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
}): Promise<FaceAuthResponse> {
  if (!Array.isArray(payload.voiceFingerprint) || payload.voiceFingerprint.length !== 128) {
    throw new Error('Voice fingerprint missing. Go back and complete voice verification.');
  }
  if (payload.voiceFingerprint.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error('Voice fingerprint is invalid. Re-record your voice and try again.');
  }

  const { status, data } = await postFace('/register', payload);
  if (status === 409) {
    const msg = data.shortId
      ? (data.message?.includes(data.shortId)
          ? data.message
          : `This face is already registered to ${data.shortId}. Please login instead.`)
      : (data.message ?? 'This face is already registered. Please login instead.');
    throw new Error(msg);
  }
  if (status >= 400 || data.success === false) {
    const detail =
      data.message
      || (data as { error?: string }).error
      || `Registration failed (${status}). Please try again.`;
    // Never map generic server errors to "already registered"
    throw new Error(detail === 'Internal server error'
      ? 'Registration failed on the server. Check voice/face capture and try again.'
      : detail);
  }
  if (!data.accessToken) throw new Error('Registration failed. Please try again.');
  return data;
}

export async function loginWithFace(payload: {
  embedding: number[];
  voiceFingerprint?: number[];
  webauthnCredentialId?: string;
  deviceFingerprint?: string;
}): Promise<FaceAuthResponse> {
  const { data } = await postFace('/login', payload);
  if (data.success !== true || data.matched === false) {
    throw new Error(data.message ?? 'No identity found. Please register.');
  }
  if (!data.accessToken) throw new Error('Login failed. Please try again.');
  return data;
}
