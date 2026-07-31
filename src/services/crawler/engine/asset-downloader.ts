/**
 * Asset downloader — fetch public assets discovered by connectors.
 */

import axios from 'axios';
import path from 'path';
import { crawlerEngineConfig } from './config';
import type { DiscoveredAsset, DownloadedAsset } from './types';

const USER_AGENT = 'PINIT-DNA-Crawler/1.0 (+https://pinit-dna.com)';

export class AssetDownloader {
  async download(asset: DiscoveredAsset): Promise<DownloadedAsset | null> {
    const url = asset.assetUrl;
    if (!url || !url.startsWith('http')) {
      if (asset.assetType === 'document' && asset.description) {
        return {
          buffer: Buffer.from(asset.description, 'utf8'),
          mimeType: 'text/plain',
          filename: asset.title ?? 'page.txt',
          sourceUrl: asset.sourceUrl,
          assetUrl: asset.sourceUrl,
          platform: asset.platform,
          assetType: asset.assetType,
        };
      }
      return null;
    }

    if (asset.assetType === 'repository' || asset.assetType === 'post') {
      return {
        buffer: Buffer.from(JSON.stringify({
          title: asset.title,
          description: asset.description,
          url: asset.sourceUrl,
        }), 'utf8'),
        mimeType: 'application/json',
        filename: `${asset.title ?? 'post'}.json`,
        sourceUrl: asset.sourceUrl,
        assetUrl: url,
        platform: asset.platform,
        assetType: asset.assetType,
      };
    }

    try {
      const resp = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: crawlerEngineConfig.downloadTimeoutMs,
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      });

      const buffer = Buffer.from(resp.data);
      if (buffer.length > crawlerEngineConfig.maxAssetBytes) return null;

      const mimeType = (resp.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim();
      const filename = path.basename(new URL(url).pathname) || asset.title || 'asset';

      return {
        buffer,
        mimeType,
        filename,
        sourceUrl: asset.sourceUrl,
        assetUrl: url,
        platform: asset.platform,
        assetType: asset.assetType,
      };
    } catch {
      return null;
    }
  }
}

export const assetDownloader = new AssetDownloader();
