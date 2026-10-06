import { decidePassiveHeuristic } from '../../client/src/lib/biometric/passive-pad-engine';
import { evaluateFaceQuality, qualityUserMessage } from '../../client/src/lib/biometric/face-quality-engine';
import { mayIssueSession } from '../../src/services/auth/face-auth-machine';

const goodFace = {
  faceCount: 1,
  boxRatio: 0.2,
  centerOffsetX: 0.05,
  centerOffsetY: 0.05,
  brightness: 120,
  sharpness: 20,
  yaw: 0.05,
  pitch: 0.05,
  eyesVisible: true,
};

describe('face quality and passive pad', () => {
  it('names the quality problem instead of a motion prompt', () => {
    expect(qualityUserMessage(evaluateFaceQuality({ ...goodFace, brightness: 5 }).reasons)).toBe('Move to a brighter area.');
    expect(qualityUserMessage(evaluateFaceQuality({ ...goodFace, boxRatio: 0.01 }).reasons)).toBe('Move a little closer.');
    expect(qualityUserMessage(evaluateFaceQuality({ ...goodFace, centerOffsetX: 0.5 }).reasons)).toBe('Center your face.');
    expect(qualityUserMessage(evaluateFaceQuality({ ...goodFace, faceCount: 2 }).reasons)).toBe('Make sure only one person is visible.');
  });

  it('does not treat an unknown or frozen frame as live', () => {
    expect(decidePassiveHeuristic({ motion: 0, sampleCount: 6, durationMs: 800, qualityPassed: true }).verdict).toBe('SPOOF');
    expect(decidePassiveHeuristic({ motion: 0.02, sampleCount: 2, durationMs: 100, qualityPassed: true }).verdict).toBe('UNKNOWN');
    expect(decidePassiveHeuristic({ motion: 0.02, sampleCount: 6, durationMs: 800, qualityPassed: false }).verdict).toBe('UNKNOWN');
    const live = decidePassiveHeuristic({ motion: 0.02, sampleCount: 6, durationMs: 800, qualityPassed: true });
    expect(live.verdict).toBe('LIVE');
    expect(live.productionGrade).toBe(false);
  });

  it('still refuses a session unless liveness and the match both passed', () => {
    expect(mayIssueSession(false, true)).toBe(false);
    expect(mayIssueSession(true, true)).toBe(true);
  });
});
