/**
 * YouTube connector — YouTube Data API v3 search.
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

export class YouTubeConnector implements ICrawlerConnector {
  readonly platform: CrawlerPlatform = 'YOUTUBE';

  isConfigured(): boolean {
    return crawlerEngineConfig.platforms.youtube && !!crawlerEngineConfig.youtube.apiKey;
  }

  async search(ctx: ConnectorSearchContext): Promise<ConnectorSearchResult> {
    if (!this.isConfigured()) {
      return { platform: 'YOUTUBE', assets: [], urlsChecked: 0, error: 'YOUTUBE_API_KEY not set' };
    }

    const assets: DiscoveredAsset[] = [];
    const queries = [
      ctx.filename.replace(/\.[^.]+$/, ''),
      ...ctx.keywords.slice(0, 3),
    ].filter(Boolean);

    let urlsChecked = 0;
    for (const q of [...new Set(queries)]) {
      urlsChecked++;
      try {
        const { data } = await axios.get<{
          items?: Array<{
            id: { videoId: string };
            snippet: { title: string; description: string; channelTitle: string };
          }>;
        }>(`${crawlerEngineConfig.youtube.apiBase}/search`, {
          params: {
            key: crawlerEngineConfig.youtube.apiKey,
            part: 'snippet',
            q,
            type: 'video',
            maxResults: 5,
          },
          timeout: crawlerEngineConfig.downloadTimeoutMs,
        });

        for (const item of data.items ?? []) {
          const videoId = item.id.videoId;
          assets.push({
            platform: 'YOUTUBE',
            sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
            assetUrl: `https://www.youtube.com/watch?v=${videoId}`,
            assetType: 'video',
            title: item.snippet.title,
            description: item.snippet.description?.slice(0, 300),
            metadata: { channel: item.snippet.channelTitle, videoId },
          });
        }
      } catch (err) {
        logger.debug('[YouTubeConnector] Search failed', { q, error: String(err) });
      }
    }

    return { platform: 'YOUTUBE', assets, urlsChecked };
  }
}

export const youtubeConnector = new YouTubeConnector();
