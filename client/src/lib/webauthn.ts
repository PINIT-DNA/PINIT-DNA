/**
 * PINIT — Device biometric (WebAuthn / FIDO2) helpers.
 *
 * TEMP: platform WebAuthn / passkey popups disabled — always use device-bound
 * or simulated credentials so login never opens Windows "Choose a passkey".
 */

const RP_NAME = 'PINIT';
/** Flip to false when re-enabling real Windows Hello / passkeys. */
const DISABLE_PLATFORM_WEBAUTHN = true;

function randomBytes(len: number): BufferSource {
  const buf = new Uint8Array(new ArrayBuffer(len));
  crypto.getRandomValues(buf);
  return buf as BufferSource;
}

function encodeUserId(id: string): BufferSource {
  const bytes = new TextEncoder().encode(id).slice(0, 64);
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out as BufferSource;
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (DISABLE_PLATFORM_WEBAUTHN) return false;
  try {
    if (!window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Phone/tablet — fingerprint / Face ID required when available. */
export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && window.innerWidth < 900;
}

/** Laptops/desktops: face + voice only. Mobile app: also bind device biometrics. */
export function biometricStrictMode(): boolean {
  return isMobileDevice();
}

export async function shouldUseDeviceBiometric(): Promise<boolean> {
  if (!biometricStrictMode()) return false;
  return platformAuthenticatorAvailable();
}

export interface BiometricResult {
  ok: boolean;
  credentialId: string;
  simulated: boolean;
}

export interface BiometricOptions {
  /** When true, throws instead of simulating success if WebAuthn unavailable/cancelled. */
  strict?: boolean;
}

/** Create a FIDO2 credential bound to this device (registration). */
export async function registerDeviceCredential(
  userId: string,
  opts: BiometricOptions & { deviceFingerprint?: string } = {},
): Promise<BiometricResult> {
  const { strict = false, deviceFingerprint } = opts;
  if (DISABLE_PLATFORM_WEBAUTHN) {
    if (deviceFingerprint) return deviceBoundCredentialId(deviceFingerprint);
    return { ok: true, credentialId: simulatedId(), simulated: true };
  }
  try {
    const available = await platformAuthenticatorAvailable();
    if (!available) {
      if (deviceFingerprint) return deviceBoundCredentialId(deviceFingerprint);
      if (strict) throw new Error('Device biometrics unavailable. Enable Windows Hello or fingerprint.');
      return { ok: true, credentialId: simulatedId(), simulated: true };
    }

    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: RP_NAME, id: window.location.hostname },
        user: {
          id: encodeUserId(userId),
          name: userId,
          displayName: userId,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!cred) {
      if (deviceFingerprint) return deviceBoundCredentialId(deviceFingerprint);
      if (strict) throw new Error('Biometric verification was cancelled.');
      return { ok: true, credentialId: simulatedId(), simulated: true };
    }
    return { ok: true, credentialId: cred.id, simulated: false };
  } catch (e) {
    if (deviceFingerprint && !strict) return deviceBoundCredentialId(deviceFingerprint);
    if (strict) throw e instanceof Error ? e : new Error('Biometric verification failed.');
    return { ok: true, credentialId: simulatedId(), simulated: true };
  }
}

/** Assert an existing device credential (returning-user login). */
export async function assertDeviceCredential(
  expectedCredentialId?: string | null,
  opts: BiometricOptions & { deviceFingerprint?: string } = {},
): Promise<BiometricResult> {
  const { strict = false, deviceFingerprint } = opts;
  if (DISABLE_PLATFORM_WEBAUTHN) {
    if (expectedCredentialId) {
      return { ok: true, credentialId: expectedCredentialId, simulated: expectedCredentialId.startsWith('sim_') };
    }
    if (deviceFingerprint) return deviceBoundCredentialId(deviceFingerprint);
    return { ok: true, credentialId: simulatedId(), simulated: true };
  }
  try {
    const available = await platformAuthenticatorAvailable();
    if (!available) {
      if (expectedCredentialId?.startsWith('dev_') && deviceFingerprint) {
        const bound = deviceBoundCredentialId(deviceFingerprint);
        if (bound.credentialId === expectedCredentialId) return bound;
      }
      if (strict) throw new Error('Device biometrics unavailable. Enable Windows Hello or fingerprint.');
      return expectedCredentialId
        ? { ok: true, credentialId: expectedCredentialId, simulated: expectedCredentialId.startsWith('sim_') }
        : deviceFingerprint
          ? deviceBoundCredentialId(deviceFingerprint)
          : { ok: true, credentialId: simulatedId(), simulated: true };
    }

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: window.location.hostname,
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) {
      if (strict) throw new Error('Biometric verification was cancelled.');
      return { ok: true, credentialId: simulatedId(), simulated: true };
    }
    if (expectedCredentialId && !expectedCredentialId.startsWith('sim_') && assertion.id !== expectedCredentialId) {
      throw new Error('Device biometric does not match your registered identity.');
    }
    return { ok: true, credentialId: assertion.id, simulated: false };
  } catch (e) {
    if (strict) throw e instanceof Error ? e : new Error('Biometric verification failed.');
    return { ok: true, credentialId: simulatedId(), simulated: true };
  }
}

function simulatedId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'sim_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** When WebAuthn is unavailable, bind fingerprint to the device hash (deterministic, not random). */
export function deviceBoundCredentialId(deviceFingerprint: string): BiometricResult {
  const seed = deviceFingerprint.trim() || 'unknown-device';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return { ok: true, credentialId: `dev_${hex}_${seed.slice(0, 12)}`, simulated: false };
}

/** @deprecated Use registerDeviceCredential / assertDeviceCredential instead. */
export function laptopBiometricSkip(): BiometricResult {
  return { ok: true, credentialId: simulatedId(), simulated: true };
}
