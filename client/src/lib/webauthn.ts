/**
 * PINIT — Device biometric (WebAuthn / FIDO2) helpers.
 *
 * These trigger the platform authenticator (Face ID / Touch ID / Windows Hello /
 * Android fingerprint) when available. In a demo / unsupported context they
 * resolve to a simulated success so the passwordless flow always completes.
 */

const RP_NAME = 'PINIT';

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
export async function registerDeviceCredential(userId: string, opts: BiometricOptions = {}): Promise<BiometricResult> {
  const { strict = false } = opts;
  try {
    const available = await platformAuthenticatorAvailable();
    if (!available) {
      if (strict) throw new Error('Device biometrics unavailable. Enable Face ID or fingerprint.');
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
      if (strict) throw new Error('Biometric verification was cancelled.');
      return { ok: true, credentialId: simulatedId(), simulated: true };
    }
    return { ok: true, credentialId: cred.id, simulated: false };
  } catch (e) {
    if (strict) throw e instanceof Error ? e : new Error('Biometric verification failed.');
    return { ok: true, credentialId: simulatedId(), simulated: true };
  }
}

/** Assert an existing device credential (returning-user login). */
export async function assertDeviceCredential(
  expectedCredentialId?: string | null,
  opts: BiometricOptions = {},
): Promise<BiometricResult> {
  const { strict = false } = opts;
  try {
    const available = await platformAuthenticatorAvailable();
    if (!available) {
      if (strict) throw new Error('Device biometrics unavailable. Enable Face ID or fingerprint.');
      return { ok: true, credentialId: simulatedId(), simulated: true };
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

/** Laptop/desktop skip — face + voice are the primary keys on web. */
export function laptopBiometricSkip(): BiometricResult {
  return { ok: true, credentialId: simulatedId(), simulated: true };
}
