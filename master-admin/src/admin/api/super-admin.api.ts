/**
 * Super Admin API client — isolated from user dashboard APIs.
 */
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';

const BASE = `${API_BASE_URL}/super-admin`;

export type AdminDomain = 'overview' | 'identity' | 'assets' | 'forensics' | 'operations' | 'intelligence' | 'system' | 'commerce';

export type MyCapabilities = {
  role: string;
  isOwner: boolean;
  capabilities: AdminDomain[];
  domains: { key: AdminDomain; label: string; description: string }[];
};

export async function fetchMyCapabilities() {
  const { data } = await api.get(`${BASE}/me`);
  return data as MyCapabilities;
}

export async function fetchExecutiveOverview() {
  const { data } = await api.get(`${BASE}/overview`);
  return data;
}

export type CommandCenterSummary = {
  kpis: {
    totalUsers: number;
    totalUsersDeltaPct: number | null;
    organizations: number;
    organizationsDeltaPct: number | null;
    totalAssets: number;
    totalAssetsDeltaPct: number | null;
    dnaProtected: number;
    dnaProtectedDeltaPct: number | null;
    marketplaceGmvCents: number | null;
    platformRevenueCents: number;
  };
  activityOverview: { date: string; users: number; assets: number; dnaProtected: number; revenueCents: number }[];
  sentinel: {
    totalInvestigations: number;
    totalInvestigationsDeltaPct: number | null;
    breakdown: { label: string; count: number; pct: number }[];
  };
  activityFeed: { id: string; type: string; summary: string; actor: string | null; createdAt: string }[];
  alerts: { id: string; severity: 'warning' | 'critical'; title: string; detail: string }[];
  revenueBreakdown: { label: string; amountCents: number }[];
  marketplaceAvailable: boolean;
};

export async function fetchCommandCenterSummary() {
  const { data } = await api.get(`${BASE}/command-center`);
  return data as CommandCenterSummary;
}

export type ComponentHealth = { status: 'healthy' | 'degraded' | 'unhealthy'; message: string; latencyMs?: number };
export type HealthReport = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  components: {
    database: ComponentHealth;
    vault: ComponentHealth;
    storage: ComponentHealth;
    encryption: ComponentHealth;
    supabase: ComponentHealth;
    memory: ComponentHealth;
  };
};

export async function fetchSystemHealth() {
  const { data } = await api.get(`${BASE}/health`);
  return data as HealthReport;
}

export type PlatformSummaryReport = {
  success: boolean;
  range: { from: string; to: string };
  generatedAt: string;
  newUsers: number;
  newOrganizations: number;
  dnaGenerated: number;
  certificatesIssued: number;
  incidentsOpened: number;
  incidentsResolved: number;
  incidentsBySeverity: { severity: string; count: number }[];
  revenueCents: number;
  successfulLogins: number;
  adminActionsTaken: number;
};

export async function fetchPlatformSummaryReport(params: { from: string; to: string }) {
  const { data } = await api.get(`${BASE}/reports/platform-summary`, { params });
  return data as PlatformSummaryReport;
}

export type VerificationRequestRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  requestType: string;
  status: string;
  documentType: string | null;
  submittedNote: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  user: { id: string; shortId: string; fullName: string | null; email: string | null };
  reviewer: { id: string; shortId: string; fullName: string | null } | null;
};

export async function fetchVerificationRequests(params?: { status?: string }) {
  const { data } = await api.get(`${BASE}/verification-requests`, { params });
  return data as { success: boolean; requests: VerificationRequestRow[]; total: number; pendingCount: number; approvedCount: number; rejectedCount: number };
}

export async function createVerificationRequest(body: { userId?: string; shortId?: string; requestType?: string; documentType?: string; submittedNote?: string }) {
  const { data } = await api.post(`${BASE}/verification-requests`, body);
  return data as { success: boolean; request: VerificationRequestRow };
}

export async function reviewVerificationRequest(id: string, body: { decision: 'APPROVED' | 'REJECTED'; reviewNote?: string }) {
  const { data } = await api.post(`${BASE}/verification-requests/${id}/review`, body);
  return data as { success: boolean; request: VerificationRequestRow };
}

export type SupportTicketRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  description: string;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  messageCount: number;
  user: { id: string; shortId: string; fullName: string | null; email: string | null };
};

export type SupportTicketMessageRow = {
  id: string;
  createdAt: string;
  ticketId: string;
  authorUserId: string | null;
  authorLabel: string;
  body: string;
  isInternal: boolean;
};

