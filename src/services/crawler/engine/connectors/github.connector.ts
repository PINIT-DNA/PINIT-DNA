/**
 * GitHub connector — search repositories, code, filenames via REST API.
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

export class GitHubConnector implements ICrawlerConnector {
  readonly platform: CrawlerPlatform = 'GITHUB';

  isConfigured(): boolean {
    return crawlerEngineConfig.platforms.github;
  }

  async search(ctx: ConnectorSearchContext): Promise<ConnectorSearchResult> {
    const assets: DiscoveredAsset[] = [];
    const queries = this.buildQueries(ctx);
    let urlsChecked = 0;

    for (const q of queries) {
      urlsChecked++;
      try {
        const repos = await this.apiGet<{ items?: Array<{ html_url: string; full_name: string; description?: string }> }>(
          '/search/repositories',
          { q, per_page: '5', sort: 'updated' },
        );
        for (const item of repos.items ?? []) {
          assets.push({
            platform: 'GITHUB',
            sourceUrl: item.html_url,
            assetType: 'repository',
            title: item.full_name,
            description: item.description,
          });
        }

        const code = await this.apiGet<{ items?: Array<{ html_url: string; name: string; path: string; repository: { html_url: string } }> }>(
          '/search/code',
          { q: `${q} filename:${ctx.filename}`, per_page: '5' },
        ).catch(() => ({ items: [] }));
        for (const item of code.items ?? []) {
          assets.push({
            platform: 'GITHUB',
            sourceUrl: item.html_url,
            assetUrl: item.html_url,
            assetType: item.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'document',
            title: item.path,
            metadata: { repository: item.repository.html_url },
          });
        }
      } catch (err) {
        logger.debug('[GitHubConnector] Search failed', { q, error: String(err) });
      }
    }

    if (ctx.sha256Hash) {
      const hashQ = ctx.sha256Hash.slice(0, 16);
      try {
        const code = await this.apiGet<{ items?: Array<{ html_url: string; name: string }> }>(
          '/search/code',
          { q: hashQ, per_page: '3' },
        );
        for (const item of code.items ?? []) {
          assets.push({
            platform: 'GITHUB',
            sourceUrl: item.html_url,
            assetUrl: item.html_url,
            assetType: 'document',
            title: item.name,
            metadata: { hashSearch: hashQ },
          });
        }
        urlsChecked++;
      } catch { /* rate limit */ }
    }

    return { platform: 'GITHUB', assets, urlsChecked };
  }

  private buildQueries(ctx: ConnectorSearchContext): string[] {
    const base = ctx.filename.replace(/\.[^.]+$/, '');
    const qs = [base, ...ctx.keywords.slice(0, 3)];
    if (ctx.certificateId) qs.push(ctx.certificateId);
    return [...new Set(qs.filter(Boolean))];
  }

  private async apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (crawlerEngineConfig.github.token) {
      headers.Authorization = `Bearer ${crawlerEngineConfig.github.token}`;
    }
    const { data } = await axios.get<T>(`${crawlerEngineConfig.github.apiBase}${path}`, {
      params,
      headers,
      timeout: crawlerEngineConfig.downloadTimeoutMs,
    });
    return data;
  }
}

export const githubConnector = new GitHubConnector();
