/**
 * PINIT-DNA — Filename Search Provider (free, no API key required)
 *
 * Strategy:
 *   1. Search DuckDuckGo for the exact filename e.g. `"tiger.jpeg"`
 *   2. Parse result links (uddg redirects) for real destination URLs
 *   3. Extract direct image links from result pages
 *   4. Skip DuckDuckGo tracking pixels (tqadb) and internal assets
 */

import axios from 'axios';
import { logger } from '../../../lib/logger';
import type { ImageSearchProvider, ImageSearchResult } from './image-search.provider';
import {
  decodeDdgRedirect,
  isBlockedCrawlerUrl,
  isDirectImageUrl,
} from '../url-sanitize';

const IMAGE_URL_RE  = /https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp|gif)(\?[^\s"'<>]*)?/gi;
const IMG_SRC_RE    = /<img[^>]+src=["']([^"']+)["']/gi;
const RESULT_A_RE   = /class="result__a"[^>]*href="([^"]+)"/gi;
const TIMEOUT       = 15_000;
const USER_AGENT    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 PINIT-DNA/2.0';

export class FilenameSearchProvider implements ImageSearchProvider {
  name = 'FilenameSearch';

  isConfigured(): boolean { return true; }

  async findCandidates(filename: string, _pHash64: string): Promise<ImageSearchResult[]> {
    const cleanName = filename.replace(/\.[^.]+$/, '').trim();
    const ext       = (filename.match(/\.([^.]+)$/) ?? [])[1] ?? 'jpg';

    const queries: string[] = [
      `"${filename}"`,
      `"${cleanName}" filetype:${ext}`,
      `"${cleanName}" site:postimg.cc`,
      `"${cleanName}" site:imgur.com`,
      `"${cleanName}" site:i.ibb.co`,
    ];

    const results: ImageSearchResult[] = [];
    const seen = new Set<string>();

    const add = (imageUrl: string, pageUrl: string) => {
      if (!imageUrl || isBlockedCrawlerUrl(imageUrl) || seen.has(imageUrl)) return;
      seen.add(imageUrl);
      results.push({ imageUrl, pageUrl, source: 'FILENAME_SEARCH' });
    };

    for (const q of queries) {
      if (results.length >= 25) break;

      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;

      try {
        const { data } = await axios.get<string>(ddgUrl, {
          timeout: TIMEOUT,
          responseType: 'text',
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        });

        const html = String(data);

        // Real search-result destinations (not tqadb trackers)
        RESULT_A_RE.lastIndex = 0;
        let rm: RegExpExecArray | null;
        const resultPages: string[] = [];
        while ((rm = RESULT_A_RE.exec(html)) !== null) {
          const dest = decodeDdgRedirect(rm[1]);
          if (dest && !isBlockedCrawlerUrl(dest)) {
            resultPages.push(dest);
            if (isDirectImageUrl(dest)) add(dest, dest);
          }
        }

        // Scrape top result pages for embedded images (skip DDG internals)
        for (const pageUrl of resultPages.slice(0, 4)) {
          if (results.length >= 25) break;
          if (isDirectImageUrl(pageUrl)) continue;
          await this.extractImagesFromPage(pageUrl, add);
          await new Promise((r) => setTimeout(r, 400));
        }

        // Fallback: image URLs embedded in DDG HTML (filtered)
        IMG_SRC_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = IMG_SRC_RE.exec(html)) !== null) {
          const url = this.resolveUrl(m[1]);
          if (url) add(url, ddgUrl);
        }

        IMAGE_URL_RE.lastIndex = 0;
        while ((m = IMAGE_URL_RE.exec(html)) !== null) {
          const url = m[0].replace(/["'>]$/, '');
          if (url.startsWith('http')) add(url, ddgUrl);
        }

        logger.debug(`[FilenameSearch] Query "${q}" → ${results.length} total candidates`);
        await new Promise((r) => setTimeout(r, 600));
      } catch (err) {
        logger.debug(`[FilenameSearch] Query failed: "${q}"`, { error: String(err).slice(0, 150) });
      }
    }

    logger.info('[FilenameSearch] Candidate discovery complete', {
      filename,
      queriesRun: queries.length,
      candidatesFound: results.length,
    });

    return results.slice(0, 25);
  }

  private async extractImagesFromPage(
    pageUrl: string,
    add: (imageUrl: string, pageUrl: string) => void,
  ): Promise<void> {
    try {
      const { data } = await axios.get<string>(pageUrl, {
        timeout: 10_000,
        responseType: 'text',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,image/*' },
      });

      const html = String(data);
      IMG_SRC_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = IMG_SRC_RE.exec(html)) !== null) {
        const url = this.resolveUrl(m[1], pageUrl);
        if (url && isDirectImageUrl(url)) add(url, pageUrl);
      }

      IMAGE_URL_RE.lastIndex = 0;
      while ((m = IMAGE_URL_RE.exec(html)) !== null) {
        const url = m[0].replace(/["'>]$/, '');
        if (url.startsWith('http') && isDirectImageUrl(url)) add(url, pageUrl);
      }
    } catch (err) {
      logger.debug('[FilenameSearch] Page scrape failed', {
        pageUrl: pageUrl.slice(0, 120),
        error: String(err).slice(0, 100),
      });
    }
  }

  private resolveUrl(url: string, base?: string): string | null {
    if (!url) return null;
    try {
      if (url.startsWith('//')) return `https:${url}`;
      if (url.startsWith('http')) return url;
      if (base) return new URL(url, base).href;
    } catch {
      return null;
    }
    return null;
  }
}
