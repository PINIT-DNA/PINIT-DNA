/**
 * .pinit v1 carrier.
 *
 * The file is a small JSON pointer to an existing share token.
 * It is not the asset, not a second credential, and not a URL to follow.
 * Opening it is the public /open page's job; that page then goes to /s/{token}.
 */

export const PINIT_FORMAT_VERSION = 1;

/** A carrier is a few dozen bytes. Anything larger is rejected unread. */
export const PINIT_MAX_BYTES = 16 * 1024;

/** Existing share tokens: 10 chars from base64url (see generateToken). */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{10}$/;

const ALLOWED_KEYS = new Set(['version', 'token', 'name']);
const NAME_MAX = 120;

export type PinitFailureCode =
  | 'wrong_extension'
  | 'too_large'
  | 'invalid_json'
  | 'invalid_file'
  | 'unsupported_version'
  | 'invalid_token';

export type PinitReadResult =
  | { ok: true; token: string; path: string }
  | { ok: false; code: PinitFailureCode; message: string };

export type PinitDocumentResult =
  | { ok: true; filename: string; body: string }
  | { ok: false; code: 'invalid_token' };

const MESSAGES: Record<PinitFailureCode, string> = {
  wrong_extension: 'This file cannot be opened',
  too_large: 'This file cannot be opened',
  invalid_json: 'Invalid .pinit file',
  invalid_file: 'Invalid .pinit file',
  unsupported_version: 'Unsupported .pinit version',
  invalid_token: 'Invalid share reference',
};

export interface PinitFileInput {
  name: string;
  size: number;
  text: () => Promise<string>;
}

export function pinitFailure(code: PinitFailureCode): PinitReadResult {
  return { ok: false, code, message: MESSAGES[code] };
}

export function isShareToken(value: string): boolean {
  return SHARE_TOKEN_PATTERN.test(value);
}

/** Viewer path for a token that has already passed isShareToken. */
export function shareViewerPath(token: string): string {
  return `/s/${token}`;
}

export function hasPinitExtension(fileName: string): boolean {
  const base = (fileName.split(/[/\\]/).pop() ?? fileName).trim().toLowerCase();
  return base.endsWith('.pinit') || base.endsWith('.pinit.txt');
}

/**
 * Name used only for the OS share sheet.
 * Chrome and Edge refuse to open that sheet for a `.pinit` file.
 * `name.pinit.txt` is still the same carrier, and the opener accepts it.
 */
export function pinitShareSheetFilename(filename: string): string {
  const base = (filename.split(/[/\\]/).pop() ?? filename).trim() || 'share.pinit';
  const lower = base.toLowerCase();
  if (lower.endsWith('.pinit.txt')) return base;
  if (lower.endsWith('.pinit')) return `${base}.txt`;
  return `${base}.pinit.txt`;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Display name stored in the carrier. Path, extension, and markup are removed. */
export function pinitDisplayName(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const segment = raw.trim().split(/[/\\]/).pop() ?? raw.trim();
  const withoutExt = segment.replace(/\.[^.]+$/, '');
  const cleaned = withoutExt.replace(/[<>]/g, '').trim();
  if (!cleaned || hasControlChar(cleaned)) return undefined;
  return cleaned.slice(0, NAME_MAX);
}

export function pinitDownloadFilename(raw: string | null | undefined): string {
  const display = pinitDisplayName(raw) ?? 'share';
  const slug = display
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'share'}.pinit`;
}

export function buildPinitDocument(input: {
  token: string;
  name?: string | null;
}): PinitDocumentResult {
  const token = input.token.trim();
  if (!isShareToken(token)) return { ok: false, code: 'invalid_token' };

  const name = pinitDisplayName(input.name);
  const payload: { version: number; token: string; name?: string } = {
    version: PINIT_FORMAT_VERSION,
    token,
  };
  if (name) payload.name = name;

  return {
    ok: true,
    filename: pinitDownloadFilename(input.name),
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

function parseJson(text: string): unknown {
  return JSON.parse(text, (key, value: unknown) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error('forbidden key');
    }
    return value;
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parsePinitText(text: string): PinitReadResult {
  if (text.length > PINIT_MAX_BYTES) return pinitFailure('too_large');
  if (text.includes('\u0000')) return pinitFailure('invalid_file');

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = parseJson(source);
  } catch {
    return pinitFailure('invalid_json');
  }

  if (!isPlainRecord(parsed)) return pinitFailure('invalid_file');

  const keys = Object.keys(parsed);
  if (keys.length === 0 || keys.some((key) => !ALLOWED_KEYS.has(key))) {
    return pinitFailure('invalid_file');
  }

  if (parsed['version'] !== PINIT_FORMAT_VERSION) {
    return pinitFailure('unsupported_version');
  }

  const token = parsed['token'];
  if (typeof token !== 'string' || !isShareToken(token)) {
    return pinitFailure('invalid_token');
  }

  if ('name' in parsed) {
    const name = parsed['name'];
    if (typeof name !== 'string' || name.length > NAME_MAX || hasControlChar(name) || /[<>]/.test(name)) {
      return pinitFailure('invalid_file');
    }
  }

  return { ok: true, token, path: shareViewerPath(token) };
}

export async function readPinitFile(file: PinitFileInput): Promise<PinitReadResult> {
  if (!hasPinitExtension(file.name)) return pinitFailure('wrong_extension');
  if (!Number.isFinite(file.size) || file.size > PINIT_MAX_BYTES) return pinitFailure('too_large');
  if (file.size <= 0) return pinitFailure('invalid_file');

  let text: string;
  try {
    text = await file.text();
  } catch {
    return pinitFailure('invalid_file');
  }
  if (text.length > PINIT_MAX_BYTES) return pinitFailure('too_large');
  return parsePinitText(text);
}
