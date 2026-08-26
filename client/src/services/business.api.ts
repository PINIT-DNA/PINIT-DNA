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

// ── Campaign people and scoped access ────────────────────────────────────────

export type MemberAccessStatus = 'NONE' | 'INVITED' | 'ACTIVE' | 'REVOKED';

export interface CampaignPerson {
  id: string;
  kind: 'internal' | 'external';
  name: string;
  shortId: string | null;
  email: string | null;
  platform: string | null;
  profileUrl: string | null;
  roleLabel: string | null;
  orgRole: string | null;
  accessStatus: MemberAccessStatus;
  permissions: { canComment: boolean; canRequestChanges: boolean; canApprove: boolean } | null;
  assets: Array<{ assetId: string; filename: string; hasLink: boolean }>;
  lastAccessAt: string | null;
  addedAt: string;
}

export interface CampaignPeople {
  client: { name: string; contactName: string | null; contactEmail: string | null } | null;
  people: CampaignPerson[];
}

export async function listCampaignPeople(campaignId: string): Promise<CampaignPeople> {
  const { data } = await api.get<{ success: boolean } & CampaignPeople>(
    `${BASE}/campaigns/${campaignId}/people`,
  );
  return { client: data?.client ?? null, people: Array.isArray(data?.people) ? data.people : [] };
}

export interface AccessGrantInput {
  assetIds: string[];
  canComment?: boolean;
  canRequestChanges?: boolean;
  canApprove?: boolean;
  expiresInHours?: number | null;
}

export async function grantCampaignAccess(
  campaignId: string, memberId: string, input: AccessGrantInput,
): Promise<{ issued: Array<{ assetId: string; filename: string; token: string | null }> }> {
  const { data } = await api.post<{ success: boolean; issued: Array<{ assetId: string; filename: string; token: string | null }> }>(
    `${BASE}/campaigns/${campaignId}/people/${memberId}/access`, input,
  );
  return { issued: Array.isArray(data?.issued) ? data.issued : [] };
}

export async function updateCampaignAccess(
  campaignId: string, memberId: string,
  perms: { canComment?: boolean; canRequestChanges?: boolean; canApprove?: boolean },
): Promise<void> {
  await api.patch(`${BASE}/campaigns/${campaignId}/people/${memberId}/access`, perms);
}

export async function revokeCampaignAccess(
  campaignId: string, memberId: string, assetId?: string,
): Promise<void> {
  const qs = assetId ? `?assetId=${encodeURIComponent(assetId)}` : '';
  await api.delete(`${BASE}/campaigns/${campaignId}/people/${memberId}/access${qs}`);
}

export interface AccessLink {
  token: string;
  filename: string;
  active: boolean;
  expiresAt: string | null;
  viewCount: number;
}

export async function listCampaignAccessLinks(
  campaignId: string, memberId: string,
): Promise<AccessLink[]> {
  const { data } = await api.get<{ success: boolean; links: AccessLink[] }>(
    `${BASE}/campaigns/${campaignId}/people/${memberId}/links`,
  );
  return Array.isArray(data?.links) ? data.links : [];
}

// ── Rights (Exchange remains the source of truth; this only presents it) ─────

export type RightsState =
  | 'NONE' | 'AVAILABLE' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'RESTRICTED' | 'UNKNOWN';

export interface AssetRights {
  assetId: string;
  /** What the rights mean right now — distinct from where the asset sits on Exchange. */
  rightsState: RightsState;
  filename: string;
  assetType: string;
  addedAt: string;
  protection: {
    hasDna: boolean;
    hasVault: boolean;
    certificateId: string | null;
    certificateStatus: string | null;
    certificateIssuedAt: string | null;
    certificateExpiresAt: string | null;
  };
  review: { currentVersion: number | null; reviewStatus: string | null; versionCount: number };
  owner: { name: string | null; pinitId: string | null };
  licence: {
    state: 'none' | 'listed' | 'licensed';
    tier: string | null;
    commercialUse: boolean | null;
    permittedUse: string | null;
    status: string | null;
    expiresAt: string | null;
    licensedTo: string | null;
    licensedAt: string | null;
    termsVersion: string | null;
    termsAcceptedAt: string | null;
    downloadLimit: number | null;
    downloadCount: number | null;
    restrictions: string[];
  };
  access: Array<{ name: string; kind: string; status: string }>;
}

export interface CampaignRights {
  campaignName: string;
  clientName: string | null;
  clientContact: string | null;
  exchangeReachable: boolean;
  assets: AssetRights[];
}

