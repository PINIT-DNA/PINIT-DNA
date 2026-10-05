import { BIOMETRIC_DECISION, publicBiometricMessage, decisionFromClaimedVerify } from '../../src/services/auth/biometric-decision';
import {
  embeddingsComparable,
  qualityDecision,
  SIGN_IN_V1,
  FACE_API_V1,
  LICENSED_ARCFACE,
} from '../../src/services/auth/biometric-pipeline.contract';
import { embedAlignedFaceCrop, acceptClientFaceApiEmbedding } from '../../src/services/auth/recognition-engine';
import { verifyClaimedFace, normalizeEmbedding } from '../../src/services/auth/biometric-matching.service';

describe('Phase 2 biometric contract', () => {
  it('keeps 1:N out of normal Sign In', () => {
    expect(SIGN_IN_V1.identifyInNormalSignIn).toBe(false);
    expect(SIGN_IN_V1.unknownBrowser).toBe('claimed_1to1');
  });

  it('does not compare different model spaces', () => {
    expect(embeddingsComparable(
      { algorithm: FACE_API_V1.algorithm, dimension: 128, modelVersion: FACE_API_V1.modelVersion },
      { algorithm: LICENSED_ARCFACE.algorithm, dimension: 512, modelVersion: 'x' },
    )).toBe(false);
  });

  it('maps quality to internal codes only', () => {
    expect(qualityDecision({ faceCount: 0, poseOk: true, qualityOk: true })).toBe(BIOMETRIC_DECISION.FACE_NOT_FOUND);
    expect(qualityDecision({ faceCount: 2, poseOk: true, qualityOk: true })).toBe(BIOMETRIC_DECISION.MULTIPLE_FACES);
    expect(publicBiometricMessage(BIOMETRIC_DECISION.PAD_FAILED)).not.toMatch(/PAD|ArcFace|embedding/i);
  });

  it('server embed is unavailable until a licensed engine is installed', async () => {
    const r = await embedAlignedFaceCrop({
      mime: 'image/jpeg',
      bytes: Buffer.from([0xff, 0xd8]),
      width: 112,
      height: 112,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(BIOMETRIC_DECISION.MODEL_UNAVAILABLE);
  });

  it('accepts only 128-d face-api probes for the current engine', () => {
    const ok = acceptClientFaceApiEmbedding(new Array(128).fill(0.01));
    expect(ok?.dimension).toBe(128);
    expect(acceptClientFaceApiEmbedding(new Array(512).fill(0.01))).toBeNull();
  });

  it('refuses 128-d vs 512-d 1:1', () => {
    const probe = normalizeEmbedding(new Array(128).fill(0).map((_, i) => Math.sin(i)));
    const enrolled = new Array(512).fill(0.01);
    const result = verifyClaimedFace({ claimedUserId: 'u1', probe, enrolled });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('incompatible_model');
      expect(decisionFromClaimedVerify(result.reason)).toBe(BIOMETRIC_DECISION.MATCH_FAILED);
    }
  });
});
