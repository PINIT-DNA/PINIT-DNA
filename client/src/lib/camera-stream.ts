/**
 * Camera stream helpers — ensure tracks + torch fully release when leaving scanner.
 */

/** Best-effort torch/flashlight off before stopping (Android Chrome). */
export async function turnOffTorch(track: MediaStreamTrack | null | undefined): Promise<void> {
  if (!track || track.readyState !== 'live') return;
  try {
    const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
    if (caps && 'torch' in caps && caps.torch) {
      await track.applyConstraints({
        advanced: [{ torch: false } as unknown as MediaTrackConstraintSet],
      });
    }
  } catch {
    /* unsupported */
  }
}

/** Stop every track, clear torch, and detach from <video> if provided. */
export function releaseMediaStream(
  stream: MediaStream | null | undefined,
  video?: HTMLVideoElement | null,
): void {
  if (video) {
    try {
      video.pause();
    } catch { /* */ }
    if (video.srcObject) {
      video.srcObject = null;
    }
  }
  if (!stream) return;
  const tracks = stream.getTracks();
  for (const track of tracks) {
    void turnOffTorch(track);
    try {
      track.stop();
    } catch { /* */ }
  }
}

/** Apply continuous autofocus when the device supports it. */
export async function preferContinuousFocus(track: MediaStreamTrack | null | undefined): Promise<void> {
  if (!track) return;
  try {
    await track.applyConstraints({
      advanced: [{ focusMode: 'continuous' }] as unknown as MediaTrackConstraintSet[],
    });
  } catch { /* unsupported */ }
}

/**
 * Open camera with progressive constraints.
 * Strict min resolution fails on most laptop webcams (OverconstrainedError) —
 * fall back so Scan works on Integrated Webcam / 720p devices.
 */
export type CameraFacing = 'user' | 'environment';

export async function openCameraStream(opts?: {
  facingMode?: CameraFacing;
  audio?: boolean;
}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Camera API unavailable'), { name: 'NotSupportedError' });
  }

  const facing = opts?.facingMode ?? 'environment';
  const audio = opts?.audio ?? false;
  const opposite: CameraFacing = facing === 'user' ? 'environment' : 'user';

  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio,
    },
    {
      video: {
        facingMode: { ideal: opposite },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio,
    },
    { video: true, audio },
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      const name = err instanceof DOMException ? err.name : '';
      // Don't retry if user explicitly denied — same result every time
      if (name === 'NotAllowedError' || name === 'SecurityError') throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Camera unavailable');
}

/** User-facing message for getUserMedia failures. */
export function cameraErrorMessage(err: unknown, fallbackHint: string): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Camera permission blocked. Allow camera for this site in the browser address bar, then try again. ${fallbackHint}`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return `No camera found on this device. ${fallbackHint}`;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `Camera is in use by another app. Close it and try again. ${fallbackHint}`;
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return `Camera could not start with required settings. ${fallbackHint}`;
  }
  return `Camera unavailable. ${fallbackHint}`;
}
