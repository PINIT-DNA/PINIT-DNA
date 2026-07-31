/**
 * Monitoring & Crawler Engine — shared types.
 */

export type CrawlerPlatform =
  | 'WEBSITE'
  | 'GITHUB'
  | 'YOUTUBE'
  | 'REDDIT'
  | 'TELEGRAM'
  | 'BING'      // future
  | 'GOOGLE';   // future

export type CrawlerJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type DiscoveredAssetType = 'image' | 'video' | 'pdf' | 'document' | 'repository' | 'post' | 'unknown';

export interface DiscoveredAsset {
  platform: CrawlerPlatform;
  sourceUrl: string;
  assetUrl?: string;
  title?: string;
  description?: string;
  assetType: DiscoveredAssetType;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorSearchContext {
  monitorRecordId: string;
  dnaRecordId: string;
  ownerUserId: string;
  filename: string;
  fileType: string;
  keywords: string[];
  watchUrls: string[];
  sha256Hash?: string | null;
  certificateId?: string | null;
}

export interface ConnectorSearchResult {
  platform: CrawlerPlatform;
  assets: DiscoveredAsset[];
  urlsChecked: number;
  error?: string;
}

export interface DownloadedAsset {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  sourceUrl: string;
  assetUrl: string;
  platform: CrawlerPlatform;
  assetType: DiscoveredAssetType;
}

export interface DnaComparisonResult {
  similarity: number;
  matchType: 'EXACT_MATCH' | 'HIGH_MATCH' | 'POSSIBLE_MATCH' | 'NO_MATCH';
  confidence: number;
  method: string;
  details?: Record<string, unknown>;
}

export interface MatchPipelineResult {
  matchId: string;
  incidentId: string;
  evidenceId: string;
  investigationId?: string;
  notified: boolean;
}

export interface CrawlerEngineStats {
  crawlerStatus: 'RUNNING' | 'IDLE' | 'DISABLED';
  platformsConnected: Record<CrawlerPlatform, boolean>;
  jobsPending: number;
  jobsRunning: number;
  jobsCompleted24h: number;
  jobsFailed24h: number;
  matchesFound: number;
  incidentsOpen: number;
  lastScanAt: string | null;
  nextScanAt: string | null;
  successRate: number;
  coverage: {
    monitorsActive: number;
    monitorsTotal: number;
    platformsEnabled: number;
  };
}

export interface ICrawlerConnector {
  readonly platform: CrawlerPlatform;
  isConfigured(): boolean;
  search(ctx: ConnectorSearchContext): Promise<ConnectorSearchResult>;
}
