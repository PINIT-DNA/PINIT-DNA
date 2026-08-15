/**
 * PAD temporary face-loss recovery — pure state machine (no webcam).
 */
import {
  evaluatePadFacePresence,
  FACE_LOSS_RECOVERY_MS,
} from '../../client/src/lib/pad-face-presence';

describe('evaluatePadFacePresence', () => {
  const t0 = 1_000_000;

  it('Test 1 — continuous face → process_face, loss cleared', () => {
    let lost: number | null = null;
    for (let i = 0; i < 5; i++) {
      const r = evaluatePadFacePresence({
        faceCount: 1,
        faceLostSince: lost,
        now: t0 + i * 110,
        samplesCollected: i,
      });
      expect(r.outcome).toBe('process_face');
      expect(r.faceLostSince).toBeNull();
      lost = r.faceLostSince;
    }
  });

  it('Test 2 — one missed frame then reacquire → no error', () => {
    let lost: number | null = null;
    lost = evaluatePadFacePresence({
      faceCount: 1, faceLostSince: lost, now: t0, samplesCollected: 4,
    }).faceLostSince;

    const miss = evaluatePadFacePresence({
      faceCount: 0, faceLostSince: lost, now: t0 + 110, samplesCollected: 4,
    });
    expect(miss.outcome).toBe('continue');
    expect(miss.faceLostSince).toBe(t0 + 110);

    const back = evaluatePadFacePresence({
      faceCount: 1, faceLostSince: miss.faceLostSince, now: t0 + 220, samplesCollected: 4,
    });
    expect(back.outcome).toBe('process_face');
    expect(back.faceLostSince).toBeNull();
  });

  it('Test 3 — several short misses under recovery window → continue', () => {
    let lost: number | null = null;
    evaluatePadFacePresence({
      faceCount: 1, faceLostSince: lost, now: t0, samplesCollected: 2,
    });

    const m1 = evaluatePadFacePresence({
      faceCount: 0, faceLostSince: null, now: t0 + 100, samplesCollected: 2,
    });
    expect(m1.outcome).toBe('continue');

    const m2 = evaluatePadFacePresence({
      faceCount: 0, faceLostSince: m1.faceLostSince, now: t0 + 100 + 500, samplesCollected: 2,
    });
    expect(m2.outcome).toBe('continue');
    expect(t0 + 100 + 500 - (m1.faceLostSince ?? 0)).toBeLessThan(FACE_LOSS_RECOVERY_MS);

    const back = evaluatePadFacePresence({
      faceCount: 1, faceLostSince: m2.faceLostSince, now: t0 + 800, samplesCollected: 2,
    });
    expect(back.outcome).toBe('process_face');
  });

  it('Test 4 — prolonged face loss after samples → face_lost', () => {
    const missStart = t0 + 500;
    const r = evaluatePadFacePresence({
      faceCount: 0,
      faceLostSince: missStart,
      now: missStart + FACE_LOSS_RECOVERY_MS,
      samplesCollected: 4,
    });
    expect(r.outcome).toBe('face_lost');
  });

  it('Test 5 — reacquisition resets continuous-loss timer', () => {
    const m1 = evaluatePadFacePresence({
      faceCount: 0, faceLostSince: null, now: t0, samplesCollected: 3,
    });
    expect(m1.outcome).toBe('continue');

    const ok = evaluatePadFacePresence({
      faceCount: 1, faceLostSince: m1.faceLostSince, now: t0 + 500, samplesCollected: 3,
    });
    expect(ok.faceLostSince).toBeNull();

    const m2 = evaluatePadFacePresence({
      faceCount: 0, faceLostSince: ok.faceLostSince, now: t0 + 600, samplesCollected: 3,
    });
    expect(m2.outcome).toBe('continue');
    expect(m2.faceLostSince).toBe(t0 + 600);

    // Near end of first streak would have failed if timers accumulated; new streak is fresh.
    const stillOk = evaluatePadFacePresence({
      faceCount: 0,
      faceLostSince: m2.faceLostSince,
      now: t0 + 600 + FACE_LOSS_RECOVERY_MS - 1,
      samplesCollected: 3,
    });
    expect(stillOk.outcome).toBe('continue');
  });

  it('Test 6 — multiple faces → multiple_faces (no silent pick)', () => {
    const r = evaluatePadFacePresence({
      faceCount: 2,
      faceLostSince: null,
      now: t0,
      samplesCollected: 1,
    });
    expect(r.outcome).toBe('multiple_faces');
  });

  it('Test 7 — prolonged miss with zero samples → keep trying (overall timeout owns never-detected)', () => {
    const missStart = t0;
    const r = evaluatePadFacePresence({
      faceCount: 0,
      faceLostSince: missStart,
      now: missStart + FACE_LOSS_RECOVERY_MS + 5000,
      samplesCollected: 0,
    });
    expect(r.outcome).toBe('continue');
  });

  it('recovery window is 2000ms', () => {
    expect(FACE_LOSS_RECOVERY_MS).toBe(2000);
  });
});
