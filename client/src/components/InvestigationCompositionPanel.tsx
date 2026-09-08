import { CheckCircle } from 'lucide-react';
import { PixelSourceOverlay } from './PixelSourceOverlay';

interface CompositionLabel {
  key: 'protected' | 'ai' | 'other';
  label: string;
  percent: number;
  color: string;
}

interface ImageCompositionBreakdown {
  protectedFromAssetPercent: number;
  aiGeneratedPercent: number;
  otherPercent: number;
  originalUsedPercent: number | null;
  quantifiable: boolean;
  estimate: boolean;
  reason: string;
  overlayPngBase64?: string;
  maskPngBase64?: string;
  blockGrid?: { rows: number; cols: number; labels: string };
  labels: CompositionLabel[];
  probeRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  vaultRegion?: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
  aiModelAvailable: boolean;
  vaultId?: string;
  vaultFilename?: string;
  pixelSource?: {
    originalPixels: number;
    aiSuspectedPixels: number;
    unknownPixels: number;
    totalPixels: number;
    homographyVaultToProbe?: number[] | null;
    regions?: Array<{
      type: string;
      uploadedBounds: { x: number; y: number; width: number; height: number };
      vaultBounds?: { x: number; y: number; width: number; height: number };
      confidence: number;
      coveragePercent: number;
    }>;
    method?: string;
  };
}

interface Props {
  composition: ImageCompositionBreakdown;
  previewUrl?: string | null;
}

const LEGEND = [
  { color: '#10B981', title: 'GREEN', detail: 'Protected Vault content' },
  { color: '#F59E0B', title: 'ORANGE', detail: 'AI / Non-Vault content' },
  { color: '#94A3B8', title: 'GREY', detail: 'Unknown' },
] as const;

export function InvestigationCompositionPanel({ composition, previewUrl }: Props) {
  const used = composition.originalUsedPercent;
  const majority = composition.protectedFromAssetPercent >= 50;
  const pix = composition.pixelSource;
  const showOverlay = Boolean(previewUrl && (composition.overlayPngBase64 || composition.maskPngBase64));

  return (
    <div className="card border border-bg-border p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold tracking-wide text-gray-100 uppercase">Pixel-level vault source map</h3>
        <p className="text-2xs text-gray-500 mt-1">{composition.reason}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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

      {(showOverlay || previewUrl) && (
        <div className="relative rounded-lg overflow-hidden border border-bg-border bg-black/20 flex justify-center p-1">
          {showOverlay && previewUrl ? (
            <PixelSourceOverlay
              imageUrl={previewUrl}
              overlayPngBase64={composition.overlayPngBase64}
              maskPngBase64={composition.maskPngBase64}
              homographyVaultToProbe={pix?.homographyVaultToProbe}
              alt="Uploaded image with vault-source overlay"
            />
          ) : previewUrl ? (
            <img src={previewUrl} alt="Uploaded file" className="block max-w-full max-h-80 h-auto w-auto" />
          ) : null}
        </div>
      )}
      {showOverlay && (
        <p className="text-2xs text-gray-500 -mt-2">
          Semi-transparent overlay on the upload. Green = vault pixels, orange = non-vault, gray = unknown. Hover a pixel for coordinates. Percentages are pixel coverage, not retrieval similarity.
        </p>
      )}

      <div className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2 text-xs space-y-1">
        <p className="text-gray-200">
          Vault:{' '}
          <span className="font-semibold text-white">{composition.vaultFilename ?? 'Not identified'}</span>
        </p>
        <p className="text-emerald-400">Protected content: {composition.protectedFromAssetPercent}%</p>
        <p className="text-amber-400">AI / Non-Vault: {composition.aiGeneratedPercent}%</p>
        <p className="text-slate-400">Unknown: {composition.otherPercent}%</p>
      </div>

      <div>
        <p className="text-2xs text-gray-400 mb-1.5">Protected content coverage (pixel mask)</p>
        <div className="flex h-3 rounded-full overflow-hidden bg-bg-elevated border border-bg-border">
          {composition.labels.filter((l) => l.percent > 0).map((l) => (
            <div
              key={l.key}
              style={{ width: `${l.percent}%`, backgroundColor: l.color }}
              title={`${l.label}: ${l.percent}%`}
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {composition.labels.map((l) => (
            <div key={l.key} className="text-center">
              <p className="text-lg font-semibold tabular-nums" style={{ color: l.color }}>{l.percent}%</p>
              <p className="text-2xs text-gray-500 leading-tight">{l.label}</p>
            </div>
          ))}
        </div>
      </div>

      {pix && (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 text-2xs text-gray-400">
          <div>Matched vault pixels <span className="text-gray-200 tabular-nums">{pix.originalPixels.toLocaleString()}</span></div>
          <div>Non-vault pixels <span className="text-gray-200 tabular-nums">{pix.aiSuspectedPixels.toLocaleString()}</span></div>
          <div>Unknown pixels <span className="text-gray-200 tabular-nums">{pix.unknownPixels.toLocaleString()}</span></div>
          <div>Total pixels <span className="text-gray-200 tabular-nums">{pix.totalPixels.toLocaleString()}</span></div>
          <div>Vault regions <span className="text-gray-200 tabular-nums">{pix.regions?.length ?? 0}</span></div>
          <div>Method <span className="text-gray-200">{pix.method ?? 'pixel_source'}</span></div>
        </dl>
      )}

      {pix?.regions && pix.regions.length > 0 && (
        <div className="space-y-2">
          {pix.regions.slice(0, 3).map((r, i) => (
            <div key={i} className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2 text-2xs text-gray-400">
              <p className="font-semibold text-gray-200">Region #{i + 1} — vault content</p>
              <p>
                Upload ({r.uploadedBounds.x}, {r.uploadedBounds.y}) {r.uploadedBounds.width}×{r.uploadedBounds.height}
                {r.vaultBounds ? ` · vault (${r.vaultBounds.x}, ${r.vaultBounds.y}) ${r.vaultBounds.width}×${r.vaultBounds.height}` : ''}
              </p>
              <p>Coverage {r.coveragePercent}% · confidence {Math.round(r.confidence * 1000) / 10}%</p>
            </div>
          ))}
        </div>
      )}

      {majority && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <CheckCircle size={16} className="text-emerald-400 shrink-0" />
          <p className="text-xs font-semibold text-emerald-300">
            {composition.reason?.includes('Majority of the image matches')
              ? composition.reason
              : 'Majority of the image matches the authenticated Vault content.'}
          </p>
        </div>
      )}

      {used != null && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-2xs text-gray-400">Used from your protected image</span>
            <span className="text-xs font-semibold tabular-nums text-teal-400">{used}%</span>
          </div>
          <div className="h-2 rounded-full bg-bg-elevated border border-bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${Math.min(100, used)}%` }}
            />
          </div>
          <p className="text-2xs text-gray-500 mt-1">
            Share of the original protected file that appears in this upload — not retrieval confidence.
          </p>
        </div>
      )}
    </div>
  );
}
