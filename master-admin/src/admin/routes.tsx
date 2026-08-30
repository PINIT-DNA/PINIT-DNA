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
import { BillingPage } from './pages/BillingPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ThreatCenterPage } from './pages/ThreatCenterPage';
import { IdentityVerificationPage } from './pages/IdentityVerificationPage';
import { SystemSettingsPage } from './pages/SystemSettingsPage';
import { ReportsPage } from './pages/ReportsPage';
import { CreditsUsagePage } from './pages/CreditsUsagePage';
import { NetworkIntelligencePage } from './pages/NetworkIntelligencePage';
import { SupportDisputesPage } from './pages/SupportDisputesPage';
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
  path: '/',
  element: AdminShell,
  children: [
    { index: true, element: <ExecutiveDashboardPage /> },
    { path: 'users', element: <UsersPage /> },
    { path: 'users/:id', element: <UserDetailPage /> },
    { path: 'organizations', element: <OrganizationsPage /> },
    { path: 'organizations/:id', element: <OrganizationDetailPage /> },
    { path: 'marketplace', element: <LightPlaceholderPage title="Marketplace (Exchange)" description="Listings, orders, disputes and payouts from the Exchange app" note="Needs a Hub ↔ Exchange data bridge — planned Commerce release" /> },
    { path: 'billing', element: <BillingPage /> },
    { path: 'credits', element: <CreditsUsagePage /> },
    { path: 'network', element: <NetworkIntelligencePage /> },
    { path: 'verification', element: <IdentityVerificationPage /> },
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
    { path: 'threats', element: <ThreatCenterPage /> },
    { path: 'shares', element: <Navigate to="/tracking" replace /> },
    { path: 'downloads', element: <Navigate to="/tracking" replace /> },
    { path: 'crawler', element: <Navigate to="/monitoring" replace /> },
    { path: 'analytics', element: <AnalyticsPage /> },
    { path: 'reports', element: <ReportsPage /> },
    { path: 'audit', element: <AuditPage /> },
    { path: 'security', element: <SecurityCenterPage /> },
    { path: 'notifications', element: <NotificationsPage /> },
    { path: 'support', element: <SupportDisputesPage /> },
    { path: 'settings', element: <SystemSettingsPage /> },
    { path: 'developer', element: <PlaceholderPage title="Developer Console" description="API keys, webhooks, and integrations" /> },
    { path: 'system', element: <PlaceholderPage title="System Configuration" description="Platform configuration and feature flags" /> },
  ],
};
