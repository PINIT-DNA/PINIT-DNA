import { useEffect, useRef, useState, type MouseEvent } from 'react';

const FILL: Record<string, string> = {
  G: 'rgba(16, 185, 129, 0.48)',
  A: 'rgba(245, 158, 11, 0.50)',
  U: 'rgba(148, 163, 184, 0.45)',
};

export interface BlockGrid {
  rows: number;
  cols: number;
  labels: string;
}

export interface BlockDnaPackedHover {
  rows: number;
  cols: number;
  labels: string;
  vaultDnaHex16: string;
  calcDnaHex16: string;
  pixelSimPct: string;
  structSimPct: string;
  dnaOk: string;
}

export interface PixelHint {
  x: number;
  y: number;
}

function allAmber(cols: number, rows: number): BlockGrid {
  return { rows, cols, labels: 'A'.repeat(rows * cols) };
}

export function tessellateRegionGrid(
  region: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number } | null | undefined,
  cols = 36,
  rows = 28,
): BlockGrid {
  if (!region || region.heightPercent < region.widthPercent * 0.9) {
    return allAmber(cols, rows);
  }
  let labels = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = ((c + 0.5) / cols) * 100;
      const cy = ((r + 0.5) / rows) * 100;
      const inside = Boolean(
        region
        && cx >= region.xPercent
        && cx <= region.xPercent + region.widthPercent
        && cy >= region.yPercent
        && cy <= region.yPercent + region.heightPercent,
      );
      labels += inside ? 'G' : 'A';
    }
  }
  return { rows, cols, labels };
}

function codeAt(labels: string, cols: number, r: number, c: number): string {
  const ch = labels[r * cols + c] ?? 'U';
  if (ch === 'G' || ch === 'A' || ch === 'U') return ch;
  return 'U';
}

function slice16(packed: string, i: number): string {
  return packed.slice(i * 16, i * 16 + 16);
}

export interface HoverInfo {
  col: number;
  row: number;
  x: number;
  y: number;
  size: string;
  vaultDna: string;
  calculatedDna: string;
  dnaOk: boolean;
  pixelSimilarity: number;
  structuralSimilarity: number;
  classification: string;
}

interface Props {
  imageUrl: string;
  alt?: string;
  grid: BlockGrid;
  packed?: BlockDnaPackedHover | null;
  blockSize?: number;
  pixelHints?: PixelHint[];
  maxHeightClass?: string;
}

export function BlockMatchOverlay({
  imageUrl,
  alt,
  grid,
  packed,
  blockSize = 8,
  pixelHints,
  maxHeightClass = 'max-h-[28rem]',
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const paint = () => {
      const w = img.clientWidth;
      const h = img.clientHeight;
      if (w < 8 || h < 8) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const cols = Math.max(1, grid.cols);
      const rows = Math.max(1, grid.rows);
      const cw = w / cols;
      const ch = h / rows;
      const cells = grid.labels;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const chCode = codeAt(cells, cols, r, c);
          ctx.fillStyle = FILL[chCode] ?? FILL.U;
          ctx.fillRect(c * cw, r * ch, cw, ch);
          ctx.strokeStyle = 'rgba(255,255,255,0.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(c * cw + 0.5, r * ch + 0.5, Math.max(1, cw - 1), Math.max(1, ch - 1));
        }
      }
      if (pixelHints && img.naturalWidth > 0) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
        for (const p of pixelHints) {
          const px = (p.x / img.naturalWidth) * w;
          const py = (p.y / img.naturalHeight) * h;
          const rw = Math.max(2, w / img.naturalWidth);
          const rh = Math.max(2, h / img.naturalHeight);
          ctx.fillRect(px, py, rw, rh);
        }
      }
    };

    const ro = new ResizeObserver(paint);
    ro.observe(img);
    if (img.complete) paint();
    img.addEventListener('load', paint);
    return () => {
      ro.disconnect();
      img.removeEventListener('load', paint);
    };
  }, [grid.cols, grid.labels, grid.rows, imageUrl, pixelHints]);

  const onMove = (ev: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const cols = Math.max(1, grid.cols);
    const rows = Math.max(1, grid.rows);
    const col = Math.min(cols - 1, Math.max(0, Math.floor((x / rect.width) * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((y / rect.height) * rows)));
    const i = row * cols + col;
    const code = codeAt(grid.labels, cols, row, col);
    const classification = code === 'G' ? 'ORIGINAL' : code === 'A' ? 'MODIFIED / AI-SUSPECTED' : 'UNKNOWN';
    const src = packed && packed.vaultDnaHex16.length >= (i + 1) * 16 ? packed : null;
    setHover({
      col,
      row,
      x: col * blockSize,
      y: row * blockSize,
      size: `${blockSize} × ${blockSize}`,
      vaultDna: src ? slice16(src.vaultDnaHex16, i) : '—',
      calculatedDna: src ? slice16(src.calcDnaHex16, i) : '—',
      dnaOk: src ? src.dnaOk[i] === '1' : code === 'G',
      pixelSimilarity: src ? (src.pixelSimPct.charCodeAt(i) || 0) / 100 : 0,
      structuralSimilarity: src ? (src.structSimPct.charCodeAt(i) || 0) / 100 : 0,
      classification,
    });
  };

  return (
    <div ref={wrapRef} className={`relative inline-block max-w-full ${maxHeightClass}`}>
      <img
        ref={imgRef}
        src={imageUrl}
        alt={alt ?? 'Block-level DNA investigation'}
        className={`block max-w-full ${maxHeightClass} h-auto w-auto`}
      />
      <canvas
        ref={canvasRef}
        className="absolute left-0 top-0 h-full w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div className="absolute left-2 bottom-2 z-10 max-w-[16rem] rounded-lg border border-bg-border bg-black/85 px-2.5 py-2 text-2xs text-gray-200 shadow-lg pointer-events-none">
          <p className="font-semibold text-white">Block: ({hover.x}, {hover.y})</p>
          <p>Size: {hover.size}</p>
          <p className="break-all">Vault DNA: {hover.vaultDna}</p>
          <p className="break-all">Calculated DNA: {hover.calculatedDna}</p>
          <p>DNA: {hover.dnaOk ? '✓ VERIFIED' : '✗ FAILED'}</p>
          <p>Pixel similarity: {(hover.pixelSimilarity * 100).toFixed(2)}%</p>
          <p>Structural similarity: {(hover.structuralSimilarity * 100).toFixed(2)}%</p>
          <p>Classification: {hover.classification}</p>
        </div>
      )}
    </div>
  );
}