export async function fetchSupportTickets(params?: { status?: string; category?: string }) {
  const { data } = await api.get(`${BASE}/support-tickets`, { params });
  return data as { success: boolean; tickets: SupportTicketRow[]; total: number; openCount: number; disputeCount: number; resolvedCount: number };
}

export async function fetchSupportTicketDetail(id: string) {
  const { data } = await api.get(`${BASE}/support-tickets/${id}`);
  return data as { success: boolean; ticket: SupportTicketRow & { messages: SupportTicketMessageRow[] } };
}

export async function createSupportTicket(body: { userId?: string; shortId?: string; subject: string; category?: string; priority?: string; description: string }) {
  const { data } = await api.post(`${BASE}/support-tickets`, body);
  return data as { success: boolean; ticket: SupportTicketRow };
}

export async function addSupportTicketMessage(id: string, body: { body: string; isInternal?: boolean }) {
  const { data } = await api.post(`${BASE}/support-tickets/${id}/messages`, body);
  return data as { success: boolean; message: SupportTicketMessageRow };
}

export async function resolveSupportTicket(id: string, body: { resolutionNote?: string }) {
  const { data } = await api.post(`${BASE}/support-tickets/${id}/resolve`, body);
  return data as { success: boolean; ticket: SupportTicketRow };
}

export type NetworkOrgRow = {
  id: string;
  shortId: string;
  name: string | null;
  industry: string | null;
  owner: { shortId: string; fullName: string | null } | null;
  members: number;
  clients: number;
  campaigns: number;
  assets: number;
  networkSize: number;
};

export async function fetchNetworkOverview() {
  const { data } = await api.get(`${BASE}/network-overview`);
  return data as { success: boolean; organizations: NetworkOrgRow[]; totals: { members: number; clients: number; campaigns: number }; totalOrganizations: number };
}

export type UsageRow = {
  userId: string;
  user: { id: string; shortId: string; fullName: string | null };
  planCode: string;
  planName: string;
  usedBytes: string;
  limitBytes: string | null;
  usagePct: number | null;
};

export async function fetchUsageOverview() {
  const { data } = await api.get(`${BASE}/usage-overview`);
  return data as { success: boolean; usage: UsageRow[]; totalUsedBytes: number; nearLimitCount: number; metered: { usageRecordCount: number } };
}

export async function fetchRbacMatrix() {
  const { data } = await api.get(`${BASE}/rbac-matrix`);
  return data as {
    success: boolean;
    domains: { key: AdminDomain; label: string; description: string }[];
    matrix: Record<string, AdminDomain[]>;
    platformOwnerNote: string;
  };
}

