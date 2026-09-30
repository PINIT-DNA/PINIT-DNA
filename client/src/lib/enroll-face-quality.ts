export type Point2 = { x: number; y: number };

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Six-point eye aspect ratio — open eyes sit around 0.2–0.4. */
export function eyeAspectRatio(eye: Point2[]): number {
  if (eye.length < 6) return 0;
  const p1 = eye[0]!;
  const p2 = eye[1]!;
  const p3 = eye[2]!;
  const p4 = eye[3]!;
  const p5 = eye[4]!;
  const p6 = eye[5]!;
  const vertical = dist(p2, p6) + dist(p3, p5);
  const horizontal = 2 * dist(p1, p4) || 1;
  return vertical / horizontal;
}

export function enrollFaceHint(input: {
  box: { x: number; y: number; width: number; height: number };
  video: { width: number; height: number };
  leftEye: Point2[];
  rightEye: Point2[];
  jaw: Point2[];
}): string | null {
  const { box, video, leftEye, rightEye } = input;
  const area = Math.max(1, video.width * video.height);
  const ratio = (box.width * box.height) / area;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const centered =
    Math.abs(cx - video.width / 2) / video.width < 0.28
    && Math.abs(cy - video.height / 2) / video.height < 0.32;

  if (ratio < 0.06) return 'Move closer so your full face fills the oval';
  if (ratio > 0.70) return 'Move a little farther back';
  if (!centered) return 'Center your face in the oval';

  if (leftEye.length < 6 || rightEye.length < 6) {
    return 'Look at the camera with both eyes open';
  }

  const leftEar = eyeAspectRatio(leftEye);
  const rightEar = eyeAspectRatio(rightEye);
  if (leftEar < 0.08 || rightEar < 0.08) {
    return 'Open both eyes and look at the camera';
  }

  return null;
}
