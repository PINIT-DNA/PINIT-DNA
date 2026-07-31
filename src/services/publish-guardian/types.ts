/**
 * Publish Guardian — shared types (additive module).
 */

export type PublishPlatform =
  | 'instagram'
  | 'facebook'
  | 'x'
  | 'youtube'
  | 'tiktok'
  | 'threads'
  | 'pinterest'
  | 'linkedin'
  | 'telegram'
  | 'github'
  | 'reddit'
  | 'tumblr'
  | 'behance'
  | 'dribbble'
  | 'deviantart'
  | 'artstation'
  | 'vimeo'
  | 'medium'
  | 'substack'
  | 'patreon'
  | 'canva'
  | 'figma'
  | 'shopify'
  | 'wordpress'
  | 'twitch'
  | 'web';

export interface PublishProtectInput {
  ownerUserId: string;
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
  platform: PublishPlatform | string;
  postUrl?: string | null;
  pageUrl?: string | null;
  mediaUrl?: string | null;
  profileUrl?: string | null;
  platformPostId?: string | null;
  ownerAccount?: string | null;
  caption?: string | null;
  pageTitle?: string | null;
  enrollMonitoring?: boolean;
  issueCertificate?: boolean;
  extensionVersion?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  /** Offline queue idempotency key */
  clientRequestId?: string | null;
  /** How the media was captured (export, publish, protect-menu, …) */
  capturedVia?: string | null;
}

export interface PublishProtectResult {
  success: true;
  protectedPostId: string;
  assetId?: string | null;
  vaultId: string;
  dnaRecordId: string;
  certificateId: string | null;
  monitorId: string | null;
  mediaHash: string;
  status: string;
  monitorStatus?: string;
  ownership: {
    ownerPinitId: string | null;
    registeredAt: string;
  };
  message: string;
  idempotent?: boolean;
}

export interface RegisterPostInput {
  ownerUserId: string;
  vaultId?: string;
  protectedPostId?: string;
  platform: string;
  platformPostId?: string | null;
  postUrl?: string | null;
  ownerAccount?: string | null;
  mediaUrl?: string | null;
  profileUrl?: string | null;
  publishedAt?: string | null;
}

export interface RecordDiscoveryInput {
  dnaRecordId: string;
  ownerUserId?: string | null;
  discoveryUrl: string;
  pageTitle?: string | null;
  matchType: string;
  similarity: number;
  crawlResultId?: string | null;
  platform?: string | null;
}
