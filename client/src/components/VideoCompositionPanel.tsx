import { useMemo, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { PixelSourceOverlay } from './PixelSourceOverlay';

interface ImageCompositionBreakdownLite {
  protectedFromAssetPercent: number;
  otherPercent: number;
  originalUsedPercent: number | null;
  overlayPngBase64?: string;
  maskPngBase64?: string;
  pixelSource?: {
    homographyVaultToProbe?: number[] | null;
    evidenceRadius?: number;
  };
}

interface VideoCompositionFramePoint {
  probeIndex: number;
  tMs: number;
  matchedFrameDnaRecordId: string | null;
  breakdown: ImageCompositionBreakdownLite | null;
  probeFrameJpegBase64?: string;
}

interface VideoCompositionTimelineSegment {
  tStartMs: number;
  tEndMs: number;
  sourceVaultId: string | null;
  sourceFilename: string | null;
  matchedFrameDnaRecordId: string | null;
  protectedFromAssetPercent: number;
  otherPercent: number;
}

interface VideoCompositionResult {
  vaultId: string;
  vaultDnaRecordId: string;
  vaultFilename: string;
  probeDurationMs: number;
  framesSampled: number;
  framesMatched: number;
  overall: {
    protectedFromAssetPercent: number;
    otherPercent: number;
    originalUsedPercent: number | null;
  };
  timeline: VideoCompositionTimelineSegment[];
  perFrame: VideoCompositionFramePoint[];
}

interface Props {
  videoComposition: VideoCompositionResult;
}

const LEGEND = [
  { color: '#10B981', title: 'GREEN', detail: 'Time range matched to a protected Vault frame' },
  { color: '#94A3B8', title: 'GREY', detail: 'No vault match found for this time range' },
] as const;

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VideoCompositionPanel({ videoComposition }: Props) {
  const { overall, timeline, perFrame, probeDurationMs, vaultFilename, framesSampled, framesMatched } = videoComposition;

  const [selectedIndex, setSelectedIndex] = useState<number | null>(() => {
    const firstMatch = timeline.findIndex((s) => s.sourceVaultId);
    return firstMatch >= 0 ? firstMatch : (timeline.length ? 0 : null);
  });

  const selectedSegment = selectedIndex != null ? timeline[selectedIndex] ?? null : null;
  const selectedFrame = useMemo(() => {
    if (!selectedSegment) return null;
    return perFrame.find((p) => p.tMs >= selectedSegment.tStartMs && p.tMs <= selectedSegment.tEndMs) ?? null;
  }, [selectedSegment, perFrame]);

  const majority = overall.protectedFromAssetPercent >= 50;

  return (
    <div className="card border border-bg-border p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold tracking-wide text-gray-100 uppercase">Video pixel-level vault source timeline</h3>
        <p className="text-2xs text-gray-500 mt-1">
          Sampled at {framesSampled} points across the timeline · {framesMatched} matched to a protected vault frame.
        </p>
        <p className="text-2xs text-gray-600 mt-1">
          Each segment is an independently pixel-authenticated frame — a frame does not contain a Vault ID by itself.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {LEGEND.map((item) => (
          <div key={item.title} className="flex items-start gap-2 rounded-lg border border-bg-border bg-bg-elevated px-2.5 py-2">
            <span className="mt-0.5 w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
            <div>
              <p className="text-2xs font-semibold text-gray-200 leading-tight">{item.title}</p>
              <p className="text-2xs text-gray-500 leading-tight">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2 text-xs space-y-1">
        <p className="text-gray-200">
          Vault video: <span className="font-semibold text-white">{vaultFilename}</span>
        </p>
        <p className="text-emerald-400">Vault-sourced content: {overall.protectedFromAssetPercent}%</p>
        <p className="text-slate-400">Own / unrecognized content: {overall.otherPercent}%</p>
        {overall.originalUsedPercent != null && (
          <p className="text-teal-400">Used from your protected video: {overall.originalUsedPercent}%</p>
        )}
      </div>

      <div>
        <p className="text-2xs text-gray-400 mb-1.5">Timeline breakdown (click a segment)</p>
        {timeline.length > 0 ? (
          <div className="flex h-5 rounded-full overflow-hidden bg-bg-elevated border border-bg-border">
            {timeline.map((seg, i) => {
              const widthPercent = probeDurationMs > 0
                ? Math.max(0, ((seg.tEndMs - seg.tStartMs) / probeDurationMs) * 100)
                : 100 / timeline.length;
              const color = seg.sourceVaultId ? '#10B981' : '#94A3B8';
              return (
                <button
                  key={`${seg.tStartMs}-${i}`}
                  type="button"
                  onClick={() => setSelectedIndex(i)}
                  title={`${formatTime(seg.tStartMs)}–${formatTime(seg.tEndMs)} · ${
                    seg.sourceVaultId ? `${seg.protectedFromAssetPercent}% vault-sourced` : 'no vault match'
                  }`}
                  style={{ width: `${widthPercent}%`, backgroundColor: color, opacity: selectedIndex === i ? 1 : 0.7 }}
                  className="h-full border-r border-black/20 last:border-r-0 hover:opacity-100 transition-opacity"
                />
              );
            })}
          </div>
        ) : (
          <p className="text-2xs text-gray-500">No timeline segments available.</p>
        )}
        <div className="flex justify-between mt-1">
          <span className="text-2xs text-gray-500">{formatTime(0)}</span>
          <span className="text-2xs text-gray-500">{formatTime(probeDurationMs)}</span>
        </div>
      </div>

      {selectedSegment && (
        <div className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2 space-y-2">
          <p className="text-2xs text-gray-300 font-semibold">
            {formatTime(selectedSegment.tStartMs)} – {formatTime(selectedSegment.tEndMs)}
            {selectedSegment.sourceVaultId ? ' · matched to protected vault frame' : ' · no vault match in this range'}
          </p>

          {selectedFrame?.probeFrameJpegBase64 ? (
            <div className="relative rounded-lg overflow-hidden border border-bg-border bg-black/20 flex justify-center p-1">
              <PixelSourceOverlay
                imageUrl={`data:image/jpeg;base64,${selectedFrame.probeFrameJpegBase64}`}
                overlayPngBase64={selectedFrame.breakdown?.overlayPngBase64}
                maskPngBase64={selectedFrame.breakdown?.maskPngBase64}
                homographyVaultToProbe={selectedFrame.breakdown?.pixelSource?.homographyVaultToProbe}
                evidenceRadius={selectedFrame.breakdown?.pixelSource?.evidenceRadius}
                alt="Representative probe frame with vault-source overlay"
                maxHeightClass="max-h-72"
              />
            </div>
          ) : (
            <p className="text-2xs text-gray-500">No frame preview available for this range.</p>
          )}

          {selectedFrame?.breakdown && (
            <div className="grid grid-cols-2 gap-2 text-2xs">
              <p className="text-emerald-400">Protected: {selectedFrame.breakdown.protectedFromAssetPercent}%</p>
              <p className="text-slate-400">Unknown: {selectedFrame.breakdown.otherPercent}%</p>
            </div>
          )}
        </div>
      )}

      {majority && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <CheckCircle size={16} className="text-emerald-400 shrink-0" />
          <p className="text-xs font-semibold text-emerald-300">
            Majority of this video's timeline matches the authenticated Vault content.
          </p>
        </div>
      )}
    </div>
  );
}