export async function listCampaignRights(campaignId: string): Promise<CampaignRights> {
  const { data } = await api.get<{ success: boolean } & CampaignRights>(
    `${BASE}/campaigns/${campaignId}/rights`,
  );
  return {
    campaignName: data?.campaignName ?? '',
    clientName: data?.clientName ?? null,
    clientContact: data?.clientContact ?? null,
    exchangeReachable: Boolean(data?.exchangeReachable),
    assets: Array.isArray(data?.assets) ? data.assets : [],
  };
}

// ── Client handover ──────────────────────────────────────────────────────────

export type HandoverStatus = 'DRAFT' | 'READY' | 'COMPLETED' | 'REVOKED';

export interface HandoverCandidate {
  assetId: string;
  filename: string;
  eligible: boolean;
  versionId: string | null;
  versionNumber: number | null;
  reason: string | null;
}

export interface HandoverCandidates {
  campaignName: string;
  client: { id: string; name: string; contactName: string | null } | null;
  candidates: HandoverCandidate[];
}

export interface Handover {
  id: string;
  status: HandoverStatus;
  title: string | null;
  note: string | null;
  recipientLabel: string;
  recipientEmail: string | null;
  accessToken: string;
  createdAt: string;
  sentAt: string | null;
  firstOpenedAt: string | null;
  completedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  openCount: number;
  assets: Array<{ assetId: string; filename: string; versionId: string; hasLink: boolean }>;
}

export async function listHandoverCandidates(campaignId: string): Promise<HandoverCandidates> {
  const { data } = await api.get<{ success: boolean } & HandoverCandidates>(
    `${BASE}/campaigns/${campaignId}/handover/candidates`,
  );
  return {
    campaignName: data?.campaignName ?? '',
    client: data?.client ?? null,
    candidates: Array.isArray(data?.candidates) ? data.candidates : [],
  };
}

export async function listHandovers(campaignId: string): Promise<Handover[]> {
  const { data } = await api.get<{ success: boolean; handovers: Handover[] }>(
    `${BASE}/campaigns/${campaignId}/handovers`,
  );
  return Array.isArray(data?.handovers) ? data.handovers : [];
}

export async function createHandover(
  campaignId: string,
  input: {
    assetIds: string[]; title?: string; note?: string;
    recipientLabel?: string; recipientEmail?: string;
    expiresInHours?: number | null; allowDownload?: boolean;
  },
): Promise<Handover> {
  const { data } = await api.post<{ success: boolean; handover: Handover }>(
    `${BASE}/campaigns/${campaignId}/handovers`, input,
  );
  return data.handover;
}

export async function sendHandover(campaignId: string, handoverId: string): Promise<Handover> {
  const { data } = await api.post<{ success: boolean; handover: Handover }>(
    `${BASE}/campaigns/${campaignId}/handovers/${handoverId}/send`, {},
  );
  return data.handover;
}

export async function revokeHandover(campaignId: string, handoverId: string): Promise<Handover> {
  const { data } = await api.delete<{ success: boolean; handover: Handover }>(
    `${BASE}/campaigns/${campaignId}/handovers/${handoverId}`,
  );
  return data.handover;
}

// ── Monitoring (Phase C, layer 1) ────────────────────────────────────────────
// Scopes the existing monitor engine to a campaign. No second crawler or
// finding store — MonitorRecord, MonitoringRun and AssetDiscovery already exist.

export type ProviderHealth = 'OPERATIONAL' | 'DEGRADED' | 'NOT_CONFIGURED' | 'UNKNOWN';

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  health: ProviderHealth;
  healthReason: string;
  finds: string;
  requires: string | null;
}

export interface DiscoveryCapability {
  crawlerEnabled: boolean;
  anyProviderConfigured: boolean;
  anyProviderOperational: boolean;
  reverseImageAvailable: boolean;
  providers: ProviderStatus[];
  lastCandidateAt: string | null;
  lastMatchAt: string | null;
  evidence: { totalRuns: number; runsWithCandidates: number; totalMatches: number };
  summary: string;
}

export interface MonitoredAsset {
  assetId: string;
  filename: string;
  assetType: string;
  canMonitor: boolean;
  monitoring: {
    enabled: boolean;
    status: string;
    scanType: string;
    everyHours: number;
    lastScanAt: string | null;
    nextScanAt: string | null;
    totalScans: number;
    totalMatches: number;
    totalFailures: number;
  } | null;
  findings: {
    total: number; needsReview: number; confirmed: number; dismissed: number;
    lastAt: string | null;
  };
  recentScans: Array<{
    id: string; status: string; trigger: string;
    startedAt: string; completedAt: string | null; durationMs: number | null;
    candidatesFound: number; matchesFound: number; failureReason: string | null;
  }>;
}

