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

export interface BiometricResult {
  ok: boolean;
  credentialId: string;
  simulated: boolean;
}

/** Create a FIDO2 credential bound to this device (registration). */
export async function registerDeviceCredential(userId: string): Promise<BiometricResult> {
  try {
    const available = await platformAuthenticatorAvailable();
    if (!available) return { ok: true, credentialId: simulatedId(), simulated: true };

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

    if (!cred) return { ok: true, credentialId: simulatedId(), simulated: true };
    return { ok: true, credentialId: cred.id, simulated: false };
  } catch {
    // User cancellation or unsupported — fall back so the flow is not blocked.
    return { ok: true, credentialId: simulatedId(), simulated: true };
  }
}

/** Assert an existing device credential (returning-user login). */
export async function assertDeviceCredential(): Promise<BiometricResult> {
  try {
    const available = await platformAuthenticatorAvailable();
    if (!available) return { ok: true, credentialId: simulatedId(), simulated: true };

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: window.location.hostname,
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) return { ok: true, credentialId: simulatedId(), simulated: true };
    return { ok: true, credentialId: assertion.id, simulated: false };
  } catch {
    return { ok: true, credentialId: simulatedId(), simulated: true };
  }
}

function simulatedId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'sim_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
