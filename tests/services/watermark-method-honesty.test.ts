/**
 * The reported watermark `method` must describe what actually ran.
 *
 * Video and audio embedding append a tag after the media payload. They do not
 * touch keyframes or the audio signal, and the tag does not survive re-encoding.
 * The method name is surfaced in provenance, so naming techniques that were never
 * implemented asserts protection the file does not carry.
 */
import { describe, test, expect, jest } from '@jest/globals';

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import fs from 'fs';
import path from 'path';

const SRC = path.join(
  process.cwd(), 'src', 'services', 'watermark', 'vault-watermark-engine.service.ts',
);
const source = fs.readFileSync(SRC, 'utf8');

describe('watermark method names', () => {
  test('video does not claim keyframe embedding it does not perform', () => {
    expect(source).not.toContain("'video-keyframe-tail+metadata'");
    expect(source).toContain("method: 'video-container-tail'");
  });

  test('audio does not claim frequency-domain embedding it does not perform', () => {
    expect(source).not.toContain("'audio-frequency-tail'");
    expect(source).toContain("method: 'audio-container-tail'");
  });

  test('image embedding is untouched and still routes to real pixel work', () => {
    // Guard against a rename accidentally weakening the image path.
    expect(source).toContain('private async embedImage(');
    expect(source).toMatch(/mimeType\.startsWith\('image\/'\)/);
  });

  test('the video tag prefix extraction depends on is unchanged', () => {
    // Detection keys on this prefix, not on the method label.
    expect(source).toContain('PINIT-VAULT-VIDEO|');
    expect(source).toContain('PINIT-VAULT-AUDIO|');
  });
});
