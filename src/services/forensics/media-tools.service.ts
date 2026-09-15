/**
 * External media tool utilities (FFmpeg, fpcalc).
 * Uses file paths — graceful fallback when binaries unavailable.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../../lib/logger';
import { dnaPhase2 } from '../../config/dna-phase2';

const execFileAsync = promisify(execFile);
const availabilityCache = new Map<string, boolean>();

/**
 * Date.now() alone (millisecond resolution) is not unique enough for temp
 * file names once multiple ffmpeg calls run concurrently on similar-sized
 * buffers (e.g. video protection running several probes/extracts back to
 * back while other code touches the same buffer) — two calls landing in the
 * same millisecond collide on one path, and one call's cleanup can delete
 * or overwrite the file while another's ffmpeg process is still reading it,
 * silently truncating output instead of throwing. A per-process counter
 * plus Date.now() guarantees every call gets a distinct path.
 */
let tempFileCounter = 0;
function uniqueTempSuffix(): string {
  tempFileCounter = (tempFileCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now()}-${process.pid}-${tempFileCounter}`;
}

function isBundledBinary(cmd: string): boolean {
  return path.isAbsolute(cmd) || cmd.includes('\\') || cmd.includes('/');
}

async function isBinaryResolvable(cmd: string): Promise<boolean> {
  if (availabilityCache.has(cmd)) return availabilityCache.get(cmd)!;
  let ok = false;
  if (isBundledBinary(cmd)) {
    try {
      await fs.promises.access(cmd);
      ok = true;
    } catch {
      ok = false;
    }
  } else {
    try {
      const check = process.platform === 'win32' ? 'where' : 'which';
      await execFileAsync(check, [cmd], { timeout: 5000 });
      ok = true;
    } catch {
      ok = false;
    }
  }
  availabilityCache.set(cmd, ok);
  return ok;
}

export async function isCommandAvailable(cmd: string): Promise<boolean> {
  return isBinaryResolvable(cmd);
}

export async function isFfmpegAvailable(): Promise<boolean> {
  return isBinaryResolvable(dnaPhase2.ffmpegPath);
}

export async function isFpcalcAvailable(): Promise<boolean> {
  return isCommandAvailable(dnaPhase2.fpcalcPath);
}

async function writeTempFile(buffer: Buffer, ext: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `pinit-dna-${uniqueTempSuffix()}.${ext}`);
  await fs.promises.writeFile(tmp, buffer);
  return tmp;
}

async function safeUnlink(p: string): Promise<void> {
  try { await fs.promises.unlink(p); } catch { /* ignore */ }
}

export async function extractAudioSample(buffer: Buffer, ext = 'mp4'): Promise<Buffer | null> {
  if (!(await isFfmpegAvailable())) return null;
  const tmpIn = await writeTempFile(buffer, ext);
  const tmpOut = path.join(os.tmpdir(), `pinit-dna-audio-${uniqueTempSuffix()}.raw`);
  try {
    await execFileAsync(dnaPhase2.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', tmpIn, '-t', '30', '-ac', '1', '-ar', '11025', '-f', 's16le', tmpOut,
    ], { timeout: 60000 });
    return await fs.promises.readFile(tmpOut);
  } catch (err) {
    logger.debug('FFmpeg audio extract failed', { error: String(err) });
    return null;
  } finally {
    await safeUnlink(tmpIn);
    await safeUnlink(tmpOut);
  }
}

export async function runChromaprint(filePath: string): Promise<string | null> {
  if (!(await isFpcalcAvailable())) return null;
  try {
    const { stdout } = await execFileAsync(
      dnaPhase2.fpcalcPath,
      ['-raw', '-length', '120', filePath],
      { timeout: 60000 },
    );
    const line = String(stdout).trim().split('\n').find((l) => l.startsWith('FINGERPRINT='));
    return line?.split('=')[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function probeVideoDuration(buffer: Buffer, ext = 'mp4'): Promise<number | null> {
  if (!(await isFfmpegAvailable())) return null;
  const tmpIn = await writeTempFile(buffer, ext);
  try {
    return await probeVideoDurationFromPath(tmpIn);
  } finally {
    await safeUnlink(tmpIn);
  }
}

async function probeVideoDurationFromPath(filePath: string): Promise<number | null> {
  if (!(await isFfmpegAvailable())) return null;
  try {
    const { stdout } = await execFileAsync(
      dnaPhase2.ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { timeout: 15000 },
    );
    const n = parseFloat(String(stdout).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function extractVideoFrameSamples(
  buffer: Buffer,
  count: number,
  ext = 'mp4',
): Promise<Buffer[]> {
  if (!(await isFfmpegAvailable())) return [];
  const tmpIn = await writeTempFile(buffer, ext);
  const tmpDir = path.join(os.tmpdir(), `pinit-frames-${uniqueTempSuffix()}`);
  const outPattern = path.join(tmpDir, 'frame-%03d.jpg');

  try {
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const totalSec = (await probeVideoDurationFromPath(tmpIn)) ?? 30;
    const fps = count <= 1
      ? 1
      : Math.max(0.08, (count - 1) / Math.max(totalSec - 0.15, 0.5));

    await execFileAsync(dnaPhase2.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', tmpIn,
      '-vf', `fps=${fps.toFixed(4)}`,
      '-frames:v', String(count),
      '-q:v', '3',
      outPattern,
    ], { timeout: 45000 });

    const files = (await fs.promises.readdir(tmpDir))
      .filter((f) => f.endsWith('.jpg'))
      .sort();
    const frames: Buffer[] = [];
    for (const f of files) {
      const frame = await fs.promises.readFile(path.join(tmpDir, f));
      if (frame.length > 100) frames.push(frame);
    }
    return frames;
  } catch (err) {
    logger.debug('FFmpeg batch frame extract failed', { error: String(err) });
    return [];
  } finally {
    await safeUnlink(tmpIn);
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface ProtectionFrameSample {
  frameIndex: number;
  /** Approximate timestamp — frames come from a constant-rate `fps=` filter,
   * so timestamp = frameIndex * (1000 / sampleFps). Not frame-accurate to the
   * source's actual frame timings, only to the sampling grid we imposed. */
  timestampMs: number;
  buffer: Buffer;
}

/**
 * Extract frames at a FIXED RATE (e.g. 1 frame/sec) for pixel-level protection,
 * as opposed to `extractVideoFrameSamples` above which extracts a fixed COUNT
 * of evenly-spaced frames for investigation-side keyframe comparison. Cost
 * here must stay proportional to video duration, not frame rate, so both
 * `sampleFps` and `maxFrames` are real caps, not just quality knobs.
 */
export async function extractFramesForProtection(
  buffer: Buffer,
  options: { sampleFps: number; maxFrames: number },
  ext = 'mp4',
): Promise<ProtectionFrameSample[]> {
  if (!(await isFfmpegAvailable())) return [];
  const tmpIn = await writeTempFile(buffer, ext);
  const tmpDir = path.join(os.tmpdir(), `pinit-protect-frames-${uniqueTempSuffix()}`);
  const outPattern = path.join(tmpDir, 'frame-%05d.jpg');
  const sampleFps = Math.max(0.01, options.sampleFps);

  try {
    await fs.promises.mkdir(tmpDir, { recursive: true });

    await execFileAsync(dnaPhase2.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', tmpIn,
      '-vf', `fps=${sampleFps.toFixed(4)}`,
      '-frames:v', String(options.maxFrames),
      '-q:v', '3',
      outPattern,
    ], { timeout: 600000, maxBuffer: 1024 * 1024 * 32 });

    const files = (await fs.promises.readdir(tmpDir))
      .filter((f) => f.endsWith('.jpg'))
      .sort();
    const msPerFrame = 1000 / sampleFps;
    const frames: ProtectionFrameSample[] = [];
    for (let i = 0; i < files.length; i++) {
      const frameBuffer = await fs.promises.readFile(path.join(tmpDir, files[i]!));
      if (frameBuffer.length > 100) {
        frames.push({ frameIndex: i, timestampMs: Math.round(i * msPerFrame), buffer: frameBuffer });
      }
    }
    return frames;
  } catch (err) {
    logger.debug('FFmpeg fixed-rate protection frame extract failed', { error: String(err) });
    return [];
  } finally {
    await safeUnlink(tmpIn);
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractFrameAtTimestampFromPath(filePath: string, timestampMs: number): Promise<Buffer | null> {
  if (!(await isFfmpegAvailable())) return null;
  const tmpOut = path.join(os.tmpdir(), `pinit-frame-at-ts-${uniqueTempSuffix()}.jpg`);
  const seekSec = Math.max(0, timestampMs / 1000).toFixed(3);
  try {
    await execFileAsync(dnaPhase2.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', seekSec,
      '-i', filePath,
      '-frames:v', '1',
      '-q:v', '3',
      tmpOut,
    ], { timeout: 20000 });
    const buf = await fs.promises.readFile(tmpOut);
    return buf.length > 100 ? buf : null;
  } catch (err) {
    logger.debug('FFmpeg seek frame extract failed', { error: String(err) });
    return null;
  } finally {
    await safeUnlink(tmpOut);
  }
}

/**
 * Re-extract frames at specific timestamps from a video buffer, one ffmpeg
 * seek per timestamp but writing the source buffer to disk only once. Used
 * at investigation time to reproduce the exact vault frame a protected
 * frame DnaRecord was enrolled from — individual frame images are never
 * persisted separately (only their DNA/HKCA/patch fingerprints are), so the
 * pixel-level composition comparison re-derives the buffer on demand from
 * the vaulted original video, the same way document page investigation
 * re-rasterizes pages from the vaulted original PDF on demand.
 */
export async function extractFramesAtTimestamps(
  buffer: Buffer,
  timestampsMs: number[],
  ext = 'mp4',
): Promise<Map<number, Buffer>> {
  const result = new Map<number, Buffer>();
  if (!timestampsMs.length || !(await isFfmpegAvailable())) return result;
  const tmpIn = await writeTempFile(buffer, ext);
  try {
    for (const ts of timestampsMs) {
      const frame = await extractFrameAtTimestampFromPath(tmpIn, ts);
      if (frame) result.set(ts, frame);
    }
    return result;
  } finally {
    await safeUnlink(tmpIn);
  }
}

export async function probeVideoFps(buffer: Buffer, ext = 'mp4'): Promise<number | null> {
  if (!(await isFfmpegAvailable())) return null;
  const tmpIn = await writeTempFile(buffer, ext);
  try {
    const { stdout } = await execFileAsync(
      dnaPhase2.ffprobePath,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', tmpIn],
      { timeout: 15000 },
    );
    const rate = String(stdout).trim();
    if (rate.includes('/')) {
      const [n, d] = rate.split('/').map(Number);
      if (d && n) return Math.round(n / d);
    }
    const n = parseFloat(rate);
    return Number.isFinite(n) ? Math.round(n) : null;
  } catch {
    return null;
  } finally {
    await safeUnlink(tmpIn);
  }
}
