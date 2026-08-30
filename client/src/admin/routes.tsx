import { Navigate, RouteObject } from 'react-router-dom';
import { SuperAdminLayout } from './layout/SuperAdminLayout';
import { RequireSuperAdmin } from './components/RequireSuperAdmin';
import { RequireAuth } from '../components/auth/RequireAuth';
import { ExecutiveDashboardPage } from './pages/ExecutiveDashboardPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { OrganizationDetailPage } from './pages/OrganizationDetailPage';
import { AdminVaultExplorerPage } from './pages/AdminVaultExplorerPage';
import { AdminVaultTimelinePage } from './pages/AdminVaultTimelinePage';
import { AdminIntelligencePage } from './pages/AdminIntelligencePage';
import { AdminUnifiedInvestigationPage } from './pages/AdminUnifiedInvestigationPage';
import { FileExplorerPage } from './pages/FileExplorerPage';
import { AdminDnaPage } from './pages/AdminDnaPage';
import { AdminCertificatesPage } from './pages/AdminCertificatesPage';
import { InvestigationsPage } from './pages/InvestigationsPage';
import { TrackingPage } from './pages/TrackingPage';
import { AdminMonitoringPage } from './pages/AdminMonitoringPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AuditPage } from './pages/AuditPage';
import { TimelinePage } from './pages/TimelinePage';
import { SecurityCenterPage } from './pages/SecurityCenterPage';
import { PlaceholderPage } from './components/PlaceholderPage';
import { LightPlaceholderPage } from './components/LightPlaceholderPage';

const AdminShell = (
  <RequireAuth>
    <RequireSuperAdmin>
      <SuperAdminLayout />
    </RequireSuperAdmin>
  </RequireAuth>
);

export const superAdminRoutes: RouteObject = {
  path: '/admin',
  element: AdminShell,
  children: [
    { index: true, element: <ExecutiveDashboardPage /> },
    { path: 'users', element: <UsersPage /> },
    { path: 'users/:id', element: <UserDetailPage /> },
    { path: 'organizations', element: <OrganizationsPage /> },
    { path: 'organizations/:id', element: <OrganizationDetailPage /> },
    { path: 'marketplace', element: <LightPlaceholderPage title="Marketplace (Exchange)" description="Listings, orders, disputes and payouts from the Exchange app" note="Needs a Hub ↔ Exchange data bridge — planned Commerce release" /> },
    { path: 'billing', element: <LightPlaceholderPage title="Billing & Subscriptions" description="Plans, subscriptions, revenue and billing history" note="Summary figures already appear on the Command Center" /> },
    { path: 'credits', element: <LightPlaceholderPage title="Credits & Usage" description="Credit ledger and per-user usage metering" note="Planned Billing release" /> },
    { path: 'network', element: <LightPlaceholderPage title="Network Intelligence" description="Entity relationship graph across orgs, creators and assets" note="A real engineering project — see the roadmap's Tier 3 section" /> },
    { path: 'verification', element: <LightPlaceholderPage title="Identity & Verification" description="Manual KYC review and verification requests" note="Planned Identity release" /> },
    { path: 'institutions', element: <PlaceholderPage title="Institution Management" description="Manage institutions and affiliations" /> },
    { path: 'vault', element: <AdminVaultExplorerPage /> },
    { path: 'vault/:vaultId/timeline', element: <AdminVaultTimelinePage /> },
    { path: 'intelligence/:vaultId', element: <AdminIntelligencePage /> },
    { path: 'files', element: <FileExplorerPage /> },
    { path: 'dna', element: <AdminDnaPage /> },
    { path: 'certificates', element: <AdminCertificatesPage /> },
    { path: 'investigations', element: <AdminUnifiedInvestigationPage /> },
    { path: 'investigations/history', element: <InvestigationsPage /> },
    { path: 'evidence', element: <PlaceholderPage title="Evidence Center" description="Forensic evidence repository" /> },
    { path: 'tracking', element: <TrackingPage /> },
    { path: 'timeline', element: <TimelinePage /> },
    { path: 'monitoring', element: <AdminMonitoringPage /> },
    { path: 'threats', element: <PlaceholderPage title="Threat Center" description="Threat intelligence and risk scoring" /> },
    { path: 'shares', element: <Navigate to="/admin/tracking" replace /> },
    { path: 'downloads', element: <Navigate to="/admin/tracking" replace /> },
    { path: 'crawler', element: <Navigate to="/admin/monitoring" replace /> },
    { path: 'analytics', element: <AnalyticsPage /> },
    { path: 'reports', element: <PlaceholderPage title="Reports" description="Platform-wide report generation" /> },
    { path: 'audit', element: <AuditPage /> },
    { path: 'security', element: <SecurityCenterPage /> },
    { path: 'notifications', element: <PlaceholderPage title="Notifications" description="System-wide notification center" /> },
    { path: 'support', element: <PlaceholderPage title="Support" description="User support and ticketing" /> },
    { path: 'settings', element: <PlaceholderPage title="Settings" description="Admin console preferences" /> },
    { path: 'developer', element: <PlaceholderPage title="Developer Console" description="API keys, webhooks, and integrations" /> },
    { path: 'system', element: <PlaceholderPage title="System Configuration" description="Platform configuration and feature flags" /> },
  ],
};
