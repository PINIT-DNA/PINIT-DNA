/**
 * Phase 3F — unambiguous cryptographic field serialization
 *
 * pipe-v1  — legacy: UTF-8 strings joined by '|' (spatial-auth-v1 / spatial-pixel-auth-v1)
 * lpbin-v1.1 — length-prefixed binary fields (spatial-auth-v1.1 / spatial-pixel-auth-v1.1)
 *
 * NEVER silently reinterpret one version as another.
 */

export type SpatialCryptoEncoding = 'pipe-v1' | 'lpbin-v1.1';

export type CryptoField =
  | { type: 'str'; value: string }
  | { type: 'u16'; value: number }
  | { type: 'u32'; value: number }
  | { type: 'bytes'; value: Buffer };

export function encodingForSpatialAuthVersion(algorithmVersion: string): SpatialCryptoEncoding {
  if (algorithmVersion === 'spatial-auth-v1.1') return 'lpbin-v1.1';
  return 'pipe-v1';
}

export function encodingForSpatialPixelVersion(algorithmVersion: string): SpatialCryptoEncoding {
  if (algorithmVersion === 'spatial-pixel-auth-v1.1') return 'lpbin-v1.1';
  return 'pipe-v1';
}

function assertU16(n: number, label: string): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new Error(`Invalid u16 ${label}: ${n}`);
  }
  return n;
}

function assertU32(n: number, label: string): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`Invalid u32 ${label}: ${n}`);
  }
  return n;
}

/** UTF-8 string with u16 BE length prefix (max 65535 bytes) */
export function encodeLpUtf8(value: string): Buffer {
  const b = Buffer.from(value, 'utf8');
  if (b.length > 0xffff) throw new Error('UTF-8 field too long for u16 length prefix');
  const out = Buffer.alloc(2 + b.length);
  out.writeUInt16BE(b.length, 0);
  b.copy(out, 2);
  return out;
}

export function encodeU16Be(value: number, label = 'u16'): Buffer {
  const n = assertU16(value, label);
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

export function encodeU32Be(value: number, label = 'u32'): Buffer {
  const n = assertU32(value, label);
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

export function encodeLpBytes(value: Buffer): Buffer {
  if (value.length > 0xffff) throw new Error('bytes field too long for u16 length prefix');
  const out = Buffer.alloc(2 + value.length);
  out.writeUInt16BE(value.length, 0);
  value.copy(out, 2);
  return out;
}

function encodeFieldLp(field: CryptoField): Buffer {
  switch (field.type) {
    case 'str':
      return encodeLpUtf8(field.value);
    case 'u16':
      return encodeU16Be(field.value);
    case 'u32':
      return encodeU32Be(field.value);
    case 'bytes':
      return encodeLpBytes(field.value);
    default:
      throw new Error('Unknown crypto field type');
  }
}

/**
 * Build a deterministic MAC/HKDF payload.
 * pipe-v1: domain + stringified fields joined by '|' (legacy exact behavior).
 * lpbin-v1.1: domain as LP-UTF8, then typed fields with explicit widths.
 */
export function buildCryptoPayload(
  encoding: SpatialCryptoEncoding,
  domain: string,
  fields: CryptoField[],
): Buffer {
  if (encoding === 'pipe-v1') {
    const parts = [domain, ...fields.map((f) => {
      if (f.type === 'str') return f.value;
      if (f.type === 'bytes') return f.value.toString('hex');
      return String(f.value);
    })];
    return Buffer.from(parts.join('|'), 'utf8');
  }

  // lpbin-v1.1
  const chunks: Buffer[] = [encodeLpUtf8(domain)];
  for (const f of fields) chunks.push(encodeFieldLp(f));
  return Buffer.concat(chunks);
}

/** HKDF info: legacy colon-join vs length-prefixed binary */
export function buildHkdfInfo(
  encoding: SpatialCryptoEncoding,
  domain: string,
  parts: string[],
): Buffer {
  if (encoding === 'pipe-v1') {
    return Buffer.from([domain, ...parts].join(':'), 'utf8');
  }
  return Buffer.concat([encodeLpUtf8(domain), ...parts.map(encodeLpUtf8)]);
}
