import fs from 'fs';
import path from 'path';
import {
  PINIT_FORMAT_VERSION,
  PINIT_MAX_BYTES,
  buildPinitDocument,
  parsePinitText,
  pinitDownloadFilename,
  pinitShareSheetFilename,
  pinitStoredFileName,
  readPinitFile,
  shareViewerPath,
} from '../../src/lib/pinit-file';

const TOKEN = 'aB3_xY-z90';

describe('.pinit carrier', () => {
  test('builds a v1 carrier from an existing share token', () => {
    const doc = buildPinitDocument({ token: TOKEN, name: 'Vaibhavi.jpg' });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.filename).toBe('vaibhavi.pinit');
    const parsed = JSON.parse(doc.body) as { version: number; token: string; name: string; open?: string };
    expect(parsed).toEqual({
      version: PINIT_FORMAT_VERSION,
      token: TOKEN,
      name: 'Vaibhavi',
    });
    expect(doc.body).not.toMatch(/https?:/i);
    expect(parsed.open).toBeUndefined();
  });

  test('slugs the download filename from the asset name', () => {
    expect(pinitDownloadFilename('Project Report.pdf')).toBe('project-report.pinit');
    expect(pinitDownloadFilename('confidential-video.mp4')).toBe('confidential-video.pinit');
    expect(pinitDownloadFilename('../etc/passwd')).toBe('passwd.pinit');
    expect(pinitDownloadFilename('')).toBe('share.pinit');
  });

  test('stores any vault extension as .pinit without changing the title', () => {
    expect(pinitStoredFileName('Vaibhavi.jpg')).toBe('Vaibhavi.pinit');
    expect(pinitStoredFileName('Project Report.pdf')).toBe('Project Report.pinit');
    expect(pinitStoredFileName('clip.MP4')).toBe('clip.pinit');
    expect(pinitStoredFileName('already.pinit')).toBe('already.pinit');
    expect(pinitStoredFileName('folder\\photo.png')).toBe('photo.pinit');
  });

  test('round-trips to the existing share viewer path', () => {
    const doc = buildPinitDocument({ token: TOKEN, name: 'Project Report.pdf' });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    const opened = parsePinitText(doc.body);
    expect(opened).toEqual({
      ok: true,
      token: TOKEN,
      path: shareViewerPath(TOKEN),
    });
    if (opened.ok) {
      expect(opened.path).toBe(`/s/${TOKEN}`);
      expect(opened.path.startsWith('/s/')).toBe(true);
      expect(opened.path.includes('://')).toBe(false);
    }
  });

  test('omits name when it is not useful', () => {
    const doc = buildPinitDocument({ token: TOKEN, name: '   ' });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    const parsed = JSON.parse(doc.body) as { name?: string };
    expect(parsed.name).toBeUndefined();
    expect(parsePinitText(doc.body).ok).toBe(true);
  });

  test('refuses to build a carrier for a token that is not a share token', () => {
    expect(buildPinitDocument({ token: 'https://evil.example/phish', name: 'x' }).ok).toBe(false);
    expect(buildPinitDocument({ token: 'short', name: 'x' }).ok).toBe(false);
  });

  test('rejects malformed JSON', () => {
    const result = parsePinitText('{');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_json');
      expect(result.message).toBe('Invalid .pinit file');
    }
  });

  test('rejects a missing token', () => {
    const result = parsePinitText(JSON.stringify({ version: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_token');
      expect(result.message).toBe('Invalid share reference');
    }
  });

  test('rejects an unsupported version', () => {
    const result = parsePinitText(JSON.stringify({ version: 2, token: TOKEN }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unsupported_version');
      expect(result.message).toBe('Unsupported .pinit version');
    }
  });

  test('rejects a version that is only a string', () => {
    const result = parsePinitText(JSON.stringify({ version: '1', token: TOKEN }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_version');
  });

  test('rejects an invalid token', () => {
    const cases = ['', 'short', 'has space!', 'https://evil.example', `${TOKEN}extra`, '../secret!'];
    for (const token of cases) {
      const result = parsePinitText(JSON.stringify({ version: 1, token }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('invalid_token');
        expect(result.message).toBe('Invalid share reference');
      }
    }
  });

  test('rejects unexpected fields, including a URL to follow', () => {
    const result = parsePinitText(JSON.stringify({
      version: 1,
      token: TOKEN,
      open: 'https://evil.example/phish',
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_file');
      expect(result.message).toBe('Invalid .pinit file');
    }
  });

  test('rejects prototype pollution keys', () => {
    const result = parsePinitText('{"version":1,"token":"aB3_xY-z90","__proto__":{"admin":true}}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_json');
  });

  test('rejects arrays and embedded markup', () => {
    expect(parsePinitText(JSON.stringify([{ version: 1, token: TOKEN }])).ok).toBe(false);
    const marked = parsePinitText(JSON.stringify({
      version: 1,
      token: TOKEN,
      name: '<script>alert(1)</script>',
    }));
    expect(marked.ok).toBe(false);
    if (!marked.ok) expect(marked.code).toBe('invalid_file');
  });

  test('uses a .txt name so the OS share sheet will open', () => {
    expect(pinitShareSheetFilename('vaibhavi.pinit')).toBe('vaibhavi.pinit.txt');
    expect(pinitShareSheetFilename('vaibhavi.pinit.txt')).toBe('vaibhavi.pinit.txt');
  });

  test('opens a share-sheet copy named .pinit.txt', async () => {
    const doc = buildPinitDocument({ token: TOKEN, name: 'Vaibhavi.jpg' });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    const result = await readPinitFile({
      name: pinitShareSheetFilename(doc.filename),
      size: doc.body.length,
      text: async () => doc.body,
    });
    expect(result.ok).toBe(true);
  });

  test('rejects the wrong extension before reading', async () => {
    let read = false;
    const result = await readPinitFile({
      name: 'photo.jpg',
      size: 40,
      text: async () => {
        read = true;
        return '{}';
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('wrong_extension');
      expect(result.message).toBe('This file cannot be opened');
    }
    expect(read).toBe(false);
  });

  test('rejects an oversized file before reading', async () => {
    let read = false;
    const result = await readPinitFile({
      name: 'vaibhavi.pinit',
      size: PINIT_MAX_BYTES + 1,
      text: async () => {
        read = true;
        return '';
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('too_large');
      expect(result.message).toBe('This file cannot be opened');
    }
    expect(read).toBe(false);
  });

  test('reads a valid file and returns only the viewer path', async () => {
    const doc = buildPinitDocument({ token: TOKEN, name: 'Confidential Video.mp4' });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    const result = await readPinitFile({
      name: 'Confidential Video.pinit',
      size: Buffer.byteLength(doc.body),
      text: async () => doc.body,
    });
    expect(result).toEqual({ ok: true, token: TOKEN, path: `/s/${TOKEN}` });
  });
});

describe('/open routing', () => {
  test('the opener is a public route beside the existing share viewer', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../client/src/router.tsx'),
      'utf8',
    );
    const openRoute = source.match(/\{\s*path:\s*'\/open',\s*element:\s*<OpenPinitPage\s*\/>\s*\}/);
    expect(openRoute).not.toBeNull();
    const openAt = source.indexOf("path: '/open'");
    const shareAt = source.indexOf("path: '/s/:token'");
    expect(openAt).toBeGreaterThan(-1);
    expect(shareAt).toBeGreaterThan(openAt);
  });
});
