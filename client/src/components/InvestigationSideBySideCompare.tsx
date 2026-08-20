import { useEffect, useState } from 'react';
import { ImageIcon, FileWarning, Loader2, ShieldCheck } from 'lucide-react';
import { retrieveFromVault } from '../services/dashboard.api';
import { cn } from './ui/utils';

export interface InvestigationSideBySideCompareProps {
  vaultId?: string | null;
  probePreviewUrl?: string | null;
  probeFileName?: string;
  probeMimeType?: string;
  originalFilename?: string | null;
  ownerPinitId?: string | null;
  dnaMatchPercent?: number;
  /** Retrieval / ownership confidence when 15-layer DNA is incomplete */
  matchConfidence?: number;
  dnaRecordId?: string | null;
  certificateId?: string | null;
  reportState?: 'VERIFIED' | 'POSSIBLE' | 'NO_SIGNATURE';
  differenceHeatmapBase64?: string | null;
  modifiedPercent?: number | null;
  insertedRegions?: number | null;
  cropSharedPercent?: number | null;
  cropMissingPercent?: number | null;
  cropVisiblePercent?: number | null;
}

function isImageMime(mime?: string | null): boolean {
  return !!mime && mime.startsWith('image/');
}

function guessImageFromName(name?: string | null): boolean {
  if (!name) return false;
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?|jfif)$/i.test(name);
}

function isVideoMime(mime?: string | null): boolean {
  return !!mime && mime.startsWith('video/');
}

function guessVideoFromName(name?: string | null): boolean {
  if (!name) return false;
  return /\.(mp4|webm|mov|avi|mkv|m4v|mpeg|mpg)$/i.test(name);
}

function FilePlaceholder({
  label,
  filename,
  sub,
  variant,
}: {
  label: string;
  filename?: string;
  sub?: string;
  variant: 'original' | 'suspect';
}) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center gap-2 p-8 rounded-xl border border-dashed min-h-[200px]',
      variant === 'original' ? 'border-dna-500/30 bg-dna-500/5' : 'border-yellow-500/30 bg-yellow-500/5',
    )}>
      <FileWarning size={32} className={variant === 'original' ? 'text-dna-400' : 'text-yellow-400'} />
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="text-sm text-white text-center break-all px-2">{filename ?? 'Unknown file'}</p>
      {sub && <p className="text-2xs text-gray-500 text-center">{sub}</p>}
    </div>
  );
}

function ComparePanel({
  title,
  badge,
  badgeClass,
  mediaUrl,
  mediaKind,
  filename,
  meta,
  footer,
  variant,
}: {
  title: string;
  badge: string;
  badgeClass: string;
  mediaUrl?: string | null;
  mediaKind?: 'image' | 'video';
  filename?: string;
  meta: Array<{ label: string; value?: string | null }>;
  footer?: React.ReactNode;
  variant: 'original' | 'suspect';
}) {
  const showMedia = !!mediaUrl;

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden flex flex-col',
      variant === 'original' ? 'border-dna-500/25 bg-dna-500/5' : 'border-yellow-500/25 bg-yellow-500/5',
    )}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-bg-border/50">
        <span className="text-xs font-bold text-white">{title}</span>
        <span className={cn('text-2xs font-bold px-2 py-0.5 rounded-full border', badgeClass)}>{badge}</span>
      </div>

      <div className="p-3 flex-1 flex flex-col gap-3">
        {showMedia ? (
          <div className="relative rounded-lg overflow-hidden bg-black/40 aspect-[4/3] flex items-center justify-center">
            {mediaKind === 'video' ? (
              <video
                src={mediaUrl!}
                className="max-w-full max-h-[280px] object-contain"
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                src={mediaUrl!}
                alt={filename ?? title}
                className="max-w-full max-h-[280px] object-contain"
              />
            )}
          </div>
        ) : (
          <FilePlaceholder label={title} filename={filename} variant={variant} />
        )}

        <dl className="space-y-1 text-2xs">
          {meta.map(({ label, value }) => (
            value ? (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-gray-500 shrink-0">{label}</dt>
                <dd className="text-white mono text-right truncate">{value}</dd>
              </div>
            ) : null
          ))}
        </dl>
        {footer}
      </div>
    </div>
  );
}

