/**
 * YouTube connector — YouTube Data API v3 search.
 */

import { crawlerEngineConfig } from '../config';
import {
  buildYouTubeWatchUrl,
  extractYouTubeVideoId,
  filenameSearchQueries,
  getYouTubeVideo,
  searchYouTubeVideos,
} from '../../youtube-search.util';
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
    const seen = new Set<string>();
    let urlsChecked = 0;

    const addHit = (videoId: string, title: string, description: string, channel: string) => {
      if (!videoId || seen.has(videoId)) return;
      seen.add(videoId);
      assets.push({
        platform: 'YOUTUBE',
        sourceUrl: buildYouTubeWatchUrl(videoId),
        assetUrl: buildYouTubeWatchUrl(videoId),
        assetType: 'video',
        title,
        description: description.slice(0, 300),
        metadata: { channel, videoId },
      });
    };

    for (const url of ctx.watchUrls) {
      const videoId = extractYouTubeVideoId(url);
      if (!videoId) continue;
      urlsChecked++;
      const hit = await getYouTubeVideo(videoId);
      if (hit) addHit(hit.videoId, hit.title, hit.description, hit.channel);
    }

    const queries = filenameSearchQueries(ctx.filename).concat(ctx.keywords.slice(0, 3));

    for (const hit of await searchYouTubeVideos(queries, 5)) {
      urlsChecked++;
      addHit(hit.videoId, hit.title, hit.description, hit.channel);
    }

    return { platform: 'YOUTUBE', assets, urlsChecked };
  }
}

export const youtubeConnector = new YouTubeConnector();
