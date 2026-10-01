function punctuate(line: string): string {
  const s = line.slice(0, 180).trim();
  if (!s) return s;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Exactly two spoken lines. Extra sentences are dropped. */
export function twoLines(raw: string, fallback1: string, fallback2: string): [string, string] {
  const clean = raw.replace(/\s+/g, ' ').replace(/[*#_`]/g, '').trim();
  const parts = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return [punctuate(parts[0] || fallback1), punctuate(parts[1] || fallback2)];
}
