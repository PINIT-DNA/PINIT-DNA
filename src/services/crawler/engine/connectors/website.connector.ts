/**
 * Website connector — public pages, blogs, news.
 * Uses axios HTML crawl; optional Playwright / Crawl4AI when configured.
 */

import axios from 'axios';
import { logger } from '../../../../lib/logger';
import { webCrawler } from '../../web-crawler.service';
import { crawlerEngineConfig } from '../config';
import type {
  ConnectorSearchContext,
  ConnectorSearchResult,
  CrawlerPlatform,
  DiscoveredAsset,
  ICrawlerConnector,
} from '../types';

const IMG_RE = /<img[^>]+src=["']([^"']+)["']/gi;
const VIDEO_RE = /<(?:video|source)[^>]+src=["']([^"']+)["']/gi;
const PDF_RE = /href=["']([^"']+\.pdf[^"']*)["']/gi;
const ABSOLUTE = (base: string, href: string): string => {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
};

export class WebsiteConnector implements ICrawlerConnector {
  readonly platform: CrawlerPlatform = 'WEBSITE';

  isConfigured(): boolean {
    return crawlerEngineConfig.platforms.website;
  }

  async search(ctx: ConnectorSearchContext): Promise<ConnectorSearchResult> {
    const assets: DiscoveredAsset[] = [];
    const seen = new Set<string>();
    const urls = this.buildTargetUrls(ctx);
    let urlsChecked = 0;

    for (const url of urls.slice(0, crawlerEngineConfig.website.maxPagesPerScan)) {
      urlsChecked++;
      try {
        const pageAssets = await this.crawlPage(url);
        for (const a of pageAssets) {
          const key = a.assetUrl ?? a.sourceUrl;
          if (seen.has(key)) continue;
          seen.add(key);
          assets.push({ ...a, platform: 'WEBSITE' });
          if (assets.length >= crawlerEngineConfig.website.maxAssetsPerPage * urls.length) break;
        }
      } catch (err) {
        logger.debug('[WebsiteConnector] Page crawl failed', { url, error: String(err) });
      }
    }

    return { platform: 'WEBSITE', assets, urlsChecked };
  }

  private buildTargetUrls(ctx: ConnectorSearchContext): string[] {
    const urls = [...ctx.watchUrls];
    const clean = ctx.filename.replace(/\.[^.]+$/, '').replace(/[_\-\s]+/g, '+');
    const kw = ctx.keywords.slice(0, 2).join('+');
    urls.push(...webCrawler.generateSearchUrls(ctx.filename, ctx.keywords));
    if (kw) {
      urls.push(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(clean)}+filetype:pdf`);
      urls.push(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(kw)}+site:medium.com`);
    }
    return [...new Set(urls.filter(u => u.startsWith('http')))];
  }

  private async crawlPage(url: string): Promise<DiscoveredAsset[]> {
    if (crawlerEngineConfig.website.crawl4aiUrl) {
      const fromCrawl4ai = await this.tryCrawl4ai(url);
      if (fromCrawl4ai.length > 0) return fromCrawl4ai;
    }

    if (crawlerEngineConfig.website.playwrightEnabled) {
      const fromPlaywright = await this.tryPlaywright(url);
      if (fromPlaywright.length > 0) return fromPlaywright;
    }

    const page = await webCrawler.crawlUrl(url);
    if (!page.text && !page.title) return [];

    const assets: DiscoveredAsset[] = [];
    const html = await this.fetchRawHtml(url);
    if (html) {
      for (const m of html.matchAll(IMG_RE)) {
        const href = ABSOLUTE(url, m[1]);
        assets.push({ platform: 'WEBSITE', sourceUrl: url, assetUrl: href, assetType: 'image', title: page.title });
      }
      for (const m of html.matchAll(VIDEO_RE)) {
        const href = ABSOLUTE(url, m[1]);
        assets.push({ platform: 'WEBSITE', sourceUrl: url, assetUrl: href, assetType: 'video', title: page.title });
      }
      for (const m of html.matchAll(PDF_RE)) {
        const href = ABSOLUTE(url, m[1]);
        assets.push({ platform: 'WEBSITE', sourceUrl: url, assetUrl: href, assetType: 'pdf', title: page.title });
      }
    }

    if (page.text.length > 50) {
      assets.push({
        platform: 'WEBSITE',
        sourceUrl: url,
        assetType: 'document',
        title: page.title,
        description: page.text.slice(0, 500),
      });
    }

    return assets.slice(0, crawlerEngineConfig.website.maxAssetsPerPage);
  }

  private async fetchRawHtml(url: string): Promise<string | null> {
    try {
      const { data } = await axios.get<string>(url, {
        timeout: crawlerEngineConfig.downloadTimeoutMs,
        responseType: 'text',
        headers: { 'User-Agent': 'PINIT-DNA-Crawler/1.0' },
      });
      return String(data);
    } catch {
      return null;
    }
  }

  private async tryCrawl4ai(url: string): Promise<DiscoveredAsset[]> {
    const base = crawlerEngineConfig.website.crawl4aiUrl.replace(/\/$/, '');
    try {
      const { data } = await axios.post<{ links?: string[]; media?: { images?: string[]; videos?: string[] } }>(
        `${base}/crawl`,
        { url, extract_media: true },
        { timeout: crawlerEngineConfig.jobTimeoutMs },
      );
      const assets: DiscoveredAsset[] = [];
      for (const img of data.media?.images ?? []) {
        assets.push({ platform: 'WEBSITE', sourceUrl: url, assetUrl: img, assetType: 'image' });
      }
      for (const vid of data.media?.videos ?? []) {
        assets.push({ platform: 'WEBSITE', sourceUrl: url, assetUrl: vid, assetType: 'video' });
      }
      for (const link of data.links ?? []) {
        if (link.toLowerCase().endsWith('.pdf')) {
          assets.push({ platform: 'WEBSITE', sourceUrl: url, assetUrl: link, assetType: 'pdf' });
        }
      }
      return assets;
    } catch (err) {
      logger.debug('[WebsiteConnector] Crawl4AI unavailable', { error: String(err) });
      return [];
    }
  }

  private async tryPlaywright(url: string): Promise<DiscoveredAsset[]> {
    try {
      // Optional dependency — install with: npm install playwright
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const playwright = await (Function('return import("playwright")')() as Promise<any>).catch(() => null);
      if (!playwright?.chromium) return [];

      const browser = await playwright.chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(url, { timeout: crawlerEngineConfig.downloadTimeoutMs, waitUntil: 'domcontentloaded' });
        const links = await page.evaluate(`(() => {
          const imgs = Array.from(document.querySelectorAll('img[src]')).map(i => i.src);
          const pdfs = Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(h => h.toLowerCase().includes('.pdf'));
          return { imgs, pdfs };
        })()`) as { imgs: string[]; pdfs: string[] };
        const assets: DiscoveredAsset[] = [];
        for (const img of links.imgs) {
          assets.push({ platform: 'WEBSITE', sourceUrl: url, assetUrl: img, assetType: 'image' });
        }
        for (const pdf of links.pdfs) {
          assets.push({ platform: 'WEBSITE', sourceUrl: url, assetUrl: pdf, assetType: 'pdf' });
        }
        return assets;
      } finally {
        await browser.close();
      }
    } catch (err) {
      logger.debug('[WebsiteConnector] Playwright unavailable', { error: String(err) });
      return [];
    }
  }
}

export const websiteConnector = new WebsiteConnector();