export type SearchResult = {
  type: 'user' | 'organization' | 'asset';
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export async function fetchGlobalSearch(q: string) {
  const { data } = await api.get(`${BASE}/search`, { params: { q } });
  return data as { query: string; results: SearchResult[] };
}

export type PinitIdentity = { code: string; root: string; individual: string; business: string; exchange: string };

export async function fetchAllOrganizations(params?: { q?: string }) {
  const { data } = await api.get(`${BASE}/organizations`, { params });
  return data as { organizations: unknown[]; total: number };
}

export async function fetchOrganizationProfile(id: string) {
  const { data } = await api.get(`${BASE}/organizations/${id}`);
  return data;
}

export async function fetchAllUsers(params?: { q?: string; role?: string; active?: string }) {
  const { data } = await api.get(`${BASE}/users`, { params });
  return data as { users: unknown[]; total: number };
}

export async function fetchUserProfile(id: string) {
  const { data } = await api.get(`${BASE}/users/${id}`);
  return data;
}

export async function updateUserRole(id: string, role: string) {
  const { data } = await api.post(`${BASE}/users/${id}/role`, { role });
  return data;
}

export async function toggleUserActive(id: string) {
  const { data } = await api.post(`${BASE}/users/${id}/toggle`);
  return data;
}

export async function signOutUserEverywhere(id: string) {
  const { data } = await api.post(`${BASE}/users/${id}/sign-out-everywhere`);
  return data as { success: boolean; sessionsRevoked: number; refreshTokensDeleted: number };
}

export async function revokeSession(id: string) {
  const { data } = await api.post(`${BASE}/sessions/${id}/revoke`);
  return data;
}

export async function untrustDevice(id: string) {
  const { data } = await api.post(`${BASE}/devices/${id}/untrust`);
  return data;
}

export async function fetchAllVault(params?: { q?: string }) {
  const { data } = await api.get(`${BASE}/vault`, { params });
  return data as { files: unknown[]; total: number; totalSize: number };
}

export async function fetchAllFiles(params?: { q?: string; fileType?: string }) {
  const { data } = await api.get(`${BASE}/files`, { params });
  return data as { files: unknown[]; total: number };
}

export async function fetchAllDna(params?: { status?: string }) {
  const { data } = await api.get(`${BASE}/dna`, { params });
  return data as { records: unknown[]; total: number };
}

export async function fetchAllCertificates(params?: { status?: string }) {
  const { data } = await api.get(`${BASE}/certificates`, { params });
  return data as { certificates: unknown[]; total: number };
}

export async function fetchInvestigations() {
  const { data } = await api.get(`${BASE}/investigations`);
  return data as { investigations: unknown[]; total: number };
}

export async function fetchTracking() {
  const { data } = await api.get(`${BASE}/tracking`);
  return data;
}

export async function fetchMonitoring() {
  const { data } = await api.get(`${BASE}/monitoring`);
  return data;
}

export async function fetchAnalytics() {
  const { data } = await api.get(`${BASE}/analytics`);
  return data;
}

export async function fetchBillingOverview() {
  const { data } = await api.get(`${BASE}/billing`);
  return data;
}

export async function fetchActivity() {
  const { data } = await api.get(`${BASE}/activity`);
  return data;
}

export async function fetchAuditLogs() {
  const { data } = await api.get(`${BASE}/audit`);
  return data;
}

export type AdminAuditEvent = {
  id: string;
  createdAt: string;
  actorUserId: string;
  actorShortId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestMethod: string | null;
  requestPath: string | null;
};

export async function fetchAdminAuditLog(params?: { action?: string; targetType?: string; actorUserId?: string; limit?: number }) {
  const { data } = await api.get(`${BASE}/admin-audit`, { params });
  return data as { success: boolean; count: number; events: AdminAuditEvent[] };
}

export type PlatformNotification = {
  id: string;
  createdAt: string;
  type: string;
  title: string;
  body: string;
  severity: string;
  category: string;
  read: boolean;
  archived: boolean;
  riskLevel: string | null;
  fileName: string | null;
  user: { shortId: string; fullName: string | null };
};

export async function fetchNotifications(params?: { severity?: string; category?: string; unread?: boolean; limit?: number; offset?: number }) {
  const { data } = await api.get(`${BASE}/notifications`, { params });
  return data as { success: boolean; notifications: PlatformNotification[]; total: number; unreadCount: number; alertCount: number; hasMore: boolean };
}

export type IncidentRow = {
  id: string;
  createdAt: string;
  incidentCode: string;
  severity: string;
  status: string;
  triggerType: string;
  description: string;
  title: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  evidenceCount: number;
  dnaRecord: { id: string; imageFilename: string; ownerUser: { shortId: string; fullName: string | null } } | null;
};

export async function fetchIncidents(params?: { status?: string; severity?: string; limit?: number }) {
  const { data } = await api.get(`${BASE}/incidents`, { params });
  return data as { success: boolean; incidents: IncidentRow[]; total: number; openCount: number; highCount: number };
}

export async function fetchIncidentDetail(id: string) {
  const { data } = await api.get(`${BASE}/incidents/${id}`);
  return data as { success: boolean; incident: IncidentRow & { metadata: string | null; evidenceRecords: unknown[]; notes: unknown[] } };
}

export type BiometricTemplateInfo = { createdAt: string; algorithm: string; modelVersion: string; credentialId?: string | null } | null;

export type BiometricIdentityRow = {
  id: string;
  userId: string;
  status: string;
  enrolledAt: string;
  lastVerifiedAt: string | null;
  fusionVersion: string;
  user: { id: string; shortId: string; fullName: string | null; email: string | null; role: string };
  faceTemplate: BiometricTemplateInfo;
  voiceTemplate: BiometricTemplateInfo;
  fingerprintTemplate: BiometricTemplateInfo;
};

export async function fetchBiometricIdentities() {
  const { data } = await api.get(`${BASE}/biometric-identities`);
  return data as { success: boolean; identities: BiometricIdentityRow[]; total: number; activeCount: number; fullyEnrolledCount: number };
}

export async function fetchVaultIntelligence(vaultId: string) {
  const { data } = await api.get(`${BASE}/vault/${vaultId}/intelligence`);
  return data;
}

export async function fetchVaultTracking(vaultId: string) {
  const { data } = await api.get(`${BASE}/vault/${vaultId}/tracking`);
  return data;
}

export async function fetchVaultShares(vaultId: string) {
  const { data } = await api.get(`${BASE}/vault/${vaultId}/shares`);
  return data;
}

export async function fetchVaultTimeline(vaultId: string) {
  const { data } = await api.get(`${BASE}/vault/${vaultId}/timeline`);
  return data;
}
