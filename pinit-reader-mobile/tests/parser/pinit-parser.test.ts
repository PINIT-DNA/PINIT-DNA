import { describe, expect, test } from 'vitest';
import {
  buildPinitCarrier,
  parsePinitText,
  pinitStoredFileName,
  readPinitFile,
} from '../../src/core/pinit-parser';
import { isPinitLaunchUrl } from '../../src/files/launch-url';

const TOKEN = 'Ab3dEf_g12';

describe('pinit parser', () => {
  test('reads a valid carrier and ignores unknown fields', () => {
    const result = parsePinitText(JSON.stringify({
      version: 1,
      token: TOKEN,
      name: 'Flower',
      url: 'javascript:alert(1)',
      note: '<script>',
    }));
    expect(result).toMatchObject({ ok: true, document: { version: 1, token: TOKEN, name: 'Flower' } });
  });

  test('rejects a corrupted file, a bad version, and a missing token', () => {
    expect(parsePinitText('{').ok).toBe(false);
    expect(parsePinitText(JSON.stringify({ version: 2, token: TOKEN })).ok).toBe(false);
    expect(parsePinitText(JSON.stringify({ version: 1 })).ok).toBe(false);
  });

  test('rejects markup in the name and the wrong extension', async () => {
    const markup = parsePinitText(JSON.stringify({ version: 1, token: TOKEN, name: '<img>' }));
    expect(markup.ok).toBe(false);
    const wrong = await readPinitFile({
      name: 'flower.jpg',
      size: 20,
      text: async () => JSON.stringify({ version: 1, token: TOKEN }),
    });
    expect(wrong).toMatchObject({ ok: false, message: 'Invalid PINIT file.' });
  });

  test('shows the vault name as .pinit', () => {
    expect(pinitStoredFileName('Flower.jpg')).toBe('Flower.pinit');
    const saved = buildPinitCarrier(TOKEN, 'Flower.jpg');
    expect(saved?.filename).toBe('flower.pinit');
    expect(saved?.body).not.toMatch(/https?:/i);
  });
});

describe('launch urls', () => {
  test('accepts a file the operating system handed over', () => {
    expect(isPinitLaunchUrl('content://media/external/file/12')).toBe(true);
    expect(isPinitLaunchUrl('file:///storage/Flower.pinit')).toBe(true);
    expect(isPinitLaunchUrl('exp://192.168.1.4:8081')).toBe(false);
    expect(isPinitLaunchUrl(null)).toBe(false);
  });
});
