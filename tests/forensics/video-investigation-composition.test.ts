import { collapseFramePointsIntoTimeline } from '../../src/services/forensics/video-investigation-composition.service';
import type { VideoCompositionFramePoint } from '../../src/types/video-investigation-composition.types';

function point(over: Partial<VideoCompositionFramePoint> & { tMs: number }): VideoCompositionFramePoint {
  return {
    probeIndex: 0,
    matchedFrameDnaRecordId: null,
    breakdown: null,
    ...over,
  };
}

function matched(tMs: number, protectedFromAssetPercent: number, otherPercent: number, originalUsedPercent: number | null = null): VideoCompositionFramePoint {
  return point({
    tMs,
    matchedFrameDnaRecordId: 'frame-dna-1',
    breakdown: {
      protectedFromAssetPercent,
      aiGeneratedPercent: 0,
      otherPercent,
      originalUsedPercent,
      quantifiable: true,
      estimate: false,
      reason: 'test',
      labels: [],
      aiModelAvailable: false,
    } as VideoCompositionFramePoint['breakdown'],
  });
}

function unmatched(tMs: number): VideoCompositionFramePoint {
  return point({ tMs, matchedFrameDnaRecordId: null, breakdown: null });
}

describe('video composition — timeline collapsing', () => {
  it('tiles the full probe duration with no gaps or overlap', () => {
    const perFrame = [matched(0, 90, 10), matched(1000, 90, 10), matched(2000, 90, 10)];
    const { timeline } = collapseFramePointsIntoTimeline(perFrame, 3000, 'vault.mp4');

    expect(timeline[0]!.tStartMs).toBe(0);
    expect(timeline[timeline.length - 1]!.tEndMs).toBe(3000);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.tStartMs).toBe(timeline[i - 1]!.tEndMs);
    }
  });

  it('collapses consecutive same-source frames into a single run', () => {
    const perFrame = [matched(0, 90, 10), matched(1000, 88, 12), matched(2000, 92, 8)];
    const { timeline } = collapseFramePointsIntoTimeline(perFrame, 3000, 'vault.mp4');

    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.sourceVaultId).toBe('frame-dna-1');
    expect(timeline[0]!.tStartMs).toBe(0);
    expect(timeline[0]!.tEndMs).toBe(3000);
  });

  it('keeps a source change as separate timeline segments', () => {
    const perFrame = [matched(0, 90, 10), matched(1000, 90, 10), unmatched(2000), unmatched(3000)];
    const { timeline } = collapseFramePointsIntoTimeline(perFrame, 4000, 'vault.mp4');

    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.sourceVaultId).toBe('frame-dna-1');
    expect(timeline[1]!.sourceVaultId).toBeNull();
  });

  it('weights overall percentages by segment duration, not a flat per-frame average', () => {
    // One matched frame at t=0, then four unmatched frames tightly clustered near
    // the end (9000-9750ms) of a 10s timeline. A flat per-frame-count average would
    // give the matched frame only 1/5 = 20% weight; duration weighting must instead
    // credit it for the actual timespan its segment tiles (halfway to its nearest
    // neighbor at 9000ms => a 4500ms segment out of 10000ms = 45%), which is more
    // than double the flat-average figure.
    const perFrame: VideoCompositionFramePoint[] = [
      matched(0, 100, 0),
      unmatched(9000),
      unmatched(9250),
      unmatched(9500),
      unmatched(9750),
    ];
    const { overall } = collapseFramePointsIntoTimeline(perFrame, 10000, 'vault.mp4');

    expect(overall.protectedFromAssetPercent).toBe(45);
  });

  it('reports 0% protected / 100% other when nothing matched', () => {
    const perFrame = [unmatched(0), unmatched(1000), unmatched(2000)];
    const { overall, timeline } = collapseFramePointsIntoTimeline(perFrame, 3000, 'vault.mp4');

    expect(overall.protectedFromAssetPercent).toBe(0);
    expect(overall.otherPercent).toBe(100);
    expect(overall.originalUsedPercent).toBeNull();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.sourceVaultId).toBeNull();
  });

  it('averages originalUsedPercent only across frames that report it', () => {
    const perFrame = [matched(0, 90, 10, 40), matched(1000, 90, 10, 60), unmatched(2000)];
    const { overall } = collapseFramePointsIntoTimeline(perFrame, 3000, 'vault.mp4');

    expect(overall.originalUsedPercent).toBe(50);
  });

  it('handles a single frame spanning the whole duration', () => {
    const perFrame = [matched(500, 75, 25)];
    const { timeline, overall } = collapseFramePointsIntoTimeline(perFrame, 1000, 'vault.mp4');

    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.tStartMs).toBe(0);
    expect(timeline[0]!.tEndMs).toBe(1000);
    expect(overall.protectedFromAssetPercent).toBe(75);
  });
});
