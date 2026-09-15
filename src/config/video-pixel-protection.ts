/**
 * Video Pixel Protection — Phase 1
 *
 * Controls whether uploaded videos get every frame run through the same
 * pixel-level protection pipeline standalone images get (DNA layers, pixel
 * HKCA tamper localization, local-DNA patch indexing).
 *
 * Default is EVERY frame at the video's own native frame rate — no frame is
 * left uncovered. This is materially more expensive than sampling (a
 * 2-minute 30fps video is 3,600 frames, each re-running the per-image
 * pipeline), which is why maxFrames exists as a hard safety cap: without
 * one, a long upload could turn into an effectively unbounded background
 * job. protectEveryFrame can be turned off (falls back to sampleFps, e.g.
 * 1 frame/sec) to trade coverage density for cost on very long videos.
 */
function flag(key: string, defaultValue = true): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes';
}

function intEnv(key: string, fallback: number): number {
  const n = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function floatEnv(key: string, fallback: number): number {
  const n = parseFloat(process.env[key] ?? '');
  return Number.isFinite(n) ? n : fallback;
}

export const videoPixelProtectionConfig = {
  enabled: flag('VIDEO_PIXEL_PROTECTION_ENABLED', true),
  /** When true (default), every frame is protected at the video's own
   *  native frame rate — sampleFps below is ignored unless native fps
   *  can't be probed, or this is turned off. */
  protectEveryFrame: flag('VIDEO_PIXEL_PROTECTION_EVERY_FRAME', true),
  /** Only used when protectEveryFrame is false, or native fps probing fails. */
  sampleFps: floatEnv('VIDEO_PIXEL_PROTECTION_SAMPLE_FPS', 1),
  /** Hard cap on frames protected per video — a safety valve, not a quality
   *  knob, so an unusually long upload can't turn into an unbounded job. */
  maxFrames: intEnv('VIDEO_PIXEL_PROTECTION_MAX_FRAMES', 6000),
} as const;

export function isVideoPixelProtectionEnabled(): boolean {
  return videoPixelProtectionConfig.enabled;
}
