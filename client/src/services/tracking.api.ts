/**
 * Asset tracking — one asset, every channel it travelled through.
 *
 * Read-only. The server decides what a viewer may see; nothing here widens it.
 */
import { api } from './dashboard.api';
import { API_BASE_URL } from '../config/api.config';

/** A count the server could not read comes back null, which is not the same as 0. */
export type Count = number | null;

export interface TrackedAsset {
  assetId: string;
  filename: string;
  assetType: string;
  status: string;
  protectedAt: string;
  certificateId: string | null;
  channels: {
    shares: number;
    reshares: number;
    shareViews: number;
    screenshotAttempts: number;
    certificateChecks: Count;
    portfolioViews: Count;
    purchases: Count;
    foundOnline: number;
  };
  lastActivityAt: string | null;
}

export interface TrackedShare {
  shareLinkId: string;
  token: string;
  recipient: string | null;
  createdAt: string;
  isActive: boolean;
  expiresAt: string | null;
  parentLinkId: string | null;
  forwardedByLabel: string | null;
  fromExchange: boolean;
  views: number;
  downloads: number;
  screenshotAttempts: number;
  viewers: number;
  lastSeenAt: string | null;
  country: string | null;
}

export interface AssetTracking {
  asset: {
    assetId: string;
    filename: string;
    assetType: string;
    status: string;
    mimeType: string;
    sizeBytes: number;
    protectedAt: string;
    monitorStatus: string;
  };
  certificate: {
    certificateId: string;
    status: string;
    issuedAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    checks: Count;
    lastCheckedAt: string | null;
  } | null;
  shares: TrackedShare[];
  purchases: Array<{
    orderId: string | null;
    sealId: string | null;
    buyerPinitId: string | null;
    licenseTier: string | null;
    licenseStatus: string | null;
    deliveryStatus: string | null;
    sealedAt: string | null;
    deliveryExpiresAt: string | null;
  }>;
  portfolio: { shown: boolean; views: Count };
  monitoring: { status: string; foundOnline: number; lastDiscoveryAt: string | null };
  evidence: { records: number; investigations: number };
  unavailable: string[];
}

export async function listTrackedAssets(): Promise<TrackedAsset[]> {
  const { data } = await api.get<{ assets?: TrackedAsset[] }>(`${API_BASE_URL}/tracking/assets`);
  return data.assets ?? [];
}

export async function getAssetTracking(assetId: string): Promise<AssetTracking> {
  const { data } = await api.get<AssetTracking>(`${API_BASE_URL}/tracking/assets/${assetId}`);
  return data;
}

/**
 * Reshares sit under the link they were forwarded from, so one recipient and
 * everyone they passed it to read as one thread rather than separate rows.
 */
export function groupSharesByThread(shares: TrackedShare[]): Array<{ share: TrackedShare; reshares: TrackedShare[] }> {
  const byId = new Map(shares.map((s) => [s.shareLinkId, s]));
  const roots = shares.filter((s) => !s.parentLinkId || !byId.has(s.parentLinkId));
  return roots.map((share) => ({
    share,
    reshares: shares.filter((s) => s.parentLinkId === share.shareLinkId),
  }));
}

// --- Asset Activity: one file, one unbroken log -------------------------------

export type ActivityEventType =
  | 'PROTECTED' | 'PROTECTED_AGAIN' | 'VAULT_STORED' | 'VAULT_VIEWED'
  | 'VAULT_DOWNLOADED' | 'VAULT_ISSUE' | 'RENAMED' | 'DELETED' | 'ARCHIVED'
  | 'CERTIFICATE_ISSUED' | 'CERTIFICATE_CHECKED' | 'CERTIFICATE_REVOKED' | 'CERTIFICATE_EXPIRED'
  | 'PORTFOLIO_ADDED' | 'PORTFOLIO_PUBLISHED' | 'PORTFOLIO_VIEWED'
  | 'SHARE_CREATED' | 'SHARE_FORWARDED' | 'SHARE_VIEWED' | 'SHARE_DOWNLOADED'
  | 'SHARE_COPIED' | 'SHARE_SCREENSHOT' | 'SHARE_STOPPED' | 'SHARE_EXPIRED' | 'SHARE_RISK'
  | 'EXCHANGE_LIST_STARTED' | 'EXCHANGE_LISTED' | 'EXCHANGE_UNLISTED' | 'EXCHANGE_VIEWED'
  | 'SOLD' | 'CART_ADDED' | 'WISHLIST_ADDED'
  | 'MONITORING_STARTED' | 'FOUND_ONLINE' | 'TAMPERING' | 'DUPLICATE_BLOCKED'
  | 'INVESTIGATION_STARTED' | 'INVESTIGATION_COMPLETED' | 'EVIDENCE_CREATED'
  | 'VERSION_APPROVED' | 'VERSION_CHANGES' | 'STATUS_CHANGE' | 'NOTE'
  /** Added on the client from this browser's own comparison reports. */
  | 'COMPARED';

export interface ActivityEvent {
  id: string;
  at: string;
  type: ActivityEventType;
  title: string;
  detail: string;
  meta?: Record<string, string>;
  token?: string;
}

export interface ActivityFile {
  key: string;
  assetId: string;
  assetIds: string[];
  dnaIds: string[];
  vaultIds: string[];
  filename: string;
  otherFilenames: string[];
  assetType: string;
  status: string;
  sizeBytes: number;
  protectedAt: string;
  lastActivityAt: string;
  timesProtected: number;
  certificateId: string | null;
  deleted: boolean;
  events: ActivityEvent[];
}

export interface OwnerActivity {
  files: ActivityFile[];
  unavailable: string[];
}

/** One row per protected file — never one per protection run, never a video frame. */
export async function getOwnerActivity(): Promise<OwnerActivity> {
  const { data } = await api.get<{ files?: ActivityFile[]; unavailable?: string[] }>(
    `${API_BASE_URL}/tracking/activity`,
  );
  return { files: data.files ?? [], unavailable: data.unavailable ?? [] };
}
