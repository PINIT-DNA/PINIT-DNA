import { enrollFaceHint, eyeAspectRatio } from '../../client/src/lib/enroll-face-quality';

function eye(open: number): Array<{ x: number; y: number }> {
  const y = open;
  return [
    { x: 0, y: 0 },
    { x: 1, y: -y },
    { x: 2, y: -y },
    { x: 3, y: 0 },
    { x: 2, y: y },
    { x: 1, y: y },
  ];
}

describe('enrollFaceHint', () => {
  const video = { width: 640, height: 480 };
  const box = { x: 180, y: 80, width: 280, height: 320 };
  const leftEye = eye(0.4).map((p) => ({ x: 250 + p.x * 8, y: 160 + p.y * 8 }));
  const rightEye = eye(0.4).map((p) => ({ x: 370 + p.x * 8, y: 160 + p.y * 8 }));
  const jaw = [
    { x: 200, y: 200 },
    { x: 320, y: 360 },
    { x: 440, y: 200 },
  ];

  test('open eyes and a full-face box pass', () => {
    expect(enrollFaceHint({ box, video, leftEye, rightEye, jaw })).toBeNull();
  });

  test('closed eyes are rejected', () => {
    const shut = eye(0.02).map((p) => ({ x: 250 + p.x * 8, y: 160 + p.y * 8 }));
    expect(enrollFaceHint({ box, video, leftEye: shut, rightEye: shut, jaw })).toMatch(/eyes/i);
  });

  test('too far from camera is rejected', () => {
    expect(
      enrollFaceHint({
        box: { x: 300, y: 200, width: 40, height: 48 },
        video,
        leftEye,
        rightEye,
        jaw,
      }),
    ).toMatch(/closer|full face/i);
  });

  test('EAR is higher when the eye is open', () => {
    expect(eyeAspectRatio(eye(0.4))).toBeGreaterThan(eyeAspectRatio(eye(0.05)));
  });
});
