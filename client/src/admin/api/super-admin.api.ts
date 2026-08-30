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

export async function fetchSystemHealth() {
  const { data } = await api.get(`${BASE}/health`);
  return data;
}

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

export async function fetchActivity() {
  const { data } = await api.get(`${BASE}/activity`);
  return data;
}

export async function fetchAuditLogs() {
  const { data } = await api.get(`${BASE}/audit`);
  return data;
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
