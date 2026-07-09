/**
 * Reddit connector — public search API (no auth required for read-only).
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

export class RedditConnector implements ICrawlerConnector {
  readonly platform: CrawlerPlatform = 'REDDIT';

  isConfigured(): boolean {
    return crawlerEngineConfig.platforms.reddit;
  }

  async search(ctx: ConnectorSearchContext): Promise<ConnectorSearchResult> {
    const assets: DiscoveredAsset[] = [];
    const queries = [ctx.filename.replace(/\.[^.]+$/, ''), ...ctx.keywords.slice(0, 2)];
    let urlsChecked = 0;

    for (const q of [...new Set(queries.filter(Boolean))]) {
      urlsChecked++;
      try {
        const { data } = await axios.get<{
          data?: { children?: Array<{ data: RedditPost }> };
        }>('https://www.reddit.com/search.json', {
          params: { q, sort: 'new', limit: 10, type: 'link' },
          headers: { 'User-Agent': crawlerEngineConfig.reddit.userAgent },
          timeout: crawlerEngineConfig.downloadTimeoutMs,
        });

        for (const child of data.data?.children ?? []) {
          const post = child.data;
          const postUrl = `https://www.reddit.com${post.permalink}`;
          assets.push({
            platform: 'REDDIT',
            sourceUrl: postUrl,
            assetType: 'post',
            title: post.title,
            description: post.selftext?.slice(0, 300),
            metadata: { subreddit: post.subreddit, score: post.score },
          });

          if (post.url && this.isMediaUrl(post.url)) {
            assets.push({
              platform: 'REDDIT',
              sourceUrl: postUrl,
              assetUrl: post.url,
              assetType: this.guessType(post.url),
              title: post.title,
            });
          }

          if (post.preview?.images?.[0]?.source?.url) {
            const img = post.preview.images[0].source.url.replace(/&amp;/g, '&');
            assets.push({
              platform: 'REDDIT',
              sourceUrl: postUrl,
              assetUrl: img,
              assetType: 'image',
              title: post.title,
            });
          }
        }
      } catch (err) {
        logger.debug('[RedditConnector] Search failed', { q, error: String(err) });
      }
    }

    return { platform: 'REDDIT', assets, urlsChecked };
  }

  private isMediaUrl(url: string): boolean {
    return /\.(jpe?g|png|gif|webp|pdf|mp4)(\?|$)/i.test(url)
      || url.includes('i.redd.it')
      || url.includes('v.redd.it');
  }

  private guessType(url: string): DiscoveredAsset['assetType'] {
    if (/\.pdf/i.test(url)) return 'pdf';
    if (/\.(mp4|webm)/i.test(url) || url.includes('v.redd.it')) return 'video';
    if (/\.(jpe?g|png|gif|webp)/i.test(url) || url.includes('i.redd.it')) return 'image';
    return 'unknown';
  }
}

interface RedditPost {
  title: string;
  selftext?: string;
  permalink: string;
  url: string;
  subreddit: string;
  score: number;
  preview?: { images?: Array<{ source: { url: string } }> };
}

export const redditConnector = new RedditConnector();