export function InvestigationSideBySideCompare({
  vaultId,
  probePreviewUrl,
  probeFileName,
  probeMimeType,
  originalFilename,
  ownerPinitId,
  dnaMatchPercent,
  matchConfidence,
  dnaRecordId,
  certificateId,
  reportState,
  differenceHeatmapBase64,
  modifiedPercent,
  insertedRegions,
  cropSharedPercent,
  cropMissingPercent,
  cropVisiblePercent,
}: InvestigationSideBySideCompareProps) {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [originalMime, setOriginalMime] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const probeIsImage = isImageMime(probeMimeType) || guessImageFromName(probeFileName);
  const probeIsVideo = isVideoMime(probeMimeType) || guessVideoFromName(probeFileName);

  useEffect(() => {
    if (!vaultId) {
      setOriginalUrl(null);
      setLoadState('idle');
      return;
    }

    let objectUrl: string | null = null;
    setLoadState('loading');

    retrieveFromVault(vaultId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setOriginalUrl(objectUrl);
        setOriginalMime(blob.type || null);
        setLoadState('ready');
      })
      .catch(() => {
        setOriginalUrl(null);
        setLoadState('error');
      });

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vaultId]);

  const originalIsImage = isImageMime(originalMime) || guessImageFromName(originalFilename);
  const originalIsVideo = isVideoMime(originalMime) || guessVideoFromName(originalFilename);

  if (!vaultId && !probePreviewUrl) return null;

  const headlineScore = matchConfidence ?? dnaMatchPercent;
  const scoreHeadline = reportState === 'VERIFIED'
    ? `${headlineScore}% DNA match`
    : reportState === 'POSSIBLE'
      ? `${headlineScore}% similarity — needs review`
      : headlineScore != null
        ? `${headlineScore}% similarity`
        : null;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-dna-500/15 flex items-center justify-center">
          <ImageIcon size={16} className="text-dna-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Visual Comparison — Original vs Suspect</h2>
          <p className="text-2xs text-gray-500">
            Side-by-side vault original and uploaded probe — no need to open Vault Explorer
          </p>
        </div>
        {scoreHeadline && (
          <span className={cn(
            'ml-auto text-xs font-bold mono',
            reportState === 'VERIFIED' ? 'text-dna-400' : 'text-gray-300',
          )}>
            {scoreHeadline}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ComparePanel
          title="Original (Vault)"
          badge={reportState === 'VERIFIED' ? 'AUTHORITATIVE' : 'TOP CANDIDATE'}
          badgeClass={reportState === 'VERIFIED'
            ? 'border-dna-500/40 text-dna-400 bg-dna-500/10'
            : 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10'}
          mediaUrl={originalIsImage || originalIsVideo ? originalUrl : null}
          mediaKind={originalIsVideo ? 'video' : 'image'}
          filename={originalFilename ?? undefined}
          variant="original"
          meta={[
            { label: 'Owner', value: ownerPinitId ?? null },
            { label: 'Vault ID', value: vaultId ? `${vaultId.slice(0, 8)}…` : null },
            { label: 'DNA ID', value: dnaRecordId ? `${dnaRecordId.slice(0, 8)}…` : null },
            { label: 'Certificate', value: certificateId ? `${certificateId.slice(0, 12)}…` : null },
          ]}
          footer={
            loadState === 'loading' ? (
              <div className="flex items-center gap-2 text-2xs text-gray-500">
                <Loader2 size={12} className="animate-spin" /> Loading vault original…
              </div>
            ) : loadState === 'error' ? (
              <p className="text-2xs text-yellow-400">Could not load preview — open Vault Explorer to view asset</p>
            ) : (
              <div className="flex items-center gap-1 text-2xs text-green-400">
                <ShieldCheck size={12} />
                {reportState === 'VERIFIED' ? 'Stored in your vault' : 'Top candidate vault — review recommended'}
              </div>
            )
          }
        />

        <ComparePanel
          title="Suspect / Probe"
          badge="UNDER INVESTIGATION"
          badgeClass="border-yellow-500/40 text-yellow-400 bg-yellow-500/10"
          mediaUrl={probeIsImage || probeIsVideo ? probePreviewUrl : null}
          mediaKind={probeIsVideo ? 'video' : 'image'}
          filename={probeFileName}
          variant="suspect"
          meta={[
            { label: 'Probe file', value: probeFileName },
            { label: 'Type', value: probeMimeType ?? (probeIsImage ? 'image' : 'file') },
          ]}
          footer={
            (dnaMatchPercent != null || matchConfidence != null) ? (
              <p className="text-2xs text-gray-400">
                {typeof dnaMatchPercent === 'number' && dnaMatchPercent >= 40 ? (
                  <>
                    Match score:{' '}
                    <span className={cn(
                      'font-bold',
                      reportState === 'VERIFIED' ? 'text-white' : 'text-dna-400',
                    )}>
                      {dnaMatchPercent}%
                    </span>
                    {reportState === 'POSSIBLE' && (
                      <span className="text-gray-500"> — crop/compress possible; review recommended</span>
                    )}
                  </>
                ) : (
                  <>
                    Live retrieval:{' '}
                    <span className="font-bold text-dna-400">{matchConfidence ?? dnaMatchPercent}%</span>
                    {reportState === 'POSSIBLE' && (
                      <span className="text-gray-500"> — ownership not fully verified yet</span>
                    )}
                  </>
                )}
              </p>
            ) : undefined
          }
        />
      </div>

      {(differenceHeatmapBase64 || modifiedPercent != null || insertedRegions != null
        || cropSharedPercent != null || cropMissingPercent != null || cropVisiblePercent != null) && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/5 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-bg-border/50">
            <span className="text-xs font-bold text-white">
              {differenceHeatmapBase64 ? 'Difference Heatmap — Original vs Suspect' : 'Difference Analysis — Original vs Suspect'}
            </span>
            {(modifiedPercent != null || insertedRegions != null || cropMissingPercent != null) && (
              <span className="text-2xs text-red-300 font-semibold">
                {modifiedPercent != null
                  ? `Modified ${modifiedPercent}%`
                  : cropMissingPercent != null
                    ? `Changed ${Math.round(cropMissingPercent)}%`
                    : 'Changed regions'}
                {insertedRegions != null ? ` · ${insertedRegions} region(s)` : ''}
              </span>
            )}
          </div>
          <div className="p-3 space-y-2">
            {differenceHeatmapBase64 ? (
              <>
                <div className="rounded-lg overflow-hidden border border-red-500/30 bg-black">
                  <img
                    src={`data:image/png;base64,${differenceHeatmapBase64}`}
                    alt="Difference heatmap between original and suspect"
                    className="w-full max-h-72 object-contain"
                  />
                </div>
                <p className="text-2xs text-gray-400">
                  Red/orange areas show regions that differ from the vault original after alignment. Dark areas are unchanged.
                </p>
              </>
            ) : (
              <div className="rounded-lg border border-orange-500/25 bg-orange-500/8 p-3">
                <p className="text-xs font-semibold text-orange-300 mb-1">Heatmap unavailable for this comparison</p>
                <p className="text-2xs text-gray-400">
                  The forensic engine still measured how much of the image changed, but it did not return a pixel overlay for this run.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-2xs">
              {modifiedPercent != null && (
                <div className="rounded-lg border border-bg-border bg-bg-base/40 p-2">
                  <p className="text-gray-500">Modified region</p>
                  <p className="text-white font-semibold">{modifiedPercent}%</p>
                </div>
              )}
              {cropSharedPercent != null && (
                <div className="rounded-lg border border-bg-border bg-bg-base/40 p-2">
                  <p className="text-gray-500">Shared with original</p>
                  <p className="text-white font-semibold">{Math.round(cropSharedPercent)}%</p>
                </div>
              )}
              {cropMissingPercent != null && (
                <div className="rounded-lg border border-bg-border bg-bg-base/40 p-2">
                  <p className="text-gray-500">Missing / cropped</p>
                  <p className="text-white font-semibold">{Math.round(cropMissingPercent)}%</p>
                </div>
              )}
              {cropVisiblePercent != null && (
                <div className="rounded-lg border border-bg-border bg-bg-base/40 p-2">
                  <p className="text-gray-500">Visible portion</p>
                  <p className="text-white font-semibold">{Math.round(cropVisiblePercent)}%</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
