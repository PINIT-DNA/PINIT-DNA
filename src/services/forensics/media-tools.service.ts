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
  const tmp = path.join(os.tmpdir(), `pinit-dna-${Date.now()}.${ext}`);
  await fs.promises.writeFile(tmp, buffer);
  return tmp;
}

async function safeUnlink(p: string): Promise<void> {
  try { await fs.promises.unlink(p); } catch { /* ignore */ }
}

export async function extractAudioSample(buffer: Buffer, ext = 'mp4'): Promise<Buffer | null> {
  if (!(await isFfmpegAvailable())) return null;
  const tmpIn = await writeTempFile(buffer, ext);
  const tmpOut = path.join(os.tmpdir(), `pinit-dna-audio-${Date.now()}.raw`);
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
  const tmpDir = path.join(os.tmpdir(), `pinit-frames-${Date.now()}`);
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
