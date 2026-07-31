/**
 * Phase 2 — Screen Recording DNA (frame sequence, motion, playback signature).
 */
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import { sha256, simHash64 } from '../engines/base/text-utils';
import { generateVideoDna, detectScreenRecordingFromVideo } from './video-dna-enhancements.service';
import { generateAudioDna } from './audio-dna-enhancements.service';
import type { ScreenRecordingDnaData } from '../../types/dna-enhancements.types';
import { probeVideoFps } from './media-tools.service';

function playbackSignature(keyframes: string[]): string {
  return simHash64(keyframes.join('→'));
}

function motionSignature(motionFp: string, fps: number | null): string {
  return sha256(`${motionFp}:${fps ?? 'unknown'}`).slice(0, 32);
}

export async function generateScreenRecordingDna(
  buffer: Buffer,
  tempPath?: string,
): Promise<ScreenRecordingDnaData | undefined> {
  if (!isPhase2Active() || !dnaPhase2.screenRecording) return undefined;

  const video = await generateVideoDna(buffer);
  const audio = await generateAudioDna(buffer, tempPath);
  const fps = await probeVideoFps(buffer);
  const likelihood = await detectScreenRecordingFromVideo(buffer);

  const keyframes = video?.keyframeHashes ?? [];
  const motionFp = video?.motionFingerprint ?? sha256(buffer.slice(0, 8192)).slice(0, 32);

  return {
    frameSequenceFingerprint: keyframes.length
      ? sha256(keyframes.join(':')).slice(0, 32)
      : undefined,
    audioFingerprint: audio?.chromaprint ?? audio?.spectrogramFingerprint,
    motionSignature: motionSignature(motionFp, fps),
    playbackSignature: keyframes.length ? playbackSignature(keyframes) : undefined,
    fpsEstimate: fps ?? undefined,
    recordingLikelihood: likelihood,
  };
}

export function verifyScreenRecordingDna(
  probe: ScreenRecordingDnaData,
  stored: ScreenRecordingDnaData,
): number {
  const scores: number[] = [];
  if (probe.frameSequenceFingerprint && stored.frameSequenceFingerprint) {
    scores.push(probe.frameSequenceFingerprint === stored.frameSequenceFingerprint ? 1 : 0.5);
  }
  if (probe.playbackSignature && stored.playbackSignature) {
    scores.push(hammingLoose(probe.playbackSignature, stored.playbackSignature));
  }
  if (probe.motionSignature && stored.motionSignature) {
    scores.push(probe.motionSignature === stored.motionSignature ? 1 : 0.45);
  }
  if (probe.audioFingerprint && stored.audioFingerprint) {
    scores.push(probe.audioFingerprint === stored.audioFingerprint ? 1 : 0.4);
  }
  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function hammingLoose(a: string, b: string): number {
  const min = Math.min(a.length, b.length);
  if (!min) return 0;
  let match = 0;
  for (let i = 0; i < min; i++) if (a[i] === b[i]) match++;
  return match / min;
}
