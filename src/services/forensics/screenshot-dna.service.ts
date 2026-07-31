/**
 * Phase 2 — Screenshot DNA (UI layout, aspect ratio, screen artifacts).
 */
import sharp from 'sharp';
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import { sha256 } from '../engines/base/text-utils';
import { generateOcrDna } from './ocr-dna.service';
import type { ScreenshotDnaData } from '../../types/dna-enhancements.types';

async function uiLayoutFingerprint(buffer: Buffer): Promise<string> {
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rows = info.height;
  const cols = info.width;
  const rowMeans: number[] = [];
  for (let y = 0; y < rows; y++) {
    let sum = 0;
    for (let x = 0; x < cols; x++) sum += data[y * cols + x] ?? 0;
    rowMeans.push(sum / cols);
  }
  const threshold = rowMeans.reduce((a, b) => a + b, 0) / rowMeans.length;
  const bands = rowMeans.map((m) => (m > threshold ? '1' : '0')).join('');
  return sha256(bands).slice(0, 32);
}

async function fontFingerprint(buffer: Buffer): Promise<string> {
  const edge = await sharp(buffer)
    .greyscale()
    .convolve({ width: 3, height: 3, kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1] })
    .resize(32, 32)
    .raw()
    .toBuffer();
  return sha256(edge).slice(0, 24);
}

async function screenArtifactFingerprint(buffer: Buffer): Promise<string> {
  const meta = await sharp(buffer).metadata();
  const stats = await sharp(buffer).stats();
  const channels = stats.channels.map((c) => `${c.mean?.toFixed(1)}:${c.stdev?.toFixed(1)}`);
  return sha256(`${meta.width}x${meta.height}:${channels.join('|')}`).slice(0, 32);
}

function aspectRatioProfile(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

function estimateScreenshotLikelihood(
  width: number,
  height: number,
  aspect: string,
): number {
  const common = ['16:9', '16:10', '4:3', '9:16', '19.5:9'];
  let score = 0.2;
  if (common.some((r) => aspect.startsWith(r.split(':')[0]!))) score += 0.3;
  if (width >= 720 && height >= 720) score += 0.2;
  if (width % 2 === 0 && height % 2 === 0) score += 0.1;
  return Math.min(1, score);
}

export async function generateScreenshotDna(
  buffer: Buffer,
  mimeType: string,
): Promise<ScreenshotDnaData | undefined> {
  if (!isPhase2Active() || !dnaPhase2.screenshot) return undefined;

  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return undefined;

  const aspect = aspectRatioProfile(width, height);
  const ocr = await generateOcrDna(buffer, mimeType);

  const [uiLayout, font, artifact] = await Promise.all([
    uiLayoutFingerprint(buffer),
    fontFingerprint(buffer),
    screenArtifactFingerprint(buffer),
  ]);

  const scaling = Math.round((width * height) / (1920 * 1080) * 100) / 100;

  return {
    ocrFingerprint: ocr?.ocrSimHash,
    uiLayoutFingerprint: uiLayout,
    aspectRatioProfile: aspect,
    displayScaling: scaling,
    fontFingerprint: font,
    screenArtifactFingerprint: artifact,
    screenshotLikelihood: estimateScreenshotLikelihood(width, height, aspect),
  };
}

export function verifyScreenshotDna(probe: ScreenshotDnaData, stored: ScreenshotDnaData): number {
  const scores: number[] = [];
  if (probe.uiLayoutFingerprint && stored.uiLayoutFingerprint) {
    scores.push(probe.uiLayoutFingerprint === stored.uiLayoutFingerprint ? 1 : 0.55);
  }
  if (probe.aspectRatioProfile && stored.aspectRatioProfile) {
    scores.push(probe.aspectRatioProfile === stored.aspectRatioProfile ? 1 : 0.3);
  }
  if (probe.ocrFingerprint && stored.ocrFingerprint) {
    scores.push(probe.ocrFingerprint === stored.ocrFingerprint ? 1 : 0.5);
  }
  if (probe.fontFingerprint && stored.fontFingerprint) {
    scores.push(probe.fontFingerprint === stored.fontFingerprint ? 1 : 0.45);
  }
  if (probe.screenArtifactFingerprint && stored.screenArtifactFingerprint) {
    scores.push(probe.screenArtifactFingerprint === stored.screenArtifactFingerprint ? 1 : 0.5);
  }
  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
