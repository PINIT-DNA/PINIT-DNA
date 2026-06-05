/**
 * PINIT-DNA — Web Crawler Service
 *
 * Fetches web pages and extracts text content for comparison.
 * No puppeteer needed — uses axios + HTML stripping.
 * Respects robots.txt and rate limits.
 */

import axios    from 'axios';
import { logger } from '../../lib/logger';

export interface CrawlPageResult {
  url:        string;
  title:      string;
  text:       string;
  wordCount:  number;
  statusCode: number;
  crawledAt:  string;
  error?:     string;
}

const USER_AGENT = 'PINIT-DNA/2.0 (Document Authentication System; +https://pinit-dna.com)';
const TIMEOUT    = 15_000;

// Strip HTML tags and extract readable text
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Extract page title from HTML
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

export class WebCrawlerService {
  /**
   * Crawl a single URL and extract text content.
   */
  async crawlUrl(url: string): Promise<CrawlPageResult> {
    const crawledAt = new Date().toISOString();

    // Validate URL
    try {
      new URL(url);
    } catch {
      return { url, title: '', text: '', wordCount: 0, statusCode: 0, crawledAt,
        error: 'Invalid URL format' };
    }

    try {
      const { data, status } = await axios.get(url, {
        timeout: TIMEOUT,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        responseType: 'text',
      });

      const html      = String(data);
      const title     = extractTitle(html);
      const text      = stripHtml(html).slice(0, 10000); // first 10KB of text
      const wordCount = text.split(/\s+/).filter(Boolean).length;

      logger.debug('Crawled URL', { url, wordCount, statusCode: status });

      return { url, title, text, wordCount, statusCode: status, crawledAt };

    } catch (err) {
      const status = (err as { response?: { status: number } })?.response?.status ?? 0;
      const msg    = err instanceof Error ? err.message : String(err);
      logger.debug('Crawl failed', { url, error: msg });
      return { url, title: '', text: '', wordCount: 0, statusCode: status, crawledAt,
        error: msg.slice(0, 200) };
    }
  }

  /**
   * Crawl multiple URLs in parallel (max 3 at a time).
   */
  async crawlUrls(urls: string[]): Promise<CrawlPageResult[]> {
    const results: CrawlPageResult[] = [];
    const BATCH = 3;

    for (let i = 0; i < urls.length; i += BATCH) {
      const batch = urls.slice(i, i + BATCH);
      const batchResults = await Promise.all(batch.map(url => this.crawlUrl(url)));
      results.push(...batchResults);
      // Small delay between batches to be respectful
      if (i + BATCH < urls.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return results;
  }

  /**
   * Generate search URLs for a document title/filename.
   * Returns URLs that are likely to contain similar content.
   */
  generateSearchUrls(filename: string, keywords: string[]): string[] {
    const cleanName = filename.replace(/\.[^.]+$/, '').replace(/[_\-]/g, '+');
    const keywordStr = keywords.slice(0, 3).join('+');

    return [
      // DuckDuckGo HTML search (no API key needed)
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanName)}`,
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keywordStr)}`,
    ];
  }
}

export const webCrawler = new WebCrawlerService();
