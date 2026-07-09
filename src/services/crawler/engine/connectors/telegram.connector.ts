/**
 * Telegram connector — public channels only (t.me/s/ scrape).
 */

import axios from 'axios';
import { logger } from '../../../../lib/logger';
import { crawlerEngineConfig } from '../config';
import type {
  ConnectorSearchContext,
  ConnectorSearchResult,
  CrawlerPlatform,
  DiscoveredAsset,
  ICrawlerConnector,
} from '../types';

const IMG_RE = /background-image:url\('([^']+)'\)/gi;
const LINK_RE = /href="(https?:\/\/[^"]+)"/gi;

export class TelegramConnector implements ICrawlerConnector {
  readonly platform: CrawlerPlatform = 'TELEGRAM';

  isConfigured(): boolean {
    return crawlerEngineConfig.platforms.telegram
      && crawlerEngineConfig.telegram.channels.length > 0;
  }

  async search(ctx: ConnectorSearchContext): Promise<ConnectorSearchResult> {
    if (!this.isConfigured()) {
      return {
        platform: 'TELEGRAM',
        assets: [],
        urlsChecked: 0,
        error: 'TELEGRAM_PUBLIC_CHANNELS not configured',
      };
    }

    const assets: DiscoveredAsset[] = [];
    const terms = [ctx.filename.replace(/\.[^.]+$/, ''), ...ctx.keywords.slice(0, 2)]
      .map(t => t.toLowerCase())
      .filter(Boolean);

    let urlsChecked = 0;
    for (const channel of crawlerEngineConfig.telegram.channels) {
      const url = `https://t.me/s/${channel.replace(/^@/, '')}`;
      urlsChecked++;
      try {
        const { data: html } = await axios.get<string>(url, {
          timeout: crawlerEngineConfig.downloadTimeoutMs,
          headers: { 'User-Agent': 'PINIT-DNA-Crawler/1.0' },
          responseType: 'text',
        });

        const text = String(html).toLowerCase();
        const relevant = terms.length === 0 || terms.some(t => text.includes(t));
        if (!relevant) continue;

        for (const m of String(html).matchAll(IMG_RE)) {
          const img = m[1];
          assets.push({
            platform: 'TELEGRAM',
            sourceUrl: url,
            assetUrl: img.startsWith('http') ? img : `https://t.me${img}`,
            assetType: 'image',
            title: `Telegram @${channel}`,
            metadata: { channel },
          });
        }

        for (const m of String(html).matchAll(LINK_RE)) {
          const link = m[1];
          if (link.includes('.pdf')) {
            assets.push({
              platform: 'TELEGRAM',
              sourceUrl: url,
              assetUrl: link,
              assetType: 'pdf',
              metadata: { channel },
            });
          }
        }
      } catch (err) {
        logger.debug('[TelegramConnector] Channel scrape failed', { channel, error: String(err) });
      }
    }

    return { platform: 'TELEGRAM', assets, urlsChecked };
  }
}

export const telegramConnector = new TelegramConnector();
