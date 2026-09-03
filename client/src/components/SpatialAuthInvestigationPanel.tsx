/**
 * Hierarchical spatial tamper investigation UI
 * Overlay on the real photo: 64×64 → 8×8 → 4×4 → 2×2 → 1×1
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3X3, Map as MapIcon, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';

export type SpatialCellStatus = 'AUTHENTIC' | 'TAMPERED' | 'UNKNOWN';

export interface SpatialFineCell {
  cellId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  status: SpatialCellStatus;
}

export interface SpatialHierarchicalBlock {
  blockId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  status: SpatialCellStatus;
  scale: number;
  fineLocalization: {
    cellSize: number;
    localizationClaim: '8x8_cell';
    cells: SpatialFineCell[];
    tamperedCells: SpatialFineCell[];
    gridCols: number;
    gridRows: number;
  } | null;
}

export interface SpatialInvestigationViewModel {
  trusted: boolean;
  localizationClaim: '8x8_cell';
  claimDisclaimer?: string;
  verificationStatus?: string;
  unavailableReason?: string;
  stats?: {
    imageWidth: number;
    imageHeight: number;
    totalPixels: number;
    total64x64Blocks: number;
    tampered64x64Blocks: number;
    total8x8Cells: number;
    tampered8x8Cells: number;
    tamperedAreaPixels: number;
    tamperedAreaPercentage: number;
    numberOfRegions: number;
    localizationClaim: '8x8_cell';
    largestRegion?: {
      regionId: number;
      width: number;
      height: number;
      blocks: number;
      cells: number;
      areaPixels: number;
    } | null;
  } | null;
  hierarchicalBlocks?: SpatialHierarchicalBlock[];
  regions?: Array<{
    regionId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    tampered64x64Blocks: number;
    tampered8x8Cells: number;
    affectedAreaPixels: number;
    affectedAreaPercentage: number;
  }>;
  overlay?: {
    imageWidth: number;
    imageHeight: number;
    localizationClaim: '8x8_cell';
    coarseRects: Array<{ x: number; y: number; width: number; height: number; status: SpatialCellStatus; blockId?: number }>;
    fineRects: Array<{ x: number; y: number; width: number; height: number; status: SpatialCellStatus; cellId?: number }>;
    colors?: { AUTHENTIC: string; TAMPERED: string; UNKNOWN: string };
    note?: string;
  } | null;
}

/** Compact hierarchy from Investigate API (4×4 / 2×2 / 1×1) */
export interface SpatialHierarchyViewModel {
  productionClaim?: string;
  status?: string;
  tampered?: boolean;
  blocksFailed?: number;
  fine8x8?: {
    cellsFailed?: number;
    cellsPassed?: number;
    tamperedAreaPercentage?: number;
  } | null;
  quad4?: {
    trusted?: boolean;
    cellsFailed?: number;
    cellsPassed?: number;
    unavailableReason?: string | null;
    tamperedRects?: Array<{ x: number; y: number; width: number; height: number; status?: string; cellId?: number }>;
  } | null;
  quad2?: {
    trusted?: boolean;
    cellsFailed?: number;
    cellsPassed?: number;
    unavailableReason?: string | null;
    tamperedRects?: Array<{ x: number; y: number; width: number; height: number; status?: string; cellId?: number }>;
  } | null;
  pixel1?: {
    trusted?: boolean;
    localizationClaim?: string;
    pixelsFailed?: number;
    pixelsPassed?: number;
    unavailableReason?: string | null;
    tamperedPixels?: Array<{ x: number; y: number; width?: number; height?: number; status?: string }>;
  } | null;
}

type ViewMode = '64' | '8' | '4' | '2' | '1' | 'regions';

interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
  status: SpatialCellStatus;
}

const STATUS_FILL: Record<SpatialCellStatus, string> = {
  AUTHENTIC: 'rgba(34,197,94,0.12)',
  TAMPERED: 'rgba(239,68,68,0.48)',
  UNKNOWN: 'rgba(148,163,184,0.0)',
};

const STATUS_STROKE: Record<SpatialCellStatus, string> = {
  AUTHENTIC: 'rgba(34,197,94,0.45)',
  TAMPERED: 'rgba(248,113,113,0.95)',
  UNKNOWN: 'rgba(148,163,184,0.0)',
};

