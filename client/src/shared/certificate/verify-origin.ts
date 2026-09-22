/**
 * Where a certificate's QR code sends the person who scans it.
 *
 * A certificate is a portable representation of a record — the authority is the
 * verification service, not the sheet. So the QR must resolve to ONE canonical
 * public origin, the same one from every app that can render a certificate.
 *
 * It is deliberately NOT derived from window.location.origin. That is how a
 * certificate downloaded on a developer machine ended up carrying
 * http://localhost:3002/verify-certificate?id=… — a dead link for everyone who
 * received it — and how one rendered inside Exchange pointed at a marketplace
 * origin that serves no verification page at all.
 *
 * Set PUBLIC_CERTIFICATE_VERIFY_URL (VITE_PUBLIC_CERTIFICATE_VERIFY_URL in these
 * Vite apps) once a dedicated verification domain is live. Until then the default
 * is the Hub origin that actually serves /verify-certificate today.
 */

/** The Hub deployment that serves the public verification page. */
const DEFAULT_VERIFY_ORIGIN = 'https://pinit-dna.vercel.app';

function fromEnv(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env as Record<string, string | undefined> | undefined;
    return (env?.['VITE_PUBLIC_CERTIFICATE_VERIFY_URL'] ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * The origin every certificate QR points at.
 *
 * `override` is for a caller that already knows the right origin (a server-driven
 * render, or a test); anything empty falls through to the configured value.
 */
export function certificateVerifyOrigin(override?: string | null): string {
  const chosen = (override ?? '').trim() || fromEnv() || DEFAULT_VERIFY_ORIGIN;
  return chosen.replace(/\/$/, '');
}

/** The full public verification link for one certificate. */
export function certificateVerifyUrl(certificateId: string, override?: string | null): string {
  const id = (certificateId ?? '').trim();
  if (!id) return '';
  return `${certificateVerifyOrigin(override)}/verify-certificate?id=${encodeURIComponent(id)}`;
}
