/**
 * Does the video keyframe near-duplicate detector actually survive real
 * re-encoding, resize, and trimming — against REAL ffmpeg-generated video,
 * not synthetic hash strings? The existing video-frame-duplicate.test.ts and
 * video-dna-fallback.test.ts both mock buildVideoAssetDna or compare
 * hand-written hex strings; this is the first test to run the real
 * extraction pipeline (buildVideoAssetDna -> real ffmpeg) against real
 * transcoded video, which the earlier session audit flagged as unverified:
 * "its real-world hit rate against re-encoded/cropped video is unverified
 * by tests, only by code inspection."
 *
 * Requires ffmpeg-static (already a project dependency) — skips gracefully
 * if genuinely unavailable in a given CI environment.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath = require('ffmpeg-static') as string;

const execFileAsync = promisify(execFile);
const SLOW = 180_000;

let workDir: string;
let ffmpegOk = true;

async function ffmpeg(args: string[]): Promise<void> {
  await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 30_000 });
}

beforeAll(async () => {
  workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinit-video-robustness-'));
  try {
    await ffmpeg(['-f', 'lavfi', '-i', 'mandelbrot=size=640x480:rate=10', '-t', '3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', path.join(workDir, 'original.mp4')]);
  } catch {
    ffmpegOk = false;
    return;
  }
  const orig = path.join(workDir, 'original.mp4');
  await ffmpeg(['-i', orig, '-c:v', 'libx264', '-crf', '30', '-preset', 'fast', path.join(workDir, 'reencoded.mp4')]);
  await ffmpeg(['-i', orig, '-vf', 'scale=320:240', '-c:v', 'libx264', '-crf', '23', path.join(workDir, 'resized.mp4')]);
  await ffmpeg(['-i', orig, '-ss', '0.5', '-t', '1.5', '-c:v', 'libx264', '-crf', '23', path.join(workDir, 'trimmed.mp4')]);
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=10', '-t', '3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', path.join(workDir, 'unrelated.mp4')]);
}, SLOW);

afterAll(async () => {
  if (workDir) await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
});

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(workDir, name));
}

describe('Video keyframe near-duplicate — real ffmpeg-generated video', () => {
  test('the fixture pipeline itself works (ffmpeg produced real, playable files)', () => {
    if (!ffmpegOk) {
      // eslint-disable-next-line no-console
      console.warn('ffmpeg unavailable in this environment — skipping real video robustness tests');
      return;
    }
    expect(fs.existsSync(path.join(workDir, 'original.mp4'))).toBe(true);
    expect(fs.statSync(path.join(workDir, 'original.mp4')).size).toBeGreaterThan(1000);
  });

  test('re-encoded at heavier compression (crf30) still matches the original', async () => {
    if (!ffmpegOk) return;
    const { buildVideoAssetDna } = await import('../../src/services/assets/video-asset-dna.service');
    const { compareVideoFrameHashes } = await import('../../src/services/forensics/video-dna-enhancements.service');

    const orig = await buildVideoAssetDna(loadFixture('original.mp4'));
    expect(orig.framePHashes.length).toBeGreaterThan(0); // real frames were actually extracted

    const reencoded = await buildVideoAssetDna(loadFixture('reencoded.mp4'));
    const result = compareVideoFrameHashes(reencoded.framePHashes, orig.framePHashes);
    expect(result.similarity).toBeGreaterThanOrEqual(0.6); // VIDEO_FRAME_MATCH_THRESHOLD
  }, SLOW);

  test('resized (640x480 -> 320x240) AND re-encoded still matches', async () => {
    if (!ffmpegOk) return;
    const { buildVideoAssetDna } = await import('../../src/services/assets/video-asset-dna.service');
    const { compareVideoFrameHashes } = await import('../../src/services/forensics/video-dna-enhancements.service');

    const orig = await buildVideoAssetDna(loadFixture('original.mp4'));
    const resized = await buildVideoAssetDna(loadFixture('resized.mp4'));
    const result = compareVideoFrameHashes(resized.framePHashes, orig.framePHashes);
    expect(result.similarity).toBeGreaterThanOrEqual(0.6);
  }, SLOW);

  test('a trimmed 1.5s clip from the middle still matches (asymmetric/partial)', async () => {
    if (!ffmpegOk) return;
    const { buildVideoAssetDna } = await import('../../src/services/assets/video-asset-dna.service');
    const { compareVideoFrameHashes } = await import('../../src/services/forensics/video-dna-enhancements.service');

    const orig = await buildVideoAssetDna(loadFixture('original.mp4'));
    const trimmed = await buildVideoAssetDna(loadFixture('trimmed.mp4'));
    const result = compareVideoFrameHashes(trimmed.framePHashes, orig.framePHashes);
    expect(result.similarity).toBeGreaterThanOrEqual(0.6);
  }, SLOW);

  test('a genuinely unrelated video does NOT match (no false positive)', async () => {
    if (!ffmpegOk) return;
    const { buildVideoAssetDna } = await import('../../src/services/assets/video-asset-dna.service');
    const { compareVideoFrameHashes } = await import('../../src/services/forensics/video-dna-enhancements.service');

    const orig = await buildVideoAssetDna(loadFixture('original.mp4'));
    const unrelated = await buildVideoAssetDna(loadFixture('unrelated.mp4'));
    const result = compareVideoFrameHashes(unrelated.framePHashes, orig.framePHashes);
    expect(result.similarity).toBeLessThan(0.6);
  }, SLOW);
});
