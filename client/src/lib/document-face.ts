/**
 * Finds the face on an identity-document photograph, on the device, with the
 * same face-api models used for face sign-in (so the embedding is comparable
 * with live captures). Only the 128 numbers leave the device, never the crop.
 *
 * Returns:
 *   DocumentFace — a face was found (largest face on the document)
 *   null         — the photo was examined and no face was found
 *   undefined    — not examined (PDF, or the models could not run); the server
 *                  then reports the document photo as "not provided" instead of
 *                  pretending a comparison happened.
 */
import * as faceapi from 'face-api.js';
import { ensureFaceModels } from './face-capture';

export interface DocumentFace {
  embedding: number[];
  detectionScore: number;
  /** Face width as a share of the image's shorter side. */
  relativeSize: number;
}

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // The decoded image stays usable after the URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Face detection must never hold up the upload; past this, the photo is "not examined". */
const DETECTION_TIMEOUT_MS = 12_000;

export async function documentFaceFromFile(file: File): Promise<DocumentFace | null | undefined> {
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), DETECTION_TIMEOUT_MS); });
  try {
    return await Promise.race([detect(file), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function detect(file: File): Promise<DocumentFace | null | undefined> {
  try {
    await ensureFaceModels();
    const img = await loadImage(file);
    // ID photos are small within the card: a larger input size finds them more reliably.
    const detections = await faceapi
      .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    if (!detections.length) return null;
    const best = detections.reduce((a, b) => (b.detection.box.area > a.detection.box.area ? b : a));
    const shorter = Math.min(img.naturalWidth, img.naturalHeight) || 1;
    return {
      embedding: Array.from(best.descriptor),
      detectionScore: +best.detection.score.toFixed(3),
      relativeSize: +(best.detection.box.width / shorter).toFixed(3),
    };
  } catch {
    return undefined;
  }
}
