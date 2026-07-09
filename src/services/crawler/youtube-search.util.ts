/**
 * YouTube Data API helpers for monitoring connectors.
 */

import axios from 'axios';

export interface YouTubeVideoHit {
  videoId: string;
  title: string;
  description: string;
  channel: string;
  url: string;
}

function apiKey(): string | null {
  const key = (process.env.YOUTUBE_API_KEY ?? '').trim();
  return key || null;
}

export function extractYouTubeVideoId(raw: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] ?? null;
    }
    if (url.pathname.includes('/shorts/')) {
      return url.pathname.split('/shorts/')[1]?.split(/[/?#]/)[0] ?? null;
    }
    return url.searchParams.get('v');
  } catch {
    return null;
  }
}

export function isYouTubeConfigured(): boolean {
  return !!apiKey();
}

export async function getYouTubeVideo(videoId: string): Promise<YouTubeVideoHit | null> {
  const key = apiKey();
  if (!key || !videoId) return null;

  try {
    const { data } = await axios.get<{
      items?: Array<{
        id: string;
        snippet: { title: string; description: string; channelTitle: string };
      }>;
    }>('https://www.googleapis.com/youtube/v3/videos', {
      params: { key, part: 'snippet', id: videoId },
      timeout: 15_000,
    });

    const item = data.items?.[0];
    if (!item) return null;

    return {
      videoId: item.id,
      title: item.snippet.title,
      description: item.snippet.description ?? '',
      channel: item.snippet.channelTitle,
      url: `https://www.youtube.com/watch?v=${item.id}`,
    };
  } catch {
    return null;
  }
}

export function normalizeMediaName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/&amp;/g, ' ')
    .replace(/[._\-:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build YouTube search queries from a vault filename. */
export function filenameSearchQueries(filename: string): string[] {
  const withoutExt = filename.replace(/\.[^.]+$/, '').trim();
  const normalized = normalizeMediaName(filename);
  const parts = normalized.split(' ').filter((w) => w.length >= 2);

  const queries = new Set<string>([
    withoutExt,
    normalized,
    parts.slice(0, 8).join(' '),
    parts.slice(0, 6).join(' '),
    parts.slice(0, 4).join(' '),
  ]);

  return [...queries].filter((q) => q.length >= 3);
}

export async function searchYouTubeVideos(
  queries: string[],
  maxPerQuery = 8,
): Promise<YouTubeVideoHit[]> {
  const key = apiKey();
  if (!key) return [];

  const seen = new Set<string>();
  const hits: YouTubeVideoHit[] = [];

  for (const q of [...new Set(queries.map((s) => s.trim()).filter(Boolean))]) {
    try {
      const { data } = await axios.get<{
        items?: Array<{
          id: { videoId: string };
          snippet: { title: string; description: string; channelTitle: string };
        }>;
      }>('https://www.googleapis.com/youtube/v3/search', {
        params: {
          key,
          part: 'snippet',
          q,
          type: 'video',
          maxResults: maxPerQuery,
        },
        timeout: 15_000,
      });

      for (const item of data.items ?? []) {
        const videoId = item.id.videoId;
        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);
        hits.push({
          videoId,
          title: item.snippet.title,
          description: item.snippet.description ?? '',
          channel: item.snippet.channelTitle,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        });
      }
    } catch {
      // skip failed query
    }
  }

  return hits;
}

/** Minimum similarity for automatic YouTube search alerts (no manual URL). */
export const YOUTUBE_AUTO_ALERT_MIN = 0.92;

/** Extract ordered time digits after "at" (e.g. 9.07.54 PM → [9,07,54]). */
function extractTimeDigits(normalized: string): string[] | null {
  const atMatch = normalized.match(/\bat\s+(.+?)(?:\s+(am|pm)\b|$)/i);
  if (!atMatch) return null;
  const segment = atMatch[1] ?? '';
  const digits = segment.match(/\d+/g) ?? [];
  return digits.length >= 2 ? digits : null;
}

/** WhatsApp/camera exports include a precise timestamp — all parts must match. */
function timeDigitsMatch(filename: string, hitTitle: string): boolean {
  const stem = normalizeMediaName(filename);
  const title = normalizeMediaName(hitTitle);
  const stemTime = extractTimeDigits(stem);
  if (!stemTime) return true;

  const titleTime = extractTimeDigits(title);
  if (!titleTime) return false;

  const parts = Math.min(stemTime.length, titleTime.length, 3);
  for (let i = 0; i < parts; i++) {
    if (stemTime[i] !== titleTime[i]) return false;
  }
  return true;
}

function tokenOverlapRatio(a: string, b: string): number {
  const aTokens = a.split(' ').filter((w) => w.length >= 2);
  const bSet = new Set(b.split(' ').filter((w) => w.length >= 2));
  if (aTokens.length === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const t of aTokens) if (bSet.has(t)) overlap++;
  return overlap / aTokens.length;
}

/** Score how likely a YouTube result matches a monitored vault filename. */
export function scoreYouTubeFilenameMatch(filename: string, hit: YouTubeVideoHit): number {
  const stem = normalizeMediaName(filename);
  const title = normalizeMediaName(hit.title);
  const desc = normalizeMediaName(hit.description);
  const combined = `${title} ${desc}`;

  if (!stem || stem.length < 2) return 0;

  // Filename has a clock time — reject if YouTube title time differs (stops random WhatsApp uploads)
  if (!timeDigitsMatch(filename, hit.title)) return 0;

  // Near-identical normalized titles (your upload, maybe minor rename)
  if (stem === title) return 0.96;
  const overlap = tokenOverlapRatio(stem, title);
  if (overlap >= 0.95) return 0.95;
  if (title.startsWith(stem) || stem.startsWith(title)) {
    const shorter = Math.min(stem.length, title.length);
    const longer = Math.max(stem.length, title.length);
    if (shorter / longer >= 0.85) return 0.94;
  }

  const ratio = tokenOverlapRatio(stem, combined);
  if (ratio < 0.7) return 0;

  let score = ratio >= 0.85 ? 0.9 : ratio >= 0.75 ? 0.82 : 0.72;

  // Date numbers alone are not enough — but full date+time must align for WhatsApp-style names
  const stemNums = (stem.match(/\d+/g) ?? []).filter((n) => n.length >= 2);
  if (stemNums.length >= 4) {
    const matched = stemNums.filter((n) => combined.includes(n)).length;
    const numRatio = matched / stemNums.length;
    if (numRatio < 0.85) return Math.min(score, 0.6);
    if (numRatio >= 0.95) score = Math.min(0.95, score + 0.05);
  }

  return score;
}

/** True when a YouTube search hit is strong enough for automatic alerting (no pasted URL). */
export function isStrongAutoYouTubeMatch(filename: string, hit: YouTubeVideoHit): boolean {
  return scoreYouTubeFilenameMatch(filename, hit) >= YOUTUBE_AUTO_ALERT_MIN;
}
