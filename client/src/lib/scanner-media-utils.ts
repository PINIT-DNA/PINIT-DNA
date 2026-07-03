/** Load camera/gallery/video sources into ImageData for scanner preprocessing only. */
import {
  canvasToBlobWithTimeout,
  createImageBitmapWithTimeout,
  runTimedStage,
  withScannerTimeout,
} from './scanner-async-utils';

export async function blobToImageData(blob: Blob): Promise<ImageData | null> {
  const bitmap = await createImageBitmapWithTimeout(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

/** Extract a representative frame from a video file for investigation input. */
export async function extractVideoFrameBlob(
  file: File,
  seekRatio = 0.35,
): Promise<Blob | null> {
  return runTimedStage('extractVideoFrameBlob', async () => {
    const url = URL.createObjectURL(file);
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.src = url;

      await withScannerTimeout(
        new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Video load failed'));
        }),
        12_000,
        'video.onloadedmetadata',
      );

      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const seekTo = duration > 0 ? Math.min(duration - 0.05, Math.max(0, duration * seekRatio)) : 0;
      video.currentTime = seekTo;

      await withScannerTimeout(
        new Promise<void>((resolve, reject) => {
          const done = () => resolve();
          video.onseeked = done;
          video.onerror = () => reject(new Error('Video seek failed'));
          window.setTimeout(done, 600);
        }),
        8_000,
        'video.onseeked',
      );

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      return canvasToBlobWithTimeout(canvas, 'image/jpeg', 0.96);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, 20_000);
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(file.name);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?)$/i.test(file.name);
}
