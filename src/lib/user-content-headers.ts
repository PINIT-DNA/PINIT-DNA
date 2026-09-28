/**
 * Security headers for responses that stream a USER-UPLOADED file to a browser.
 *
 * The API serves stored files (vault preview, share-link viewer, asset versions, marketplace
 * preview) inline with their ORIGINAL content type. HTML, XHTML, SVG and XML are accepted
 * upload types and are ACTIVE content: opened from the API origin, an uploaded file's script
 * would run there — reaching anything that origin's cookies can reach, and, on a share link,
 * against a recipient who is a stranger to the uploader.
 *
 * Active types therefore get a `sandbox` CSP: no scripts, no same-origin access, no forms or
 * popups. The document still renders (previews keep working), it just cannot execute.
 * Every other type is left exactly as it was — notably PDF, images, audio and video, whose
 * built-in viewers can break under a CSP `sandbox` — and only gets `nosniff`.
 */

/** Content types a browser will execute script from when navigated to / framed. */
const ACTIVE_CONTENT = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/xsl',
  'application/xslt+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
  'multipart/x-mixed-replace',
]);

const ACTIVE_CONTENT_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/** True when the (possibly parameterised) content type can carry executable script. */
export function isActiveContentType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  // Any structured-syntax XML type (application/*+xml) may embed script (XHTML, SVG, ...).
  return ACTIVE_CONTENT.has(base) || (base.startsWith('application/') && base.endsWith('+xml'));
}

/**
 * Headers to add when serving `mimeType` content that a user uploaded.
 * Spread into the response's `res.set({...})`.
 */
export function userContentHeaders(mimeType: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  if (isActiveContentType(mimeType)) headers['Content-Security-Policy'] = ACTIVE_CONTENT_CSP;
  return headers;
}

/**
 * The identity-embedding step re-encodes uploaded images (JPEG, WebP and SVG all come back as PNG
 * bytes) but the record keeps the original content-type label. Served as-is, an SVG upload is PNG
 * data labelled `image/svg+xml`, which browsers cannot render, and other labels are simply wrong.
 * For an `image/*` label, return the type the bytes actually have; anything else is left unchanged.
 */
export function correctImageMime(declared: string | null | undefined, body: Buffer): string {
  const label = declared || 'application/octet-stream';
  if (!label.toLowerCase().startsWith('image/') || body.length < 12) return label;
  const actual = sniffRasterImageMime(body);
  return actual && actual !== label.split(';')[0]!.trim().toLowerCase() ? actual : label;
}

function sniffRasterImageMime(b: Buffer): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null; // unknown / vector / other: keep the stored label
}