export interface CampaignMonitoring {
  campaignName: string;
  capability: DiscoveryCapability;
  assets: MonitoredAsset[];
  totals: { monitored: number; findings: number; needsReview: number; confirmed: number };
}

export async function listCampaignMonitoring(campaignId: string): Promise<CampaignMonitoring> {
  const { data } = await api.get<{ success: boolean } & CampaignMonitoring>(
    `${BASE}/campaigns/${campaignId}/monitoring`,
  );
  return data;
}

export async function enableMonitoring(campaignId: string, assetId: string): Promise<void> {
  await api.post(`${BASE}/campaigns/${campaignId}/monitoring/${assetId}`, {});
}

export async function disableMonitoring(campaignId: string, assetId: string): Promise<void> {
  await api.delete(`${BASE}/campaigns/${campaignId}/monitoring/${assetId}`);
}

// ── Findings (Phase C, layer 2) ──────────────────────────────────────────────
// Reads AssetDiscovery, which the existing pipeline writes only on a real match.

export type FindingStatus = 'PENDING' | 'CONFIRMED' | 'DISMISSED';

export interface Finding {
  id: string;
  assetId: string;
  assetName: string;
  status: FindingStatus;
  url: string;
  platform: string | null;
  pageTitle: string | null;
  similarity: number;
  confidence: number;
  severity: string;
  riskScore: number;
  tampered: boolean;
  tampering: string;
  matchBand: string;
  matchLabel: string;
  matchMeaning: string;
  firstSeen: string;
  lastSeen: string;
  createdAt: string;
  investigationId: string | null;
}

export interface CampaignFindings {
  campaignName: string;
  findings: Finding[];
  counts: { total: number; pending: number; confirmed: number; dismissed: number };
  /** Lets the empty state explain itself: nothing found vs nothing looked for. */
  context: { assetsInCampaign: number; assetsMonitored: number };
}

export async function listCampaignFindings(
  campaignId: string, status?: FindingStatus, assetId?: string,
): Promise<CampaignFindings> {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (assetId) qs.set('assetId', assetId);
  const suffix = qs.toString() ? `?${qs}` : '';
  const { data } = await api.get<{ success: boolean } & CampaignFindings>(
    `${BASE}/campaigns/${campaignId}/findings${suffix}`,
  );
  return data;
}

export async function decideFinding(
  findingId: string, status: 'CONFIRMED' | 'DISMISSED', note?: string,
): Promise<void> {
  await api.patch(`${BASE}/findings/${findingId}`, { status, note });
}

// ── Campaign intelligence (Phase C, layer 3) ─────────────────────────────────
// Aggregates real rows from every earlier layer. No new storage.

export interface CampaignIntelligence {
  campaign: {
    id: string; name: string; status: string; clientName: string | null;
    startDate: string | null; endDate: string | null;
  };
  protection: { assets: number; withDna: number; withVault: number; withCertificate: number };
  review: {
    versions: number; approved: number; inReview: number; changesRequested: number;
    draft: number; superseded: number; openChangeRequests: number; totalComments: number;
  };
  client: {
    name: string | null; approvalsGiven: number; changesRequested: number;
    commentsWritten: number; messagesSent: number; unreadFromClient: number;
    lastHeardFrom: string | null;
  };
  creators: {
    total: number; withAccess: number; revoked: number; neverGranted: number;
    assetsShared: number;
    people: Array<{ name: string; accessStatus: string; assetCount: number; lastAccessAt: string | null }>;
  };
  monitoring: {
    capability: {
      crawlerEnabled: boolean; anyProviderOperational: boolean;
      summary: string; lastMatchAt: string | null;
    };
    monitored: number; monitorable: number; lastScanAt: string | null; totalScans: number;
  };
  findings: {
    total: number; needsReview: number; confirmed: number; dismissed: number; highPriority: number;
  };
  investigations: {
    total: number; open: number; resolved: number; evidenceItems: number;
    recent: Array<{
      code: string; severity: string; status: string; trigger: string;
      openedAt: string; resolvedAt: string | null; evidenceCount: number;
    }>;
  };
  handover: {
    total: number; completed: number; awaitingClient: number; draft: number; revoked: number;
    assetsDelivered: number;
    latest: { status: string; recipientLabel: string; sentAt: string | null; openedAt: string | null } | null;
  };
  sharing: { links: number; active: number; reviewLinks: number; totalViews: number };
  assets: Array<{
    id: string; filename: string; assetType: string; protectedAt: string;
    protection: { dna: boolean; vault: boolean; certificate: boolean };
    version: { number: number; status: string } | null;
    versionCount: number; creatorsWithAccess: number; monitored: boolean;
    findings: number; findingsNeedingReview: number; handedOver: boolean;
  }>;
  recentActivity: Array<{ id: string; action: string; title: string; at: string }>;
}

