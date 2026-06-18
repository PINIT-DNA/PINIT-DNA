/**
 * PINIT — HOID identity persistence (Supabase).
 *
 * Stores the human-origin identity captured during registration — the face
 * enrolment frame, WebAuthn/FIDO2 credential reference, device fingerprint,
 * liveness/voice flags and trust score — in the `hoid_identities` table of the
 * configured Supabase project (kqdqmimdqecensurjplh), using the public anon key
 * under Row Level Security.
 *
 * All calls are non-fatal: if the table/policies are not yet provisioned the
 * registration flow still completes (the auth session comes from the backend).
 * Run `supabase/hoid_identities.sql` once in the Supabase SQL editor to enable
 * persistence.
 */
import { supabase } from './supabase';

const TABLE = 'hoid_identities';

export interface IdentityPayload {
  hoid: string;
  shortId: string;
  deviceFp?: string | null;
  faceImage?: string | null;       // base64 JPEG data URL of the enrolment frame
  webauthnCredentialId?: string | null;
  webauthnSimulated?: boolean;
  faceEnrolled?: boolean;
  voiceEnrolled?: boolean;
  livenessPassed?: boolean;
  trustScore?: number;
}

export interface StoreResult {
  stored: boolean;
  id?: string;
  reason?: string;
}

/** Insert a freshly-registered identity. Returns {stored:false, reason} on failure. */
export async function storeIdentity(p: IdentityPayload): Promise<StoreResult> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        hoid: p.hoid,
        short_id: p.shortId,
        device_fp: p.deviceFp ?? null,
        face_image: p.faceImage ?? null,
        face_enrolled: p.faceEnrolled ?? Boolean(p.faceImage),
        webauthn_credential_id: p.webauthnCredentialId ?? null,
        webauthn_simulated: p.webauthnSimulated ?? false,
        voice_enrolled: p.voiceEnrolled ?? false,
        liveness_passed: p.livenessPassed ?? false,
        trust_score: p.trustScore ?? 99.8,
        user_agent: navigator.userAgent,
        last_login_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[PINIT] storeIdentity failed:', error.message);
      return { stored: false, reason: error.message };
    }
    console.info('[PINIT] Identity stored in Supabase:', data?.id);
    return { stored: true, id: data?.id as string };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[PINIT] storeIdentity error:', msg);
    return { stored: false, reason: msg };
  }
}

/** Stamp the latest login time for a returning identity (best-effort). */
export async function touchLastLogin(shortId: string): Promise<void> {
  try {
    await supabase.from(TABLE).update({ last_login_at: new Date().toISOString() }).eq('short_id', shortId);
  } catch {
    /* non-fatal */
  }
}
