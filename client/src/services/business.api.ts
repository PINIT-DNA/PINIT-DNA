/** Business Account — Client / Campaign API. Uses the JWT-authenticated `api` instance. */
import { api } from './dashboard.api';
import { API_BASE_URL } from '../config/api.config';

export interface BusinessClient {
  id: string;
  name: string;
  companyName: string | null;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  campaignCount: number;
}

export interface Campaign {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
  startDate: string | null;
  endDate: string | null;
  budgetCents: number | null;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  memberCount: number;
  client?: { id: string; name: string };
}

export interface CampaignMember {
  id: string;
  userId: string | null;
  name: string | null;
  shortId: string | null;
  platform: string | null;
  profileUrl: string | null;
  roleLabel: string | null;
  isExternal: boolean;
  addedAt: string;
}

export interface CampaignAsset {
  id: string;
  originalFilename: string;
  assetType: string;
  status: string;
  mimeType: string;
  sizeBytes: number;
  vaultId: string | null;
  createdAt: string;
}

export interface CampaignActivityItem {
  id: string;
  createdAt: string;
  action: string;
  title: string;
}

export interface BusinessOverview {
  clientCount: number;
  campaignCount: number;
  assetCount: number;
  creatorCount: number;
  recentClients: BusinessClient[];
  recentCampaigns: Array<{
    id: string;
    name: string;
    clientName: string;
    assetCount: number;
    memberCount: number;
    status: string;
  }>;
}

const BASE = `${API_BASE_URL}/business`;

/**
 * Guarantee the list fields exist before anything renders them.
 *
 * Consumers do `data.recentClients.map(...)` after checking only `!data`, so an
 * overview that arrives without its arrays would throw "Cannot read properties
 * of undefined" and take the route down — the same failure that hit Vault
 * check in production. Normalising here fixes it for every caller at once.
 */
export async function getBusinessOverview(): Promise<BusinessOverview> {
  const { data } = await api.get<{ success: boolean; overview: BusinessOverview }>(`${BASE}/overview`);
  const o = (data?.overview ?? {}) as Partial<BusinessOverview>;
  return {
    clientCount: o.clientCount ?? 0,
    campaignCount: o.campaignCount ?? 0,
    assetCount: o.assetCount ?? 0,
    creatorCount: o.creatorCount ?? 0,
    recentClients: Array.isArray(o.recentClients) ? o.recentClients : [],
    recentCampaigns: Array.isArray(o.recentCampaigns) ? o.recentCampaigns : [],
  };
}

export async function listClients(): Promise<BusinessClient[]> {
  const { data } = await api.get<{ success: boolean; clients: BusinessClient[] }>(`${BASE}/clients`);
  return Array.isArray(data?.clients) ? data.clients : [];
}

export async function getClient(clientId: string): Promise<BusinessClient> {
  const { data } = await api.get<{ success: boolean; client: BusinessClient }>(`${BASE}/clients/${clientId}`);
  return data.client;
}

export interface ClientInput {
  name: string;
  companyName?: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
}

export async function createClient(input: ClientInput): Promise<BusinessClient> {
  const { data } = await api.post<{ success: boolean; client: BusinessClient }>(`${BASE}/clients`, input);
  return data.client;
}

export async function updateClient(clientId: string, input: Partial<ClientInput>): Promise<BusinessClient> {
  const { data } = await api.patch<{ success: boolean; client: BusinessClient }>(`${BASE}/clients/${clientId}`, input);
  return data.client;
}

export async function deleteClient(clientId: string): Promise<void> {
  await api.delete(`${BASE}/clients/${clientId}`);
}

export async function listCampaigns(clientId: string): Promise<Campaign[]> {
  const { data } = await api.get<{ success: boolean; campaigns: Campaign[] }>(`${BASE}/clients/${clientId}/campaigns`);
  return Array.isArray(data?.campaigns) ? data.campaigns : [];
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  const { data } = await api.get<{ success: boolean; campaign: Campaign }>(`${BASE}/campaigns/${campaignId}`);
  return data.campaign;
}

export interface CampaignInput {
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  budgetCents?: number;
}

export async function createCampaign(clientId: string, input: CampaignInput): Promise<Campaign> {
  const { data } = await api.post<{ success: boolean; campaign: Campaign }>(`${BASE}/clients/${clientId}/campaigns`, input);
  return data.campaign;
}

export async function updateCampaign(campaignId: string, input: Partial<CampaignInput & { status: string }>): Promise<Campaign> {
  const { data } = await api.patch<{ success: boolean; campaign: Campaign }>(`${BASE}/campaigns/${campaignId}`, input);
  return data.campaign;
}

