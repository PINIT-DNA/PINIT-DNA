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
}): Promise<FaceAuthResponse> {
  const { status, data } = await postFace('/register', payload);
  if (status === 409 || data.success === false) {
    throw new Error(data.message ?? 'This biometric identity already exists. Please sign in using your existing identity.');
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
