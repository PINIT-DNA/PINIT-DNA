import type { PinitDocument, PinitErrorCode, PinitFileInput, PinitParseResult } from './types';
import { readerMessage } from './validation';

export const PINIT_FORMAT_VERSION = 1;

/** Same ceiling as the Hub carrier. Larger files are not read. */
export const PINIT_MAX_BYTES = 16 * 1024;

/** Existing Hub share tokens: 10 characters from base64url. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{10}$/;

const NAME_MAX = 120;

function fail(code: PinitErrorCode): PinitParseResult {
  return { ok: false, code, message: readerMessage(code) };
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function carrierName(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const segment = raw.trim().split(/[/\\]/).pop() ?? raw.trim();
  const withoutExt = segment.replace(/\.[^.]+$/, '');
  const cleaned = withoutExt.replace(/[<>]/g, '').trim();
  if (!cleaned || hasControlChar(cleaned)) return undefined;
  return cleaned.slice(0, NAME_MAX);
}

/** A .pinit download is only the share reference, never the asset bytes. */
export function buildPinitCarrier(token: string, name?: string | null): { filename: string; body: string } | null {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  const display = carrierName(name);
  const slug = (display ?? 'share')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const payload: { version: 1; token: string; name?: string } = { version: 1, token };
  if (display) payload.name = display;
  return {
    filename: `${slug || 'share'}.pinit`,
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

export function hasPinitExtension(fileName: string): boolean {
  const base = (fileName.split(/[/\\]/).pop() ?? fileName).trim().toLowerCase();
  return base.endsWith('.pinit');
}

/** Keep the title and show the file as .pinit, whatever extension the Hub still has. */
export function pinitStoredFileName(original: string): string {
  const base = (original.split(/[/\\]/).pop() ?? original).trim() || 'file';
  if (base.toLowerCase().endsWith('.pinit')) return base;
  const stem = base.replace(/\.[^.]+$/, '').trim();
  return `${stem || 'file'}.pinit`;
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

/**
 * Read a .pinit carrier as data.
 * Unknown fields are ignored. Nothing in the file is executed or fetched.
 */
export function parsePinitText(text: string): PinitParseResult {
  if (text.length > PINIT_MAX_BYTES) return fail('invalid_file');
  if (text.includes('\u0000')) return fail('invalid_file');

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = parseJson(source);
  } catch {
    return fail('corrupted');
  }

  if (!isPlainRecord(parsed)) return fail('invalid_file');

  if (parsed['version'] !== PINIT_FORMAT_VERSION) return fail('unsupported_version');

  const token = parsed['token'];
  if (typeof token !== 'string' || !SHARE_TOKEN_PATTERN.test(token)) return fail('missing_token');

  const document: PinitDocument = { version: 1, token };
  if ('name' in parsed && parsed['name'] !== undefined) {
    const name = parsed['name'];
    if (typeof name !== 'string' || name.length > NAME_MAX || hasControlChar(name) || /[<>]/.test(name)) {
      return fail('invalid_file');
    }
    const trimmed = name.trim();
    if (trimmed) document.name = trimmed;
  }

  return { ok: true, document };
}

export async function readPinitFile(file: PinitFileInput): Promise<PinitParseResult> {
  if (!hasPinitExtension(file.name)) return fail('invalid_file');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > PINIT_MAX_BYTES) {
    return fail('invalid_file');
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return fail('corrupted');
  }
  return parsePinitText(text);
}
