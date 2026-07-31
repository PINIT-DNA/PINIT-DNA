/**
 * Resolve PINIT share-link tokens from OCR / visible text.
 * Only returns tokens verified against share_links — never raw 10-char English words.
 */
import { prisma } from '../../lib/prisma';

/** Common 10-char OCR false positives (filenames, UI labels). */
const TOKEN_BLOCKLIST = new Set([
  'screenshot', 'protected', 'smartlinks', 'secureview', 'generation',
  'dashboard', 'monitoring', 'difference', 'intelligence', 'explorer',
  'watermarks', 'downloaded', 'expiresjul', 'localhost', 'chromewin',
]);

/** High-priority patterns — PINIT-specific token placement. */
const PRIORITY_PATTERNS: RegExp[] = [
  /\/link\/([A-Za-z0-9_-]{10})\b/gi,
  /\/s\/([A-Za-z0-9_-]{10})\b/gi,
  /\/f\/m\/([A-Za-z0-9_-]{10})\b/gi,
  /localhost:\d+\/(?:link|s)\/([A-Za-z0-9_-]{10})\b/gi,
  /PINIT[\s-]*DNA[\s·\-·:]*([A-Za-z0-9_-]{10})/gi,
  /Smart\s+Links[\s·\-·]*([A-Za-z0-9_-]{10})/gi,
  /Token:\s*([A-Za-z0-9_-]{10})/gi,
];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

const GENERIC_TOKEN_RE = /\b([A-Za-z0-9_-]{10})\b/g;

function collectCandidates(text: string): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length !== 10 || t.startsWith('WM-')) return;
    if (TOKEN_BLOCKLIST.has(t.toLowerCase())) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(t);
  };

  for (const re of PRIORITY_PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (m[1]) push(m[1]);
    }
  }

  for (const m of text.matchAll(GENERIC_TOKEN_RE)) {
    push(m[1]!);
  }

  return ordered;
}

/** Return the first OCR candidate that exists in share_links. */
export async function resolveShareTokenFromText(text: string): Promise<string | undefined> {
  if (!text.trim()) return undefined;

  for (const token of collectCandidates(text)) {
    const link = await prisma.shareLink.findUnique({
      where: { token },
      select: { token: true },
    });
    if (link) return token;
  }
  return undefined;
}

/** Fallback: match visible filename in OCR against share_links.filename. */
export async function resolveShareLinkByFilenameInText(
  text: string,
): Promise<{ token: string; shareLinkId: string; dnaRecordId: string } | undefined> {
  const fileMatches = [
    ...text.matchAll(/([A-Za-z0-9_()[\]\s-]+\.(pdf|png|jpe?g|webp|docx|xlsx|pptx|txt|csv|zip|mp4|mp3))/gi),
  ];

  const seen = new Set<string>();
  for (const m of fileMatches) {
    const fn = m[1]!.replace(/\s+/g, ' ').trim();
    if (fn.length < 5 || seen.has(fn.toLowerCase())) continue;
    seen.add(fn.toLowerCase());

    const link = await prisma.shareLink.findFirst({
      where: {
        OR: [
          { filename: { equals: fn, mode: 'insensitive' } },
          { filename: { contains: fn.slice(0, Math.min(fn.length, 40)), mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, dnaRecordId: true },
    });
    if (link) {
      return { token: link.token, shareLinkId: link.id, dnaRecordId: link.dnaRecordId };
    }
  }
  return undefined;
}

/** Match upload filename directly against share_links.filename (screenshot saves). */
export async function resolveShareLinkByExactFilename(
  filename: string,
): Promise<{ token: string; shareLinkId: string; dnaRecordId: string } | undefined> {
  const fn = filename.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  if (fn.length < 3) return undefined;

  const link = await prisma.shareLink.findFirst({
    where: { filename: { equals: fn, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, token: true, dnaRecordId: true },
  });
  if (link) {
    return { token: link.token, shareLinkId: link.id, dnaRecordId: link.dnaRecordId };
  }

  // Partial match — handles OCR typos (Kavvam vs Kanwani) and copy suffixes
  const base = fn.replace(/\s*\(\d+\)(?=\.)/, '').trim();
  if (base.length >= 8) {
    const fuzzy = await prisma.shareLink.findFirst({
      where: { filename: { contains: base.slice(0, Math.min(base.length, 30)), mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, dnaRecordId: true },
    });
    if (fuzzy) {
      return { token: fuzzy.token, shareLinkId: fuzzy.id, dnaRecordId: fuzzy.dnaRecordId };
    }
  }
  return undefined;
}

/**
 * Fuzzy fallback: find any known share-link token appearing as substring in OCR text.
 * Handles watermark/footer tokens even when regex boundaries fail.
 */
export async function resolveShareTokenFuzzy(
  text: string,
): Promise<string | undefined> {
  const direct = await resolveShareTokenFromText(text);
  if (direct) return direct;

  if (!text.trim()) return undefined;
  const lower = text.toLowerCase();

  const links = await prisma.shareLink.findMany({
    select: { token: true },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  for (const { token } of links) {
    if (token.length === 10 && lower.includes(token.toLowerCase())) {
      return token;
    }
  }
  return undefined;
}

/**
 * OCR typo fallback — e.g. wKb7VDUBRT vs wKb7VbUbRT (distance ≤ 2).
 */
export async function resolveShareTokenLevenshtein(
  text: string,
  maxDist = 2,
): Promise<string | undefined> {
  const exact = await resolveShareTokenFromText(text);
  if (exact) return exact;

  const candidates = collectCandidates(text);
  if (!candidates.length) return undefined;

  const links = await prisma.shareLink.findMany({
    select: { token: true },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  for (const cand of candidates) {
    if (cand.length !== 10) continue;
    for (const { token } of links) {
      if (token.length !== 10) continue;
      if (levenshtein(cand.toLowerCase(), token.toLowerCase()) <= maxDist) {
        return token;
      }
    }
  }
  return undefined;
}

/** Match share_links.filename when OCR garbles underscores/spelling (Ashwitha + Optum + Resume). */
export async function resolveShareLinkByLooseFilenameInText(
  text: string,
): Promise<{ token: string; shareLinkId: string; dnaRecordId: string } | undefined> {
  const byExact = await resolveShareLinkByFilenameInText(text);
  if (byExact) return byExact;

  const tokens = text
    .replace(/[_\-./\\]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter((w) => w.length >= 4);

  const seen = new Set<string>();
  const significant = tokens.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return !['dashboard', 'token', 'created', 'minutes', 'universal', 'generate'].includes(k);
  });

  if (significant.length < 2) return undefined;

  const links = await prisma.shareLink.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, token: true, dnaRecordId: true, filename: true },
  });

  for (const link of links) {
    const fn = (link.filename ?? '').toLowerCase();
    if (!fn) continue;
    const hits = significant.filter((t) => fn.includes(t.toLowerCase()));
    if (hits.length >= 2 && hits.length >= Math.min(3, significant.length)) {
      return { token: link.token, shareLinkId: link.id, dnaRecordId: link.dnaRecordId };
    }
  }
  return undefined;
}
