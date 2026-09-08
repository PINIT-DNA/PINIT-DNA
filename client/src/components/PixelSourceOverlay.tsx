import { useEffect, useRef, useState, type MouseEvent } from 'react';

export interface PixelHoverInfo {
  x: number;
  y: number;
  classification: string;
  vaultX?: number;
  vaultY?: number;
  reason?: string;
}

interface Props {
  imageUrl: string;
  overlayPngBase64?: string | null;
  maskPngBase64?: string | null;
  homographyVaultToProbe?: number[] | null;
  alt?: string;
  maxHeightClass?: string;
}

function classFromMask(v: number): { label: string; reason: string } {
  if (v >= 200) return { label: 'ORIGINAL / VAULT', reason: 'Pixel matches aligned vault content' };
  if (v >= 80) return { label: 'AI / NON-VAULT', reason: 'No vault correspondence at this pixel' };
  return { label: 'UNKNOWN', reason: 'Insufficient correspondence' };
}

function invertH(h: number[]): number[] | null {
  if (h.length !== 9) return null;
  const a = h[0]!;
  const b = h[1]!;
  const c = h[2]!;
  const d = h[3]!;
  const e = h[4]!;
  const f = h[5]!;
  const g = h[6]!;
  const i = h[7]!;
  const j = h[8]!;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    (e * j - f * i) / det,
    (c * i - b * j) / det,
    (b * f - c * e) / det,
    (f * g - d * j) / det,
    (a * j - c * g) / det,
    (c * d - a * f) / det,
    (d * i - e * g) / det,
    (b * g - a * i) / det,
    (a * e - b * d) / det,
  ];
  return inv;
}

function applyH(h: number[], x: number, y: number): { x: number; y: number } {
  const z = h[6]! * x + h[7]! * y + h[8]!;
  return {
    x: (h[0]! * x + h[1]! * y + h[2]!) / z,
    y: (h[3]! * x + h[4]! * y + h[5]!) / z,
  };
}

export function PixelSourceOverlay({
  imageUrl,
  overlayPngBase64,
  maskPngBase64,
  homographyVaultToProbe,
  alt,
  maxHeightClass = 'max-h-[28rem]',
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<PixelHoverInfo | null>(null);
  const overlayUrl = overlayPngBase64 ? `data:image/png;base64,${overlayPngBase64}` : null;
  const invH = homographyVaultToProbe ? invertH(homographyVaultToProbe) : null;

  useEffect(() => {
    if (!maskPngBase64) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      maskRef.current = c;
    };
    img.src = `data:image/png;base64,${maskPngBase64}`;
  }, [maskPngBase64]);

  const onMove = (ev: MouseEvent<HTMLDivElement>) => {
    const img = imgRef.current;
    if (!img || img.naturalWidth < 1) return;
    const rect = img.getBoundingClientRect();
    const nx = (ev.clientX - rect.left) / rect.width;
    const ny = (ev.clientY - rect.top) / rect.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) {
      setHover(null);
      return;
    }
    const x = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor(nx * img.naturalWidth)));
    const y = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor(ny * img.naturalHeight)));
    let classification = 'UNKNOWN';
    let reason = 'Insufficient correspondence';
    const mask = maskRef.current;
    if (mask) {
      const mx = Math.min(mask.width - 1, Math.round(nx * mask.width));
      const my = Math.min(mask.height - 1, Math.round(ny * mask.height));
      const ctx = mask.getContext('2d');
      if (ctx) {
        const p = ctx.getImageData(mx, my, 1, 1).data[0] ?? 0;
        const mapped = classFromMask(p);
        classification = mapped.label;
        reason = mapped.reason;
      }
    }
    let vaultX: number | undefined;
    let vaultY: number | undefined;
    if (invH && classification.startsWith('ORIGINAL')) {
      const mapped = applyH(invH, nx * (maskRef.current?.width ?? img.naturalWidth), ny * (maskRef.current?.height ?? img.naturalHeight));
      vaultX = Math.round(mapped.x);
      vaultY = Math.round(mapped.y);
    }
    setHover({ x, y, classification, vaultX, vaultY, reason });
  };

  return (
    <div
      className={`relative inline-block max-w-full ${maxHeightClass}`}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <img
        ref={imgRef}
        src={imageUrl}
        alt={alt ?? 'Pixel-level vault source map'}
        className={`block max-w-full ${maxHeightClass} h-auto w-auto`}
      />
      {overlayUrl && (
        <img
          src={overlayUrl}
          alt=""
          className={`absolute left-0 top-0 w-full h-full object-fill pointer-events-none ${maxHeightClass}`}
        />
      )}
      <canvas ref={canvasRef} className="hidden" />
      {hover && (
        <div className="absolute left-2 bottom-2 z-10 max-w-[16rem] rounded-lg border border-bg-border bg-black/85 px-2.5 py-2 text-2xs text-gray-200 shadow-lg pointer-events-none">
          <p className="font-semibold text-white">Uploaded: ({hover.x}, {hover.y})</p>
          <p>Classification: {hover.classification}</p>
          {hover.vaultX != null && hover.vaultY != null && (
            <p>Vault coordinate: ({hover.vaultX}, {hover.vaultY})</p>
          )}
          <p className="text-gray-400">{hover.reason}</p>
        </div>
      )}
    </div>
  );
}
