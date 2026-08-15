/**
 * PINIT — WebAuthn / passkey client.
 * Platform biometrics stay on the device. Pinit only receives a signed assertion.
 */
import { API_BASE_URL } from '../config/api.config';

export interface BiometricResult {
  ok: boolean;
  credentialId: string;
  simulated: boolean;
  webauthnSession?: string;
  passkeyPendingToken?: string;
}

function b64urlToBuf(s: string): ArrayBuffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let raw = '';
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]!);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach Hub passkey API. Keep Hub backend running on port 4000, then try again.');
  }
  let data: T & { success?: boolean; message?: string; error?: string; reason?: string };
  try {
    data = await res.json() as typeof data;
  } catch {
    throw new Error(`Passkey request failed (HTTP ${res.status}). Retry — Hub may have restarted.`);
  }
  if (!res.ok || data.success === false) {
    const msg = data.message || data.error
      || (data.reason === 'invalid_challenge' || data.reason === 'expired_challenge'
        ? 'Passkey challenge expired. Tap Try again (Hub may have restarted during the scan).'
        : `Passkey request failed (HTTP ${res.status}).`);
    throw new Error(msg);
  }
  return data;
}

function creationOptionsFromJson(options: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const user = options.user as { id: string; name: string; displayName: string };
  const challenge = options.challenge as string;
  const exclude = (options.excludeCredentials as Array<{ id: string; type?: string; transports?: string[] }> | undefined) ?? [];
  return {
    rp: options.rp as PublicKeyCredentialRpEntity,
    user: {
      id: b64urlToBuf(user.id),
      name: user.name,
      displayName: user.displayName,
    },
    challenge: b64urlToBuf(challenge),
    pubKeyCredParams: options.pubKeyCredParams as PublicKeyCredentialParameters[],
    timeout: options.timeout as number | undefined,
    authenticatorSelection: options.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
    attestation: (options.attestation as AttestationConveyancePreference | undefined) ?? 'none',
    excludeCredentials: exclude.map((c) => ({
      type: 'public-key' as const,
      id: b64urlToBuf(c.id),
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
  };
}

function requestOptionsFromJson(options: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const allow = (options.allowCredentials as Array<{ id: string; transports?: string[] }> | undefined) ?? [];
  return {
    challenge: b64urlToBuf(options.challenge as string),
    rpId: options.rpId as string | undefined,
    timeout: options.timeout as number | undefined,
    userVerification: (options.userVerification as UserVerificationRequirement | undefined) ?? 'required',
    allowCredentials: allow.map((c) => ({
      type: 'public-key' as const,
      id: b64urlToBuf(c.id),
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
  };
}

function serializeAttestation(cred: PublicKeyCredential): Record<string, unknown> {
  const att = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: 'public-key',
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufToB64url(att.clientDataJSON),
      attestationObject: bufToB64url(att.attestationObject),
      transports: typeof att.getTransports === 'function' ? att.getTransports() : [],
    },
  };
}

function serializeAssertion(cred: PublicKeyCredential): Record<string, unknown> {
  const ass = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: 'public-key',
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufToB64url(ass.clientDataJSON),
      authenticatorData: bufToB64url(ass.authenticatorData),
      signature: bufToB64url(ass.signature),
      userHandle: ass.userHandle ? bufToB64url(ass.userHandle) : null,
    },
  };
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Enroll a platform passkey. Returns a pending token until the user record exists. */
export async function registerDeviceCredential(): Promise<BiometricResult> {
  const available = await platformAuthenticatorAvailable();
  if (!available) {
    throw new Error('This device has no passkey authenticator (Windows Hello / Touch ID / device PIN).');
  }
  const start = await postJson<{ registrationId: string; options: Record<string, unknown> }>(
    '/auth/passkey/register/start',
    {},
  );
  const cred = await navigator.credentials.create({
    publicKey: creationOptionsFromJson(start.options),
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error('Passkey enrollment was cancelled.');
  const finish = await postJson<{ credentialId: string; pendingToken?: string }>(
    '/auth/passkey/register/finish',
    { registrationId: start.registrationId, credential: serializeAttestation(cred) },
  );
  return {
    ok: true,
    credentialId: finish.credentialId,
    simulated: false,
    passkeyPendingToken: finish.pendingToken,
  };
}

/** Assert an existing passkey for the claimed Pinit account. */
export async function assertDeviceCredential(claimedShortId?: string): Promise<BiometricResult> {
  const available = await platformAuthenticatorAvailable();
  if (!available) {
    throw new Error('This device has no passkey authenticator (Windows Hello / Touch ID / device PIN).');
  }
  const start = await postJson<{
    loginId: string;
    options: Record<string, unknown>;
  }>('/auth/passkey/login/start', { claimedShortId });
  const allow = (start.options.allowCredentials as unknown[] | undefined) ?? [];
  if (allow.length === 0) {
    return registerDeviceCredential();
  }
  let assertion: PublicKeyCredential | null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: requestOptionsFromJson(start.options),
    }) as PublicKeyCredential | null;
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new Error(
        'Passkey was cancelled or the Windows Hello PIN/fingerprint did not match. '
        + 'This is your device unlock PIN — not a Pinit account password. Try again.',
      );
    }
    throw e instanceof Error ? e : new Error('Passkey verification failed.');
  }
  if (!assertion) throw new Error('Passkey verification was cancelled.');
  const finish = await postJson<{ webauthnSession: string; credentialId: string }>(
    '/auth/passkey/login/finish',
    { loginId: start.loginId, credential: serializeAssertion(assertion) },
  );
  return {
    ok: true,
    credentialId: finish.credentialId,
    simulated: false,
    webauthnSession: finish.webauthnSession,
  };
}

export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && window.innerWidth < 900;
}

export async function shouldUseDeviceBiometric(): Promise<boolean> {
  return platformAuthenticatorAvailable();
}

/** Telemetry-only device hash. Not proof of authentication. */
export function deviceBoundCredentialId(deviceFingerprint: string): BiometricResult {
  const seed = deviceFingerprint.trim() || 'unknown-device';
  return { ok: false, credentialId: `telemetry_${seed.slice(0, 12)}`, simulated: true };
}