/** Magnified crop around one pixel, with a bold red box on the exact tampered cell. */
function PixelZoomCanvas({
  imageUrl,
  x,
  y,
  cropRadius = 14,
  displaySize = 200,
  boxed,
}: {
  imageUrl?: string | null;
  x: number;
  y: number;
  cropRadius?: number;
  displaySize?: number;
  boxed: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = displaySize;
    canvas.height = displaySize;

    if (!imageUrl) {
      ctx.fillStyle = '#0f1623';
      ctx.fillRect(0, 0, displaySize, displaySize);
      return;
    }

    let cancelled = false;
    const cropSize = cropRadius * 2 + 1;
    const sx = Math.max(0, x - cropRadius);
    const sy = Math.max(0, y - cropRadius);
    const scale = displaySize / cropSize;
    const px = (x - sx) * scale;
    const py = (y - sy) * scale;

    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, displaySize, displaySize);
      ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, displaySize, displaySize);
      if (boxed) {
        ctx.fillStyle = 'rgba(239,68,68,0.30)';
        ctx.fillRect(px, py, scale, scale);
        ctx.strokeStyle = 'rgba(239,68,68,1)';
        ctx.lineWidth = 3;
        ctx.strokeRect(px + 1, py + 1, scale - 2, scale - 2);
      }
    };
    img.onerror = () => {
      if (cancelled) return;
      ctx.fillStyle = '#0f1623';
      ctx.fillRect(0, 0, displaySize, displaySize);
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl, x, y, cropRadius, displaySize, boxed]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded-lg border border-bg-border"
      style={{ width: displaySize, height: displaySize, imageRendering: 'pixelated' }}
    />
  );
}

/** Before/after magnified pair for one tampered pixel coordinate. */
function PixelZoomPair({
  x,
  y,
  originalImageUrl,
  suspectImageUrl,
}: {
  x: number;
  y: number;
  originalImageUrl?: string | null;
  suspectImageUrl?: string | null;
}) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 space-y-1.5">
      <p className="text-2xs text-gray-300">
        Pixel (<span className="mono">{x}</span>, <span className="mono">{y}</span>)
      </p>
      <div className="flex gap-2">
        {originalImageUrl && (
          <div className="space-y-1">
            <p className="text-2xs text-gray-500">Original</p>
            <PixelZoomCanvas imageUrl={originalImageUrl} x={x} y={y} boxed={false} />
          </div>
        )}
        <div className="space-y-1">
          <p className="text-2xs text-gray-500">Suspect (tampered)</p>
          <PixelZoomCanvas imageUrl={suspectImageUrl} x={x} y={y} boxed />
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: SpatialCellStatus }) {
  if (status === 'TAMPERED') return <AlertTriangle size={12} className="text-red-400" />;
  if (status === 'AUTHENTIC') return <CheckCircle2 size={12} className="text-emerald-400" />;
  return <HelpCircle size={12} className="text-slate-400" />;
}

function asStatus(s?: string): SpatialCellStatus {
  if (s === 'AUTHENTIC' || s === 'TAMPERED' || s === 'UNKNOWN') return s;
  return 'TAMPERED';
}

