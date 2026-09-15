import { CheckCircle } from 'lucide-react';
import { PixelSourceOverlay } from './PixelSourceOverlay';

interface CompositionLabel {
  key: 'protected' | 'ai' | 'other';
  label: string;
  percent: number;
  color: string;
}

interface RegionCard {
  id?: string;
  type: string;
  sourceVaultId?: string;
  forensicState?: string;
  presentationColor?: string;
  provenanceStatus?: string;
  spatialCorrespondence?: string;
  uploadedBounds: { x: number; y: number; width: number; height: number };
  vaultBounds?: { x: number; y: number; width: number; height: number };
  transformation?: { labels?: string[]; scale?: number | null; rotationDeg?: number | null };
  ransacInliers?: number;
  matchedFeatures?: number;
  pixelSimilarity?: number | null;
  dnaVerification?: string;
  confidence: number;
  coveragePercent: number;
  evidenceRadius?: number;
}

interface ImageCompositionBreakdown {
  protectedFromAssetPercent: number;
  aiGeneratedPercent: number;
  otherPercent: number;
  originalUsedPercent: number | null;
  nonVaultPercent?: number;
  aiSuspectedPercent?: number | null;
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
  dnaRecordId?: string;
  certificateId?: string;
  howWeKnow?: {
    narrative: string;
    vaultId?: string;
    dnaRecordId?: string;
    certificateId?: string;
  };
  candidateSources?: Array<{ vaultId: string; filename?: string; dnaRecordId?: string; localScore: number; coveragePercent?: number }>;
  pixelSource?: {
    originalPixels: number;
    aiSuspectedPixels: number;
    unknownPixels: number;
    totalPixels: number;
    homographyVaultToProbe?: number[] | null;
    evidenceRadius?: number;
    transformation?: { labels?: string[]; scale?: number | null; rotationDeg?: number | null };
    regions?: RegionCard[];
    method?: string;
  };
}

interface Props {
  composition: ImageCompositionBreakdown;
  previewUrl?: string | null;
}

const LEGEND = [
  { color: '#10B981', title: 'GREEN', detail: 'Protected Vault content' },
  { color: '#F59E0B', title: 'ORANGE', detail: 'Confident non-Vault in a mapped region (not automatically AI)' },
  { color: '#94A3B8', title: 'GREY', detail: 'Unknown / insufficient evidence' },
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
        <p className="text-2xs text-gray-600 mt-1">
          1×1 localization of the upload. Green pixels are classified from a mapped, authenticated region — a pixel does not contain a Vault ID by itself.
        </p>
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
              evidenceRadius={pix?.evidenceRadius}
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
        <p className="text-amber-400">Non-Vault: {composition.nonVaultPercent ?? composition.aiGeneratedPercent}%</p>
        <p className="text-slate-400">Unknown: {composition.otherPercent}%</p>
        {composition.aiSuspectedPercent != null && (
          <p className="text-orange-300/80">AI detector (separate): {composition.aiSuspectedPercent}% — not Vault coverage</p>
        )}
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

      {composition.howWeKnow && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-2xs text-gray-400 space-y-1">
          <p className="font-semibold text-gray-200">How do we know this is ours?</p>
          <p className="leading-relaxed">{composition.howWeKnow.narrative}</p>
        </div>
      )}

      {composition.candidateSources && composition.candidateSources.length > 0 && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
          <p className="font-semibold text-white mb-1">Multiple Vault sources identified separately</p>
          <p className="text-2xs text-sky-200/80 mb-1">Primary: {composition.vaultFilename ?? composition.vaultId?.slice(0, 8)}</p>
          {composition.candidateSources.map((s) => (
            <p key={s.vaultId} className="text-2xs">
              {s.filename ?? s.vaultId.slice(0, 8)} · score {Math.round(s.localScore)}
              {s.coveragePercent != null ? ` · ~${Math.round(s.coveragePercent)}% of upload` : ''}
              {s.dnaRecordId ? ` · DNA ${s.dnaRecordId.slice(0, 8)}` : ''}
            </p>
          ))}
        </div>
      )}
      {pix?.regions && pix.regions.length > 0 && (
        <div className="space-y-2">
          {pix.regions.slice(0, 8).map((r, i) => (
            <details key={r.id ?? i} className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2 text-2xs text-gray-400">
              <summary className="cursor-pointer font-semibold text-gray-200">
                Why is this classified as Vault-origin? · {r.id ?? `Region #${i + 1}`}
                {r.forensicState ? ` · ${r.forensicState}` : ''}
                {r.presentationColor ? ` (${r.presentationColor})` : ''}
              </summary>
              <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                <div>Vault:{' '}
                  <span className="text-gray-200">
                    {composition.candidateSources?.find((s) => s.vaultId === r.sourceVaultId)?.filename
                      ?? (r.sourceVaultId === composition.vaultId ? composition.vaultFilename : null)
                      ?? composition.vaultFilename
                      ?? '—'}
                  </span>
                </div>
                <div>Vault ID: <span className="text-gray-200">{r.sourceVaultId ?? composition.vaultId ?? '—'}</span></div>
                <div>DNA Record: <span className="text-gray-200">{composition.dnaRecordId ?? '—'}</span></div>
                <div>Certificate: <span className="text-gray-200">{composition.certificateId ?? '—'}</span></div>
                <div>PinIT provenance: <span className="text-gray-200">{r.provenanceStatus ?? 'NOT DETECTED'}</span></div>
                <div>Spatial correspondence: <span className="text-gray-200">{r.spatialCorrespondence ?? 'NOT VERIFIED'}</span></div>
                <div>
                  Source coordinates:{' '}
                  <span className="text-gray-200">
                    {r.vaultBounds
                      ? `x=${r.vaultBounds.x} y=${r.vaultBounds.y} ${r.vaultBounds.width}×${r.vaultBounds.height}`
                      : '—'}
                  </span>
                </div>
                <div>
                  Suspect coordinates:{' '}
                  <span className="text-gray-200">
                    x={r.uploadedBounds.x} y={r.uploadedBounds.y} {r.uploadedBounds.width}×{r.uploadedBounds.height}
                  </span>
                </div>
                <div>
                  Transformation:{' '}
                  <span className="text-gray-200">
                    {(r.transformation?.labels ?? pix.transformation?.labels ?? ['unknown']).join(' + ')}
                    {r.transformation?.scale != null ? ` · scale ${r.transformation.scale}` : ''}
                    {r.transformation?.rotationDeg != null ? ` · rot ${r.transformation.rotationDeg}°` : ''}
                  </span>
                </div>
                <div>Feature matches: <span className="text-gray-200">{r.matchedFeatures ?? '—'}</span></div>
                <div>RANSAC inliers: <span className="text-gray-200">{r.ransacInliers ?? '—'}</span></div>
                <div>
                  Pixel similarity:{' '}
                  <span className="text-gray-200">
                    {r.pixelSimilarity != null ? `${Math.round(r.pixelSimilarity * 1000) / 10}%` : '—'}
                  </span>
                </div>
                <div>DNA verification: <span className="text-gray-200">{r.dnaVerification ?? 'NOT VERIFIED'}</span></div>
                <div>Evidence radius: <span className="text-gray-200">{r.evidenceRadius ?? pix.evidenceRadius ?? 16}px</span></div>
                <div>Confidence: <span className="text-gray-200">{Math.round(r.confidence * 1000) / 10}%</span></div>
                <div>Coverage: <span className="text-gray-200">{r.coveragePercent}%</span></div>
                <div>Internal state: <span className="text-gray-200">{r.forensicState ?? 'UNKNOWN'}</span></div>
              </dl>
            </details>
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
