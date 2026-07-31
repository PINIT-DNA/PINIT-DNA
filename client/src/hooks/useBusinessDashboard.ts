import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  getDashboardStats,
  getDashboardSecurityInsights,
  listVaultRecords,
  listCertificates,
  api,
} from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { listForensicReports, type StoredForensicReport } from '../lib/forensic-reports-storage';
import { withTimeout } from '../lib/promise-timeout';
import type { DashboardSecurityInsights } from '../services/dashboard.api';
import type { DashboardStats } from '../types/dashboard.types';
import type { VaultRecord, IssuedCertificate } from '../types/dashboard.types';
import type { NotificationItem } from '../lib/notification-config';

export interface ActivityEvent {
  id: string;
  type: string;
  detail: string;
  date: string;
}

export interface MonitorStats {
  totalMonitored: number;
  activeMonitors: number;
  pendingAlerts: number;
  confirmedMatches: number;
  totalRuns: number;
}

export interface CrawlAlertPreview {
  id: string;
  url: string;
  matchType: string;
  similarity: number;
  filename: string;
  checkedAt?: string;
}

export interface ShareLinkPreview {
  id: string;
  token: string;
  filename: string;
  viewCount: number;
  downloadCount: number;
  isActive: boolean;
  createdAt: string;
  accessLogs: Array<{
    country: string | null;
    device: string | null;
    action: string;
    createdAt: string;
  }>;
}

export interface ShareGlobalStats {
  totalViews: number;
  uniqueRecipients: number;
  countriesReached: number;
  downloads: number;
}

export interface BusinessDashboardData {
  stats: DashboardStats | null;
  security: DashboardSecurityInsights | null;
  vaultRecords: VaultRecord[];
  certificates: IssuedCertificate[];
  monitorStats: MonitorStats | null;
  pendingAlerts: CrawlAlertPreview[];
  shareLinks: ShareLinkPreview[];
  shareStats: ShareGlobalStats | null;
  activityEvents: ActivityEvent[];
  notifications: NotificationItem[];
  unreadNotifications: number;
  investigations: StoredForensicReport[];
}

const EMPTY: BusinessDashboardData = {
  stats: null,
  security: null,
  vaultRecords: [],
  certificates: [],
  monitorStats: null,
  pendingAlerts: [],
  shareLinks: [],
  shareStats: null,
  activityEvents: [],
  notifications: [],
  unreadNotifications: 0,
  investigations: [],
};

async function fetchAll(): Promise<BusinessDashboardData> {
  const REQ_MS = 28_000;

  const [
    stats,
    security,
    vaultRecords,
    certificates,
    monitorStatsRes,
    alertsRes,
    shareRes,
    shareGlobalRes,
    activityRes,
    notifRes,
  ] = await Promise.all([
    withTimeout(getDashboardStats().catch(() => null), REQ_MS, null),
    withTimeout(getDashboardSecurityInsights().catch(() => null), REQ_MS, null),
    withTimeout(listVaultRecords().catch(() => []), REQ_MS, []),
    withTimeout(listCertificates().catch(() => []), REQ_MS, []),
    withTimeout(api.get(`${API_BASE_URL}/monitor/stats`).catch(() => ({ data: null })), REQ_MS, { data: null }),
    withTimeout(api.get(`${API_BASE_URL}/monitor/alerts?status=PENDING`).catch(() => ({ data: null })), REQ_MS, { data: null }),
    withTimeout(api.get(`${API_BASE_URL}/share`).catch(() => ({ data: null })), REQ_MS, { data: null }),
    withTimeout(api.get(`${API_BASE_URL}/share/analytics/global`).catch(() => ({ data: null })), REQ_MS, { data: null }),
    withTimeout(api.get(`${API_BASE_URL}/profile/activity?limit=25`).catch(() => ({ data: null })), REQ_MS, { data: null }),
    withTimeout(api.get(`${API_BASE_URL}/notifications?limit=8&sort=createdAt`).catch(() => ({ data: null })), REQ_MS, { data: null }),
  ]);
  const monitorStats = monitorStatsRes.data as MonitorStats | null;
  const alertsPayload = alertsRes.data as { alerts?: CrawlAlertPreview[] } | null;
  const rawAlerts = alertsPayload?.alerts ?? [];
  const pendingAlerts = rawAlerts.slice(0, 6).map((a) => ({
    ...a,
    filename: (a as { monitorRecord?: { filename?: string } }).monitorRecord?.filename ?? a.filename ?? 'Monitored asset',
  }));

  const sharePayload = shareRes.data as { links?: ShareLinkPreview[] } | null;
  const shareLinks = (sharePayload?.links ?? []).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const shareGlobal = shareGlobalRes.data as { stats?: ShareGlobalStats } | null;

  const activityPayload = activityRes.data as {
    events?: Array<{ id: string; type: string; detail: string; date: string }>;
  } | null;
  const activityEvents = (activityPayload?.events ?? []).map((e) => ({
    ...e,
    date: typeof e.date === 'string' ? e.date : new Date(e.date).toISOString(),
  }));

  const notifPayload = notifRes.data as {
    notifications?: NotificationItem[];
    unreadCount?: number;
  } | null;

  return {
    stats,
    security,
    vaultRecords,
    certificates,
    monitorStats,
    pendingAlerts,
    shareLinks,
    shareStats: shareGlobal?.stats ?? null,
    activityEvents,
    notifications: notifPayload?.notifications ?? [],
    unreadNotifications: notifPayload?.unreadCount ?? 0,
    investigations: listForensicReports().filter((r) => r.kind === 'investigation'),
  };
}

export function useBusinessDashboard(pollMs = 30_000) {
  const [data, setData] = useState<BusinessDashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const next = await fetchAll();
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(true), pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return {
    ...data,
    loading,
    refreshing,
    error,
    refetch: () => load(true),
  };
}

export function fmtAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

export const ACTIVITY_LABELS: Record<string, string> = {
  DNA_GENERATED: 'DNA generated',
  VAULT_UPLOAD: 'Asset vaulted',
  SHARE_CREATED: 'Asset shared',
  CERT_GENERATED: 'Certificate issued',
  ACCESS_VIEWED: 'Asset viewed',
  ACCESS_DOWNLOADED: 'Asset downloaded',
  RISK_EVENT: 'Risk event',
};

export const ACTIVITY_ICONS: Record<string, string> = {
  DNA_GENERATED: 'text-dna-400',
  VAULT_UPLOAD: 'text-emerald-400',
  SHARE_CREATED: 'text-blue-400',
  CERT_GENERATED: 'text-purple-400',
  ACCESS_VIEWED: 'text-cyan-400',
  ACCESS_DOWNLOADED: 'text-cyan-400',
  RISK_EVENT: 'text-red-400',
};
