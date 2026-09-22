/**
 * Stream a video's frames as raw RGB24, one at a time.
 *
 * The legacy path wrote every frame to disk as a JPEG and read them all into memory
 * before protecting any of them — about 1.5 GB of JPEGs for a 4,919-frame video, and
 * every patch then re-decoded that JPEG from scratch. Here ffmpeg decodes once and
 * pipes raw pixels, so memory stays at one frame regardless of video length and the
 * per-patch work is a memory slice.
 *
 * Two decode policies are deliberate and must not change, because the stored frame
 * hashes and HKCA roots are only re-derivable under the same policy:
 *   - `-noautorotate`: frames come out in file pixel order, matching the images'
 *     `file-pixel-order-v1` policy (no EXIF/display-matrix rotation).
 *   - `rgb24`: the same 3-channel layout the spatial auth decoder produces.
 *
 * Verified repeatable: the same binary gives byte-identical frames across repeat
 * decodes, with `-threads 1` or default threading, and seeking versus reading
 * sequentially. The ffmpeg version is recorded with the video so a later
 * investigation knows which decoder produced the committed hashes.
 */
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../../lib/logger';
import { dnaPhase2 } from '../../../config/dna-phase2';

const execFileAsync = promisify(execFile);

export interface RawFrame {
  frameIndex: number;
  timestampMs: number;
  /** width * height * 3 bytes, RGB24. Reused across frames — copy if you keep it. */
  rgb: Buffer;
}

export interface RawVideoInfo {
  width: number;
  height: number;
  /** Native frame rate, rounded — the rate every-frame protection decodes at. */
  fps: number;
  frameCount: number | null;
  durationSec: number | null;
}

let cachedDecoderId: string | null = null;

/** e.g. "ffmpeg n6.0" — recorded with the frame DNA so verification uses the same decoder. */
export async function decoderIdentity(): Promise<string> {
  if (cachedDecoderId) return cachedDecoderId;
  try {
    const { stdout } = await execFileAsync(dnaPhase2.ffmpegPath, ['-version'], { timeout: 15000 });
    const first = String(stdout).split('\n')[0]?.trim() ?? 'ffmpeg';
    cachedDecoderId = `${first} rgb24 noautorotate`;
  } catch {
    cachedDecoderId = 'ffmpeg unknown rgb24 noautorotate';
  }
  return cachedDecoderId;
}

export async function probeRawVideo(filePath: string): Promise<RawVideoInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      dnaPhase2.ffprobePath,
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames:format=duration',
        '-of', 'default=nw=1',
        filePath,
      ],
      { timeout: 20000 },
    );

    const fields = new Map<string, string>();
    for (const line of String(stdout).split('\n')) {
      const [key, value] = line.trim().split('=');
      if (key && value !== undefined) fields.set(key, value);
    }

    const width = Number(fields.get('width'));
    const height = Number(fields.get('height'));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

    let fps = 0;
    const rate = fields.get('avg_frame_rate') ?? '';
    if (rate.includes('/')) {
      const [n, d] = rate.split('/').map(Number);
      if (n && d) fps = n / d;
    } else if (Number.isFinite(Number(rate))) {
      fps = Number(rate);
    }

    const nbFrames = Number(fields.get('nb_frames'));
    const duration = Number(fields.get('duration'));

    return {
      width,
      height,
      fps: fps > 0 ? Math.round(fps) : 0,
      frameCount: Number.isFinite(nbFrames) && nbFrames > 0 ? nbFrames : null,
      durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    };
  } catch (err) {
    logger.warn('[FrameDna] ffprobe failed — cannot read video geometry', { error: String(err) });
    return null;
  }
}

/**
 * Decode exactly one frame by its index, under the same policy as the full pass.
 *
 * Selecting by frame number (rather than seeking to a timestamp) is what makes the
 * re-derived pixels the same pixels that were protected, which is the whole basis for
 * storing the HKCA root without the tags.
 */
export async function decodeSingleRawFrame(
  filePath: string,
  options: { width: number; height: number; frameIndex: number },
): Promise<Buffer | null> {
  const frameBytes = options.width * options.height * 3;
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-noautorotate',
    '-i', filePath,
    '-vf', `select=eq(n\\,${options.frameIndex})`,
    '-vsync', '0',
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ];

  return new Promise((resolve) => {
    const child = spawn(dnaPhase2.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let total = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
    });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      if (total < frameBytes) return resolve(null);
      resolve(Buffer.concat(chunks, frameBytes));
    });
  });
}

/**
 * Yield decoded frames in order. The buffer handed to the consumer is reused on the
 * next iteration, so a consumer that keeps a frame must copy it.
 *
 * `sampleFps` null means every frame at the native rate.
 */
export async function* decodeRawFrames(
  filePath: string,
  options: { width: number; height: number; fps: number; sampleFps: number | null; maxFrames: number },
): AsyncGenerator<RawFrame, void, void> {
  const frameBytes = options.width * options.height * 3;
  const effectiveFps = options.sampleFps ?? options.fps;
  const msPerFrame = effectiveFps > 0 ? 1000 / effectiveFps : 0;

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-noautorotate',
    '-i', filePath,
    ...(options.sampleFps ? ['-vf', `fps=${options.sampleFps.toFixed(4)}`] : []),
    '-frames:v', String(options.maxFrames),
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ];

  const child = spawn(dnaPhase2.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < 4000) stderr += chunk.toString();
  });

  const frame = Buffer.allocUnsafe(frameBytes);
  let filled = 0;
  let frameIndex = 0;

  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      let offset = 0;
      while (offset < chunk.length) {
        const copied = chunk.copy(frame, filled, offset, Math.min(chunk.length, offset + (frameBytes - filled)));
        filled += copied;
        offset += copied;

        if (filled === frameBytes) {
          yield {
            frameIndex,
            timestampMs: Math.round(frameIndex * msPerFrame),
            rgb: frame,
          };
          frameIndex += 1;
          filled = 0;
          if (frameIndex >= options.maxFrames) return;
        }
      }
    }

    if (filled > 0) {
      logger.warn('[FrameDna] Discarded a partial trailing frame', {
        bytes: filled,
        expected: frameBytes,
        framesDecoded: frameIndex,
      });
    }
    if (frameIndex === 0 && stderr) {
      logger.warn('[FrameDna] ffmpeg produced no frames', { stderr: stderr.slice(0, 400) });
    }
  } finally {
    // Always stop ffmpeg — a consumer that breaks out early (cap reached, error)
    // would otherwise leave it decoding the rest of the video for nothing.
    if (!child.killed) child.kill('SIGKILL');
  }
}