export async function deleteCampaign(campaignId: string): Promise<void> {
  await api.delete(`${BASE}/campaigns/${campaignId}`);
}

export async function listCampaignMembers(campaignId: string): Promise<CampaignMember[]> {
  const { data } = await api.get<{ success: boolean; members: CampaignMember[] }>(`${BASE}/campaigns/${campaignId}/members`);
  return Array.isArray(data?.members) ? data.members : [];
}

export interface CampaignMemberInput {
  /** Internal staff to connect. Named `memberUserId`, not `userId`, because the
   *  API strips `userId`-style keys from request bodies as an anti-spoofing guard. */
  memberUserId?: string;
  name?: string;
  platform?: string;
  profileUrl?: string;
  roleLabel?: string;
}

export async function addCampaignMember(campaignId: string, input: CampaignMemberInput): Promise<CampaignMember> {
  const { data } = await api.post<{ success: boolean; member: CampaignMember }>(`${BASE}/campaigns/${campaignId}/members`, input);
  return data.member;
}

export async function removeCampaignMember(campaignId: string, memberId: string): Promise<void> {
  await api.delete(`${BASE}/campaigns/${campaignId}/members/${memberId}`);
}

export async function listCampaignAssets(campaignId: string): Promise<CampaignAsset[]> {
  const { data } = await api.get<{ success: boolean; assets: CampaignAsset[] }>(`${BASE}/campaigns/${campaignId}/assets`);
  return Array.isArray(data?.assets) ? data.assets : [];
}

export async function listCampaignActivity(campaignId: string): Promise<CampaignActivityItem[]> {
  const { data } = await api.get<{ success: boolean; activity: CampaignActivityItem[] }>(`${BASE}/campaigns/${campaignId}/activity`);
  return Array.isArray(data?.activity) ? data.activity : [];
}

// ── Asset versions ───────────────────────────────────────────────────────────
// The immutable revision chain. Each version owns its own DNA/vault/certificate,
// so a new version is an insert and prior versions are never rewritten.

export type ReviewStatus =
  | 'DRAFT' | 'IN_REVIEW' | 'CHANGES_REQUESTED'
  | 'IN_PROGRESS' | 'APPROVED' | 'SUPERSEDED';

export interface AssetVersion {
  id: string;
  versionNumber: number;
  reviewStatus: ReviewStatus;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  dnaRecordId: string | null;
  vaultId: string | null;
  certificateId: string | null;
  contentHash: string | null;
  changeSummary: string | null;
  createdByUserId: string;
  createdAt: string;
  supersededAt: string | null;
  isProtected: boolean;
}

export interface VersionList {
  versions: AssetVersion[];
  currentVersionId: string | null;
  currentVersionNumber: number | null;
}

export async function listAssetVersions(assetId: string): Promise<VersionList> {
  const { data } = await api.get<{ success: boolean } & VersionList>(`${BASE}/assets/${assetId}/versions`);
  return {
    versions: Array.isArray(data?.versions) ? data.versions : [],
    currentVersionId: data?.currentVersionId ?? null,
    currentVersionNumber: data?.currentVersionNumber ?? null,
  };
}

export async function setVersionReviewStatus(
  versionId: string,
  status: ReviewStatus,
  note?: string,
): Promise<AssetVersion> {
  const { data } = await api.patch<{ success: boolean; version: AssetVersion }>(
    `${BASE}/versions/${versionId}/review-status`, { status, note },
  );
  return data.version;
}

// ── Review comments and change requests ──────────────────────────────────────

export type CommentKind = 'COMMENT' | 'CHANGE_REQUEST';
export type CommentStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED' | 'CLOSED';

/** Where a comment points. Validated server-side; never trust an unknown shape. */
export type CommentAnchor =
  | { type: 'page'; page: number }
  | { type: 'coordinate'; x: number; y: number }
  | { type: 'timestamp'; seconds: number }
  | { type: 'text'; quote: string; page?: number; prefix?: string; suffix?: string };

export interface ReviewComment {
  id: string;
  kind: CommentKind;
  status: CommentStatus;
  body: string;
  authorLabel: string;
  authorUserId: string | null;
  isClient: boolean;
  anchor: CommentAnchor | null;
  anchorOrphaned: boolean;
  mentionedUserIds: string[];
  versionId: string;
  parentId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  replies: ReviewComment[];
}

export interface CommentThreads {
  comments: ReviewComment[];
  counts: { open: number; resolved: number; openChangeRequests: number };
}