export function SpatialAuthInvestigationPanel({
  investigation,
  hierarchy,
  imageUrl,
  originalImageUrl,
  className,
}: {
  investigation: SpatialInvestigationViewModel | null | undefined;
  hierarchy?: SpatialHierarchyViewModel | null;
  /** Suspect / probe image — primary overlay background */
  imageUrl?: string | null;
  /** Optional vault original for side-by-side */
  originalImageUrl?: string | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>('8');

  const tamperedBlocks = useMemo(
    () => (investigation?.hierarchicalBlocks ?? []).filter((b) => b.status === 'TAMPERED'),
    [investigation],
  );

  const selectedBlock = useMemo(() => {
    if (selectedBlockId == null) return null;
    return investigation?.hierarchicalBlocks?.find((b) => b.blockId === selectedBlockId) ?? null;
  }, [investigation, selectedBlockId]);

  const imageW = investigation?.overlay?.imageWidth || investigation?.stats?.imageWidth || 400;
  const imageH = investigation?.overlay?.imageHeight || investigation?.stats?.imageHeight || 400;

  const overlayRects: OverlayRect[] = useMemo(() => {
    if (!investigation?.overlay) return [];
    if (view === '64') {
      return (investigation.overlay.coarseRects ?? [])
        .filter((r) => r.status === 'TAMPERED')
        .map((r) => ({ ...r, status: asStatus(r.status) }));
    }
    if (view === '8') {
      let rects = (investigation.overlay.fineRects ?? [])
        .filter((r) => r.status === 'TAMPERED')
        .map((r) => ({ ...r, status: asStatus(r.status) }));
      if (selectedBlock) {
        rects = rects.filter(
          (r) =>
            !(
              r.x + r.width <= selectedBlock.x ||
              r.x >= selectedBlock.x + selectedBlock.width ||
              r.y + r.height <= selectedBlock.y ||
              r.y >= selectedBlock.y + selectedBlock.height
            ),
        );
      }
      return rects;
    }
    if (view === '4') {
      return (hierarchy?.quad4?.tamperedRects ?? []).map((r) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        status: asStatus(r.status),
      }));
    }
    if (view === '2') {
      return (hierarchy?.quad2?.tamperedRects ?? []).map((r) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        status: asStatus(r.status),
      }));
    }
    if (view === '1') {
      return (hierarchy?.pixel1?.tamperedPixels ?? []).map((p) => ({
        x: p.x,
        y: p.y,
        width: Math.max(1, p.width ?? 1),
        height: Math.max(1, p.height ?? 1),
        status: asStatus(p.status),
      }));
    }
    return [];
  }, [investigation, hierarchy, view, selectedBlock]);

  const viewMeta = useMemo(() => {
    const tabs: Array<{ id: ViewMode; label: string; available: boolean; hint?: string }> = [
      { id: '64', label: '64×64', available: true },
      { id: '8', label: '8×8', available: true },
      {
        id: '4',
        label: '4×4',
        available: !!hierarchy?.quad4,
        hint: hierarchy?.quad4?.unavailableReason ?? (!hierarchy?.quad4 ? 'No 4×4 data' : undefined),
      },
      {
        id: '2',
        label: '2×2',
        available: !!hierarchy?.quad2,
        hint: hierarchy?.quad2?.unavailableReason ?? (!hierarchy?.quad2 ? 'No 2×2 data' : undefined),
      },
      {
        id: '1',
        label: '1×1',
        available: !!hierarchy?.pixel1,
        hint: hierarchy?.pixel1?.unavailableReason ?? (!hierarchy?.pixel1 ? 'No 1×1 data' : undefined),
      },
      { id: 'regions', label: 'Regions', available: true },
    ];
    return tabs;
  }, [hierarchy]);

  const globalMismatch = useMemo(() => {
    const total = investigation?.stats?.total64x64Blocks ?? 0;
    const failed = investigation?.stats?.tampered64x64Blocks ?? 0;
    if (total <= 0) return false;
    return failed / total >= 0.85;
  }, [investigation]);

  const syntheticRegions = useMemo(() => {
    const fromApi = investigation?.regions ?? [];
    if (fromApi.length > 0) return fromApi;
    const coarse = (investigation?.overlay?.coarseRects ?? []).filter((r) => r.status === 'TAMPERED');
    if (coarse.length === 0) return [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;
    for (const r of coarse) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    const area = imageW * imageH;
    return [{
      regionId: 1,
      x: minX === Infinity ? 0 : minX,
      y: minY === Infinity ? 0 : minY,
      width,
      height,
      tampered64x64Blocks: coarse.length,
      tampered8x8Cells: investigation?.stats?.tampered8x8Cells ?? 0,
      affectedAreaPixels: width * height,
      affectedAreaPercentage: area > 0 ? Math.round((width * height * 1000) / area) / 10 : 0,
    }];
  }, [investigation, imageW, imageH]);

  useEffect(() => {
    if (!investigation?.trusted || !investigation.overlay || !canvasRef.current) return;
    if (view === 'regions') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = imageW;
    const h = imageH;
    canvas.width = w;
    canvas.height = h;

    let cancelled = false;
    const bgUrl = imageUrl || originalImageUrl || null;

    const paintOverlay = () => {
      if (cancelled) return;

      // Global mismatch: one clear wash instead of hundreds of overlapping tiny boxes
      if (globalMismatch && (view === '64' || view === '8' || view === '4' || view === '2')) {
        ctx.fillStyle = 'rgba(239,68,68,0.35)';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(248,113,113,1)';
        ctx.lineWidth = Math.max(4, Math.round(Math.min(w, h) * 0.008));
        ctx.strokeRect(2, 2, w - 4, h - 4);
        ctx.fillStyle = 'rgba(15,23,42,0.8)';
        ctx.fillRect(12, 12, Math.min(560, w - 24), 58);
        ctx.fillStyle = '#fecaca';
        ctx.font = `bold ${Math.max(14, Math.round(w * 0.016))}px sans-serif`;
        ctx.fillText('GLOBAL MISMATCH — almost all cells failed', 24, 36);
        ctx.font = `${Math.max(12, Math.round(w * 0.013))}px sans-serif`;
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText('Re-download protected file, edit once, save as PNG (not JPEG)', 24, 56);
        return;
      }

      const minEdge = Math.max(6, Math.round(Math.min(w, h) * 0.008));

      for (const r of overlayRects) {
        if (r.status !== 'TAMPERED') continue;

        if (view === '1') {
          const cx = r.x + 0.5;
          const cy = r.y + 0.5;
          const arm = Math.max(10, minEdge);
          ctx.strokeStyle = 'rgba(250,204,21,0.95)';
          ctx.lineWidth = Math.max(2, Math.round(minEdge / 3));
          ctx.beginPath();
          ctx.moveTo(cx - arm, cy);
          ctx.lineTo(cx + arm, cy);
          ctx.moveTo(cx, cy - arm);
          ctx.lineTo(cx, cy + arm);
          ctx.stroke();
          ctx.fillStyle = 'rgba(239,68,68,0.95)';
          ctx.fillRect(r.x - 2, r.y - 2, 5, 5);
          continue;
        }

        const dw = Math.max(r.width, (view === '2' || view === '4') ? minEdge : r.width);
        const dh = Math.max(r.height, (view === '2' || view === '4') ? minEdge : r.height);
        ctx.fillStyle = STATUS_FILL.TAMPERED;
        ctx.fillRect(r.x, r.y, dw, dh);
        ctx.strokeStyle = STATUS_STROKE.TAMPERED;
        ctx.lineWidth = Math.max(1, Math.round(minEdge / 4));
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, dw - 1, dh - 1);
      }

      if (selectedBlock && (view === '8' || view === '64')) {
        ctx.strokeStyle = 'rgba(56,189,248,0.95)';
        ctx.lineWidth = 3;
        ctx.strokeRect(selectedBlock.x, selectedBlock.y, selectedBlock.width, selectedBlock.height);
      }
    };

    const draw = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, w, h);
      if (!bgUrl) {
        ctx.fillStyle = '#0f1623';
        ctx.fillRect(0, 0, w, h);
        paintOverlay();
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        if (cancelled) return;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        paintOverlay();
      };
      img.onerror = () => {
        if (cancelled) return;
        ctx.fillStyle = '#0f1623';
        ctx.fillRect(0, 0, w, h);
        paintOverlay();
      };
      img.src = bgUrl;
    };

    draw();
    return () => {
      cancelled = true;
    };
  }, [
    investigation,
    imageUrl,
    originalImageUrl,
    view,
    overlayRects,
    selectedBlock,
    imageW,
    imageH,
    globalMismatch,
  ]);

  if (!investigation) return null;

  if (!investigation.trusted) {
    const notEnrolled = /No SpatialAuthPackage/i.test(investigation.unavailableReason ?? '');
    return (
      <div className={`rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2 ${className ?? ''}`}>
        <p className="text-xs font-semibold text-amber-300">
          {notEnrolled ? 'Spatial tags not enrolled for this file' : 'Spatial investigation unavailable'}
        </p>
        <p className="text-2xs text-gray-400">
          {notEnrolled
            ? 'This asset was protected before DNA pixel-level spatial auth was enabled, so there is no 8×8 integrity map to overlay. Protect a new image (or re-enroll) and investigate that copy.'
            : `Status: ${investigation.verificationStatus ?? 'unknown'}. No trusted fine map or overlay.`}
        </p>
        {investigation.unavailableReason && (
          <p className="text-2xs text-gray-500">{investigation.unavailableReason}</p>
        )}
      </div>
    );
  }

  const stats = investigation.stats;
  const pixelList = hierarchy?.pixel1?.tamperedPixels ?? [];

  return (
    <div className={`rounded-xl border border-bg-border bg-bg-elevated p-4 space-y-4 ${className ?? ''}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-gray-200 flex items-center gap-2">
            <MapIcon size={14} className="text-dna-400" />
            Spatial tamper investigation
          </p>
          <p className="text-2xs text-gray-500 mt-1">
            Red = tampered on the photo · public claim remains{' '}
            <span className="text-gray-300">8x8_cell</span>
            {hierarchy?.pixel1?.trusted ? (
              <span className="text-emerald-400/90"> · 1×1 hierarchy available</span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {viewMeta.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.hint}
              disabled={t.id !== 'regions' && t.id !== '64' && t.id !== '8' && !t.available}
              onClick={() => setView(t.id)}
              className={`px-2 py-1 text-2xs rounded-md border ${
                view === t.id
                  ? 'border-dna-500/50 bg-dna-500/15 text-dna-200'
                  : t.available || t.id === 'regions' || t.id === '64' || t.id === '8'
                    ? 'border-bg-border text-gray-400 hover:text-gray-200'
                    : 'border-bg-border text-gray-600 cursor-not-allowed opacity-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {[
            { label: 'Tampered 64×64', value: `${stats.tampered64x64Blocks}/${stats.total64x64Blocks}` },
            { label: 'Tampered 8×8', value: `${stats.tampered8x8Cells}/${stats.total8x8Cells}` },
            {
              label: 'Tampered 4×4',
              value: hierarchy?.quad4
                ? `${hierarchy.quad4.cellsFailed ?? 0}/${(hierarchy.quad4.cellsFailed ?? 0) + (hierarchy.quad4.cellsPassed ?? 0)}`
                : '—',
            },
            {
              label: 'Tampered 2×2',
              value: hierarchy?.quad2
                ? `${hierarchy.quad2.cellsFailed ?? 0}/${(hierarchy.quad2.cellsFailed ?? 0) + (hierarchy.quad2.cellsPassed ?? 0)}`
                : '—',
            },
            {
              label: 'Tampered 1×1',
              value: hierarchy?.pixel1
                ? `${hierarchy.pixel1.pixelsFailed ?? 0}`
                : '—',
            },
            { label: 'Area %', value: `${stats.tamperedAreaPercentage}%` },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-slate-900/80 border border-bg-border px-2 py-1.5">
              <p className="text-2xs text-slate-400">{s.label}</p>
              <p className="text-sm text-white font-semibold">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {globalMismatch && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-2xs text-amber-100 space-y-1">
          <p className="font-semibold text-amber-200">Why everything looks tampered</p>
          <p>
            Spatial baseline must match the <span className="text-white">exact protected download bytes</span>.
            Older downloads were re-watermarked on download (that is fixed now). JPEG re-save also changes
            almost every pixel.
          </p>
          <p className="text-white">
            Do this: Download protected file again → Paint one pixel → Save as PNG → New Investigation.
          </p>
        </div>
      )}

      {view !== 'regions' && (
        <div className="space-y-2">
          <p className="text-2xs text-gray-500">
            {view === '64' && '64×64 blocks overlaid on the suspect photo'}
            {view === '8' && '8×8 cells overlaid on the suspect photo'}
            {view === '4' && (hierarchy?.quad4?.trusted
              ? '4×4 cells under failed 8×8 (lazy hierarchy)'
              : `4×4 unavailable: ${hierarchy?.quad4?.unavailableReason ?? 'not trusted'}`)}
            {view === '2' && (hierarchy?.quad2?.trusted
              ? '2×2 cells under failed 4×4 (lazy hierarchy)'
              : `2×2 unavailable: ${hierarchy?.quad2?.unavailableReason ?? 'not trusted'}`)}
            {view === '1' && (hierarchy?.pixel1?.trusted
              ? '1×1 pixels under failed 2×2 — markers enlarged for visibility'
              : `1×1 unavailable: ${hierarchy?.pixel1?.unavailableReason ?? 'not trusted'}`)}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {originalImageUrl && (
              <div className="space-y-1">
                <p className="text-2xs font-medium text-gray-400">Original (vault)</p>
                <div className="rounded-lg overflow-hidden border border-bg-border bg-black/40">
                  <img
                    src={originalImageUrl}
                    alt="Original"
                    className="w-full max-h-80 object-contain"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-2xs font-medium text-gray-400">
                {/* Only rendered when view !== 'regions', so that case is unreachable here. */}
                Suspect with tamper map ({view === '1' ? '1×1' : `${view}×${view}`})
              </p>
              <div className="rounded-lg overflow-hidden border border-bg-border bg-bg-base">
                <canvas
                  ref={canvasRef}
                  className="w-full max-h-80 object-contain"
                  style={{ imageRendering: view === '1' ? 'auto' : 'pixelated' }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-2xs text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-500/70" /> TAMPERED</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/40" /> photo visible = authentic / unchecked</span>
          </div>
          <p className="text-2xs text-gray-500">
            Highlighted markers: {overlayRects.length}
            {overlayRects[0] && (
              <> · first at ({overlayRects[0].x}, {overlayRects[0].y})</>
            )}
            {globalMismatch && <> · showing global wash (not per-cell boxes)</>}
          </p>
        </div>
      )}

      {view === '64' && (
        <div className="space-y-2">
          <p className="text-2xs font-semibold text-gray-300 flex items-center gap-1">
            <Grid3X3 size={12} /> Click a tampered 64×64 block to zoom into 8×8
          </p>
          {tamperedBlocks.length === 0 ? (
            <p className="text-2xs text-gray-500">No tampered 64×64 blocks.</p>
          ) : (
            <div className="grid gap-2 max-h-40 overflow-auto">
              {tamperedBlocks.map((b) => (
                <button
                  key={b.blockId}
                  type="button"
                  onClick={() => {
                    setSelectedBlockId(b.blockId);
                    setView('8');
                  }}
                  className={`text-left rounded-lg border px-3 py-2 text-2xs ${
                    selectedBlockId === b.blockId
                      ? 'border-sky-500/50 bg-sky-500/10'
                      : 'border-bg-border hover:border-dna-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-200 font-medium">Block {b.blockId}</span>
                    <StatusIcon status={b.status} />
                  </div>
                  <p className="text-gray-500 mt-0.5">
                    ({b.x},{b.y}) · {b.width}×{b.height} · fine cells{' '}
                    {b.fineLocalization?.tamperedCells.length ?? 0}/
                    {b.fineLocalization?.cells.length ?? 0} tampered
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view === '1' && (
        <div className="space-y-2">
          <p className="text-2xs font-semibold text-gray-300">Tampered pixel coordinates (1×1)</p>
          {!hierarchy?.pixel1?.trusted ? (
            <p className="text-2xs text-amber-400/90">
              {hierarchy?.pixel1?.unavailableReason
                ?? '1×1 layer not trusted yet (needs enrolled tags + vault reference).'}
            </p>
          ) : pixelList.length === 0 ? (
            <p className="text-2xs text-gray-500">No failed 1×1 pixels in this run.</p>
          ) : (
            <>
              <p className="text-2xs text-gray-500">
                Magnified crop around each tampered pixel — original vs suspect, exact pixel boxed in red.
              </p>
              <div className="flex flex-wrap gap-2">
                {pixelList.slice(0, 6).map((p, i) => (
                  <PixelZoomPair
                    key={`${p.x}-${p.y}-${i}`}
                    x={p.x}
                    y={p.y}
                    originalImageUrl={originalImageUrl}
                    suspectImageUrl={imageUrl}
                  />
                ))}
              </div>
              {pixelList.length > 6 && (
                <p className="text-2xs text-gray-500">
                  +{pixelList.length - 6} more tampered pixels — see table below.
                </p>
              )}
              <div className="max-h-36 overflow-auto rounded-lg border border-bg-border">
                <table className="w-full text-2xs">
                  <thead className="text-gray-500 bg-bg-base/80 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">#</th>
                      <th className="text-left px-2 py-1">X</th>
                      <th className="text-left px-2 py-1">Y</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pixelList.slice(0, 100).map((p, i) => (
                      <tr key={`${p.x}-${p.y}-${i}`} className="border-t border-bg-border/60 text-gray-300">
                        <td className="px-2 py-1">{i + 1}</td>
                        <td className="px-2 py-1 mono">{p.x}</td>
                        <td className="px-2 py-1 mono">{p.y}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {view === 'regions' && (
        <div className="space-y-2">
          {syntheticRegions.length === 0 ? (
            <p className="text-2xs text-gray-500">No tamper regions to list.</p>
          ) : (
            syntheticRegions.map((r) => (
              <div key={r.regionId} className="rounded-lg border border-bg-border px-3 py-2 text-2xs">
                <p className="text-gray-200 font-medium">Region {r.regionId}</p>
                <p className="text-gray-400 mt-0.5">
                  bbox ({r.x},{r.y}) {r.width}×{r.height} · blocks {r.tampered64x64Blocks} ·
                  8×8 cells {r.tampered8x8Cells} · area {r.affectedAreaPercentage}%
                </p>
              </div>
            ))
          )}
        </div>
      )}

      <p className="text-2xs text-gray-500 border-t border-bg-border pt-2">
        Overlay is drawn on the suspect photo so you can see where changes are.
        Public product claim stays <code className="text-gray-400">8x8_cell</code> until 1×1 is promoted;
        4×4 / 2×2 / 1×1 are hierarchy drill-downs when enrolled and trusted.
      </p>
    </div>
  );
}

export default SpatialAuthInvestigationPanel;
