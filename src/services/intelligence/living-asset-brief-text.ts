function punctuate(line: string): string {
  const s = line.slice(0, 220).trim();
  if (!s) return s;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Redact ID-like tokens, not ordinary ALL-CAPS headings (SOCIAL, MARKETING, …). */
export function redactSensitiveTokens(text: string): string {
  return text
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[number]')
    .replace(/\b\d{8,}\b/g, '[number]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[id]')
    .replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,}\b/g, '[id]')
    .replace(/[A-Z0-9<]{20,}/g, '[code]');
}

export function looksLikeShreddedBrief(text: string): boolean {
  const ids = (text.match(/\[id\]/gi) || []).length;
  const numbers = (text.match(/\[number\]/gi) || []).length;
  return ids + numbers >= 3;
}

/** Prefer readable sentences over title-case heading soup. */
export function readableExcerpt(text: string, maxChars = 4000): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const sentences = compact.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const good = sentences.filter((s) => {
    const words = s.split(/\s+/).length;
    const hasLower = /[a-z]/.test(s);
    return words >= 8 && (hasLower || words >= 12);
  });
  const pick = (good.length ? good : sentences).slice(0, 8).join(' ');
  return pick.slice(0, maxChars);
}

/** Exactly two spoken lines. Extra sentences are dropped. */
export function twoLines(raw: string, fallback1: string, fallback2: string): [string, string] {
  const clean = raw.replace(/\s+/g, ' ').replace(/[*#_`]/g, '').trim();
  const parts = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return [punctuate(parts[0] || fallback1), punctuate(parts[1] || fallback2)];
}

export type PixelSceneHint = {
  line1: string;
  line2: string;
};

/**
 * Always-on visual sketch from colour and layout — used when vision LLM / CLIP
 * are not configured. Does not name people, cities, or dates.
 */
export function describeFromPixelStats(input: {
  width: number;
  height: number;
  channels: number;
  /** RGB bytes, row-major, typically 64×64. */
  rgb: Buffer;
}): PixelSceneHint {
  const { width, height, rgb } = input;
  const n = Math.max(1, Math.floor(rgb.length / 3));
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let topBlue = 0;
  let topN = 0;
  let botGreen = 0;
  let botN = 0;
  let skin = 0;
  let bright = 0;
  let dark = 0;

  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3] ?? 0;
    const g = rgb[i * 3 + 1] ?? 0;
    const b = rgb[i * 3 + 2] ?? 0;
    rSum += r;
    gSum += g;
    bSum += b;
    const y = Math.floor(i / width);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma > 200) bright += 1;
    if (luma < 40) dark += 1;
    const isSkin = r > 95 && g > 40 && b > 20 && r > g && r > b && (r - g) > 15;
    if (isSkin) skin += 1;
    if (y < height / 3) {
      topN += 1;
      if (b > r + 8 && b > g && b > 90) topBlue += 1;
    }
    if (y > (height * 2) / 3) {
      botN += 1;
      if (g > r + 8 && g > b && g > 70) botGreen += 1;
    }
  }

  const r = rSum / n;
  const g = gSum / n;
  const b = bSum / n;
  const sky = topN ? topBlue / topN : 0;
  const greenery = botN ? botGreen / botN : 0;
  const skinFrac = skin / n;
  const brightFrac = bright / n;
  const darkFrac = dark / n;
  const landscape = width >= height * 1.15;
  const portrait = height >= width * 1.15;

  let kind = 'a photograph';
  if (skinFrac > 0.12) kind = portrait ? 'a portrait photograph' : 'a photograph with a person in the frame';
  else if (sky > 0.28 && greenery > 0.12) kind = 'an outdoor landscape photograph';
  else if (sky > 0.35) kind = 'an outdoor photograph with open sky';
  else if (greenery > 0.22) kind = 'an outdoor photograph with plants and greenery';
  else if (r > 140 && g > 110 && b < 90) kind = 'a warm indoor photograph';
  else if (darkFrac > 0.35 && brightFrac < 0.12) kind = 'a low-light photograph';
  else if (landscape) kind = 'a wide landscape photograph';
  else if (portrait) kind = 'a tall-format photograph';

  const extras: string[] = [];
  if (sky > 0.22) extras.push('a bright sky toward the top');
  if (greenery > 0.15) extras.push('green plants or trees');
  if (b > g + 12 && b > r + 8) extras.push('cool blue tones');
  if (g > r + 10 && g > b + 6) extras.push('natural green colour');
  if (skinFrac > 0.08) extras.push('skin tones in the frame');
  if (brightFrac > 0.28) extras.push('strong daylight');
  const detail = extras.slice(0, 2).join(' and ') || (
    r > g && r > b ? 'warmer colours across the scene' : 'balanced colour across the scene'
  );

  return {
    line1: `I am ${kind}.`,
    line2: `I show ${detail}.`,
  };
}