export async function listVersionComments(
  versionId: string,
  filter: { status?: CommentStatus; kind?: CommentKind } = {},
): Promise<CommentThreads> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set('status', filter.status);
  if (filter.kind) qs.set('kind', filter.kind);
  const suffix = qs.toString() ? `?${qs}` : '';
  const { data } = await api.get<{ success: boolean } & CommentThreads>(
    `${BASE}/versions/${versionId}/comments${suffix}`,
  );
  return {
    comments: Array.isArray(data?.comments) ? data.comments : [],
    counts: data?.counts ?? { open: 0, resolved: 0, openChangeRequests: 0 },
  };
}

export async function createVersionComment(
  versionId: string,
  input: {
    body: string;
    kind?: CommentKind;
    parentId?: string | null;
    anchor?: CommentAnchor | null;
    mentionedUserIds?: string[];
  },
): Promise<ReviewComment> {
  const { data } = await api.post<{ success: boolean; comment: ReviewComment }>(
    `${BASE}/versions/${versionId}/comments`, input,
  );
  return data.comment;
}

export async function setCommentStatus(commentId: string, status: CommentStatus): Promise<ReviewComment> {
  const { data } = await api.patch<{ success: boolean; comment: ReviewComment }>(
    `${BASE}/comments/${commentId}/status`, { status },
  );
  return data.comment;
}

export async function listCampaignChangeRequests(campaignId: string): Promise<ReviewComment[]> {
  const { data } = await api.get<{ success: boolean; changeRequests: ReviewComment[] }>(
    `${BASE}/campaigns/${campaignId}/change-requests`,
  );
  return Array.isArray(data?.changeRequests) ? data.changeRequests : [];
}

// ── Version approvals ────────────────────────────────────────────────────────
// Insert-only decisions carrying identity evidence. Never updated.

export type ApprovalDecision = 'APPROVED' | 'CHANGES_REQUESTED';

export interface VersionApproval {
  id: string;
  decision: ApprovalDecision;
  comment: string | null;
  approverLabel: string;
  byClient: boolean;
  identityVerified: boolean;
  versionId: string;
  assetId: string;
  createdAt: string;
}

export async function listCampaignApprovals(campaignId: string): Promise<VersionApproval[]> {
  const { data } = await api.get<{ success: boolean; decisions: VersionApproval[] }>(
    `${BASE}/campaigns/${campaignId}/approvals`,
  );
  return Array.isArray(data?.decisions) ? data.decisions : [];
}

export async function decideVersion(
  versionId: string,
  decision: ApprovalDecision,
  comment?: string,
): Promise<{ approval: VersionApproval; reviewStatus: ReviewStatus }> {
  const { data } = await api.post<{ success: boolean; approval: VersionApproval; reviewStatus: ReviewStatus }>(
    `${BASE}/versions/${versionId}/decision`, { decision, comment },
  );
  return { approval: data.approval, reviewStatus: data.reviewStatus };
}

// ── Campaign conversation ────────────────────────────────────────────────────

export interface CampaignMessage {
  id: string;
  body: string;
  authorLabel: string;
  isClient: boolean;
  isSystem: boolean;
  assetId: string | null;
  versionId: string | null;
  createdAt: string;
  readByOther: boolean;
}

export async function listCampaignMessages(
  campaignId: string, assetId?: string,
): Promise<{ messages: CampaignMessage[]; unread: number }> {
  const qs = assetId ? `?assetId=${encodeURIComponent(assetId)}` : '';
  const { data } = await api.get<{ success: boolean; messages: CampaignMessage[]; unread: number }>(
    `${BASE}/campaigns/${campaignId}/messages${qs}`,
  );
  return { messages: Array.isArray(data?.messages) ? data.messages : [], unread: data?.unread ?? 0 };
}

export async function sendCampaignMessage(
  campaignId: string, body: string, opts: { assetId?: string; versionId?: string } = {},
): Promise<CampaignMessage> {
  const { data } = await api.post<{ success: boolean; message: CampaignMessage }>(
    `${BASE}/campaigns/${campaignId}/messages`, { body, ...opts },
  );
  return data.message;
}

export async function markCampaignMessagesRead(campaignId: string): Promise<void> {
  await api.post(`${BASE}/campaigns/${campaignId}/messages/read`, {});
}

/** SSE endpoint that ticks when this campaign's conversation changes. */
export function campaignMessageStreamUrl(campaignId: string): string {
  return `${API_BASE_URL}/business/campaigns/${campaignId}/messages/stream`;
}
