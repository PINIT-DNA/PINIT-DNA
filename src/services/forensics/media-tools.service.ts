/**
 * External media tool utilities (FFmpeg, fpcalc).
 * Uses file paths — graceful fallback when binaries unavailable.
 */
import { execFile } from 'child_process';
import crypto from 'crypto';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../../lib/logger';
import { dnaPhase2 } from '../../config/dna-phase2';

const execFileAsync = promisify(execFile);

/**
 * A temp name that is unique per call, not per millisecond.
 *
 * `Date.now()` alone collides whenever two media jobs start in the same
 * millisecond — routine when several users protect a video at once. Two videos then
 * share one input path or one frame directory, so one overwrites the other and the
 * wrong pictures get fingerprinted; worse, the `finally` cleanup deletes a directory
 * another job is still reading.
 */
function uniqueTempName(prefix: string, suffix = ''): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${crypto.randomUUID()}${suffix}`);
}
const availabilityCache = new Map<string, boolean>();

function isBundledBinary(cmd: string): boolean {
  return path.isAbsolute(cmd) || cmd.includes('\\') || cmd.includes('/');
}

/**
 * A bundled binary that exists but cannot be executed is not available.
 *
 * `fs.access` defaults to F_OK — file present. npm does not reliably preserve the
 * execute bit on the platform binaries it unpacks, so on Linux the ffmpeg that
 * ships with `ffmpeg-static` is routinely present and non-executable. Checking
 * only for existence made `isFfmpegAvailable()` answer true while every execFile
 * failed with EACCES: video keyframe extraction returned zero frames, silently,
 * and the duplicate check declined rather than guessing. Correct behaviour on a
 * false premise.
 *
 * Try to restore the bit ourselves before giving up — it is our own dependency in
 * our own node_modules, and a chmod is cheaper than a broken protection path.
 */
async function isExecutable(cmd: string): Promise<boolean> {
  try {
    await fs.promises.access(cmd, fs.constants.X_OK);
    return true;
  } catch {
    // Present but not executable? Fix it rather than degrade.
    try {
      await fs.promises.access(cmd, fs.constants.F_OK);
      await fs.promises.chmod(cmd, 0o755);
      await fs.promises.access(cmd, fs.constants.X_OK);
      logger.warn('Media tool was not executable — restored the execute bit', { cmd });
      return true;
    } catch (err) {
      logger.warn('Media tool is unusable', { cmd, error: String(err) });
      return false;
    }
  }
}

async function isBinaryResolvable(cmd: string): Promise<boolean> {
  if (availabilityCache.has(cmd)) return availabilityCache.get(cmd)!;
  let ok = false;
  if (isBundledBinary(cmd)) {
    ok = await isExecutable(cmd);
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
  const tmp = uniqueTempName('pinit-dna', `.${ext}`);
  await fs.promises.writeFile(tmp, buffer);
  return tmp;
}

async function safeUnlink(p: string): Promise<void> {
  try { await fs.promises.unlink(p); } catch { /* ignore */ }
}

export async function extractAudioSample(buffer: Buffer, ext = 'mp4'): Promise<Buffer | null> {
  if (!(await isFfmpegAvailable())) return null;
  const tmpIn = await writeTempFile(buffer, ext);
  const tmpOut = uniqueTempName('pinit-dna-audio', '.raw');
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
  const tmpDir = uniqueTempName('pinit-frames');
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
    // Was debug. A silent [] here disables video duplicate detection entirely and
    // looks identical to "this video has no frames", so it must be visible.
    logger.warn('FFmpeg frame extraction failed — video keyframe DNA unavailable', {
      ffmpegPath: dnaPhase2.ffmpegPath,
      error: String(err),
    });
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
  const tmpDir = uniqueTempName('pinit-protect-frames');
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
  const tmpOut = uniqueTempName('pinit-frame-at-ts', '.jpg');
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

/** Media tool availability, for health reporting and remote diagnosis. */
export async function getMediaToolStatus(): Promise<{
  ffmpeg: boolean;
  ffprobe: boolean;
  ffmpegPath: string;
  ffprobePath: string;
}> {
  const [ffmpeg, ffprobe] = await Promise.all([
    isBinaryResolvable(dnaPhase2.ffmpegPath),
    isBinaryResolvable(dnaPhase2.ffprobePath),
  ]);
  return {
    ffmpeg,
    ffprobe,
    ffmpegPath: dnaPhase2.ffmpegPath,
    ffprobePath: dnaPhase2.ffprobePath,
  };
}
