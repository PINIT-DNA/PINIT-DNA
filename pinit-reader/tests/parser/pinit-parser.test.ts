import { describe, expect, test } from 'vitest';
import { PINIT_MAX_BYTES, buildPinitCarrier, parsePinitText, pinitStoredFileName, readPinitFile } from '../../src/core/pinit-parser';

const TOKEN = 'Ab3dEf_g12';

function file(name: string, text: string, size = text.length) {
  return { name, size, text: async () => text };
}

describe('pinit parser', () => {
  test('reads a valid carrier and ignores unknown fields', async () => {
    const text = JSON.stringify({
      version: 1,
      token: TOKEN,
      name: 'Vaibhavi',
      url: 'javascript:alert(1)',
      note: '<script>alert(1)</script>',
    });
    const result = await readPinitFile(file('vaibhavi.pinit', text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual({ version: 1, token: TOKEN, name: 'Vaibhavi' });
    expect(result.document).not.toHaveProperty('url');
  });

  test('rejects a missing token', () => {
    const result = parsePinitText(JSON.stringify({ version: 1, name: 'Vaibhavi' }));
    expect(result).toMatchObject({
      ok: false,
      code: 'missing_token',
      message: 'This PINIT file does not contain a valid share token.',
    });
  });

  test('rejects an empty token', () => {
    const result = parsePinitText(JSON.stringify({ version: 1, token: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('This PINIT file does not contain a valid share token.');
  });

  test('rejects invalid JSON', () => {
    const result = parsePinitText('{');
    expect(result).toMatchObject({
      ok: false,
      code: 'corrupted',
      message: 'This PINIT file is corrupted or invalid.',
    });
  });

  test('rejects an unsupported version', () => {
    const result = parsePinitText(JSON.stringify({ version: 2, token: TOKEN }));
    expect(result).toMatchObject({
      ok: false,
      message: 'This PINIT file version is not supported.',
    });
  });

  test('rejects the wrong extension before reading', async () => {
    let read = false;
    const result = await readPinitFile({
      name: 'photo.jpg',
      size: 20,
      text: async () => { read = true; return ''; },
    });
    expect(read).toBe(false);
    expect(result).toMatchObject({ ok: false, message: 'Invalid PINIT file.' });
  });

  test('rejects an empty file', async () => {
    const result = await readPinitFile(file('empty.pinit', '', 0));
    expect(result).toMatchObject({ ok: false, message: 'Invalid PINIT file.' });
  });

  test('rejects a large file before reading it', async () => {
    let read = false;
    const result = await readPinitFile({
      name: 'big.pinit',
      size: PINIT_MAX_BYTES + 1,
      text: async () => { read = true; return 'x'; },
    });
    expect(read).toBe(false);
    expect(result).toMatchObject({ ok: false, message: 'Invalid PINIT file.' });
  });

  test('rejects a large malformed body', () => {
    const result = parsePinitText('x'.repeat(PINIT_MAX_BYTES + 1));
    expect(result).toMatchObject({ ok: false, message: 'Invalid PINIT file.' });
  });

  test('shows a vault asset as .pinit', () => {
    expect(pinitStoredFileName('Flower.jpg')).toBe('Flower.pinit');
    expect(pinitStoredFileName('Flower.pinit')).toBe('Flower.pinit');
  });

  test('saves a copy as a .pinit carrier, not the asset', async () => {
    const saved = buildPinitCarrier(TOKEN, 'base.jpg');
    expect(saved).not.toBeNull();
    if (!saved) return;
    expect(saved.filename).toBe('base.pinit');
    expect(saved.body).not.toContain('image');
    const opened = await readPinitFile({
      name: saved.filename,
      size: saved.body.length,
      text: async () => saved.body,
    });
    expect(opened).toMatchObject({ ok: true, document: { version: 1, token: TOKEN, name: 'base' } });
  });

  test('does not execute markup or prototype pollution from the file', () => {
    const marker = '__pinit_reader_polluted__';
    const before = Object.prototype.hasOwnProperty(marker);
    const script = parsePinitText(JSON.stringify({
      version: 1,
      token: TOKEN,
      name: '<img src=x onerror=alert(1)>',
    }));
    const polluted = parsePinitText(
      `{"version":1,"token":"${TOKEN}","__proto__":{"${marker}":true}}`,
    );
    expect(script.ok).toBe(false);
    expect(polluted.ok).toBe(false);
    expect(Object.prototype.hasOwnProperty(marker)).toBe(before);
    expect(({} as Record<string, unknown>)[marker]).toBeUndefined();
  });
});