export async function getCampaignIntelligence(campaignId: string): Promise<CampaignIntelligence> {
  const { data } = await api.get<{ success: boolean; intelligence: CampaignIntelligence }>(
    `${BASE}/campaigns/${campaignId}/intelligence`,
  );
  return data.intelligence;
}

// ── Investigations (Phase C, layer 4) ────────────────────────────────────────
// Case management over the existing incident record. No new investigation model.

export type InvestigationStatus =
  | 'OPEN' | 'INVESTIGATING' | 'AWAITING_CLIENT' | 'RESOLVED' | 'DISMISSED';

export type InvestigationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Investigation {
  id: string;
  /** Human case reference, safe to quote to a client. Not a database id. */
  caseCode: string;
  title: string;
  description: string;
  priority: InvestigationPriority;
  status: InvestigationStatus;
  statusMeaning: string;
  isTerminal: boolean;
  openedBecause: string;
  campaignId: string | null;
  assetId: string | null;
  findingId: string | null;
  assignedToUserId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  closedAt: string | null;
}

export interface InvestigationVocabulary {
  statuses: { id: InvestigationStatus; meaning: string; terminal: boolean }[];
  priorities: InvestigationPriority[];
}

export interface CampaignInvestigations {
  campaignName: string;
  investigations: Investigation[];
  counts: {
    total: number; open: number; investigating: number;
    awaitingClient: number; resolved: number; dismissed: number; active: number;
  };
  vocabulary: InvestigationVocabulary;
}

export interface InvestigationEntry {
  id: string; at: string; author: string; body: string; isSystem: boolean;
}

export interface InvestigationDetail extends Investigation {
  assignee: { id: string; name: string } | null;
  nextStatuses: InvestigationStatus[];
  timeline: InvestigationEntry[];
  evidence: {
    id: string; code: string; type: string;
    description: string | null; integrity: string | null; collectedAt: string;
  }[];
  asset: {
    id: string; filename: string;
    hasDna: boolean; hasVault: boolean; hasCertificate: boolean;
  } | null;
  finding: {
    id: string; url: string; platform: string | null;
    similarity: number; firstSeen: string;
  } | null;
}

export async function listCampaignInvestigations(
  campaignId: string, status?: InvestigationStatus,
): Promise<CampaignInvestigations> {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  const { data } = await api.get<{ success: boolean } & CampaignInvestigations>(
    `${BASE}/campaigns/${campaignId}/investigations${suffix}`,
  );
  return data;
}

export async function createInvestigation(
  campaignId: string,
  input: {
    title: string; description?: string; priority?: InvestigationPriority;
    findingId?: string; assetId?: string; assignedToUserId?: string;
  },
): Promise<Investigation> {
  const { data } = await api.post<{ success: boolean; investigation: Investigation }>(
    `${BASE}/campaigns/${campaignId}/investigations`, input,
  );
  return data.investigation;
}

export async function getInvestigation(investigationId: string): Promise<InvestigationDetail> {
  const { data } = await api.get<{ success: boolean; investigation: InvestigationDetail }>(
    `${BASE}/investigations/${investigationId}`,
  );
  return data.investigation;
}

export async function addInvestigationNote(
  investigationId: string, body: string,
): Promise<InvestigationEntry> {
  const { data } = await api.post<{ success: boolean; note: InvestigationEntry }>(
    `${BASE}/investigations/${investigationId}/notes`, { body },
  );
  return data.note;
}

/**
 * One endpoint, one intent per call.
 *
 * `reopenReason` is separate from `status` on purpose — reopening a closed case
 * is a deliberate act, not a value picked from the same dropdown.
 */
export async function updateInvestigation(
  investigationId: string,
  change:
    | { status: InvestigationStatus; resolution?: string }
    | { priority: InvestigationPriority }
    | { assignedToUserId: string | null }
    | { reopenReason: string },
): Promise<Investigation> {
  const { data } = await api.patch<{ success: boolean; investigation: Investigation }>(
    `${BASE}/investigations/${investigationId}`, change,
  );
  return data.investigation;
}
