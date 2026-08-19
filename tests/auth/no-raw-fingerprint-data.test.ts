/**
 * Spec §9 / §18 #9 — PINIT must never store fingerprint images, minutiae, or any
 * platform-authenticator biometric material. The OS/device biometric stays inside
 * the authenticator; we only ever hold WebAuthn public-key material plus a derived
 * proxy over the credential id / device fingerprint.
 *
 * These are structural tests over the actual functions, not documentation claims.
 */
import fs from 'fs';
import path from 'path';
import { deriveFingerprintTemplate } from '../../src/services/auth/biometric-matching.service';

describe('no raw fingerprint biometric data is stored', () => {
  it('deriveFingerprintTemplate is a pure function of two opaque strings', () => {
    // Same inputs → same output (a deterministic hash, not a captured sample).
    const a = deriveFingerprintTemplate('cred-abc', 'device-xyz');
    const b = deriveFingerprintTemplate('cred-abc', 'device-xyz');
    expect(a).toEqual(b);

    // Different credential → different derived vector.
    const c = deriveFingerprintTemplate('cred-different', 'device-xyz');
    expect(c).not.toEqual(a);

    // Always a fixed-width normalized vector — never variable-length sensor data.
    expect(a).toHaveLength(128);
    expect(a.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
  });

  it('produces a usable template even with no inputs at all (proving no sensor data is required)', () => {
    const derived = deriveFingerprintTemplate(undefined, undefined);
    expect(derived).toHaveLength(128);
    expect(derived.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('the fingerprint template is derived only from credential/device ids in source', () => {
    // Guards against someone later feeding real biometric material into this path.
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/services/auth/biometric-matching.service.ts'),
      'utf8',
    );
    const fnStart = src.indexOf('export function deriveFingerprintTemplate');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, src.indexOf('\n}', fnStart));

    // The only data that may flow into the derivation.
    expect(fnBody).toContain('credentialId');
    expect(fnBody).toContain('deviceFingerprint');

    // Terms that would indicate real fingerprint biometric handling.
    for (const forbidden of ['minutiae', 'ridge', 'fingerprintImage', 'sensorData', 'rawBiometric']) {
      expect(fnBody.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('the WebAuthn store persists only public-key credential fields', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/services/auth/webauthn-store.ts'),
      'utf8',
    );
    const insertStart = src.indexOf('export async function insertWebAuthnCredential');
    expect(insertStart).toBeGreaterThan(-1);
    const insertBody = src.slice(insertStart, src.indexOf('\n}', insertStart));

    // WebAuthn proves possession of the authenticator; these are the only fields.
    expect(insertBody).toContain('credentialId');
    expect(insertBody).toContain('publicKey');
    expect(insertBody).toContain('signCount');

    for (const forbidden of ['fingerprint_image', 'minutiae', 'biometricTemplate', 'rawBiometric']) {
      expect(insertBody.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
