import { createBrowserRouter, Navigate } from 'react-router-dom';
import { DashboardLayout } from './layouts/DashboardLayout';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { OnboardingLayout } from './layouts/OnboardingLayout';
import { GeneratePage } from './pages/GeneratePage';
import { VaultPage } from './pages/VaultPage';
import { VaultSharePage } from './pages/VaultSharePage';
import { VaultShareManagePage } from './pages/VaultShareManagePage';
import { DnaRecordsPage } from './pages/DNARecordsPage';
import { ReportsPage } from './pages/ReportsPage';
import { CertificatesPage } from './pages/CertificatesPage';
import { TimelinePage } from './pages/TimelinePage';
import { ForensicDiffPage } from './pages/ForensicDiffPage';
import { SearchPage } from './pages/SearchPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { ExtensionAuthPage } from './pages/publish-guardian/ExtensionAuthPage';
import { VerifyCertificatePage } from './pages/VerifyCertificatePage';
import { VaultIntegrityPage } from './pages/VaultIntegrityPage';
import { DuplicateAttemptsPage } from './pages/DuplicateAttemptsPage';
import { UnmaskRequestsPage } from './pages/UnmaskRequestsPage';
import { ForwardChainPage } from './pages/ForwardChainPage';
import { IntelligenceReportPage } from './pages/IntelligenceReportPage';
import { LinkTreePage } from './pages/LinkTreePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProfilePage } from './pages/ProfilePage';
import { LinkIntelligencePage } from './pages/LinkIntelligencePage';
import { AccessIntelligencePage } from './pages/AccessIntelligencePage';
import { UnifiedInvestigationPage } from './pages/UnifiedInvestigationPage';
import { UpgradePage } from './pages/UpgradePage';
import { CheckoutPage } from './pages/subscription/CheckoutPage';
import { PaymentPage } from './pages/subscription/PaymentPage';
import { PaymentSuccessPage } from './pages/subscription/PaymentSuccessPage';
import { PaymentFailedPage } from './pages/subscription/PaymentFailedPage';
import { SubscriptionPage } from './pages/subscription/SubscriptionPage';
import { AccountTypeOnboardingPage } from './pages/onboarding/AccountTypeOnboardingPage';
import { BusinessDashboardPage } from './pages/business/BusinessDashboardPage';
import { ClientsPage } from './pages/business/ClientsPage';
import { ClientWorkspacePage } from './pages/business/ClientWorkspacePage';
import { CampaignWorkspacePage } from './pages/business/CampaignWorkspacePage';
import { OrganizationSettingsPage } from './pages/business/OrganizationSettingsPage';
import { BusinessTeamPage } from './pages/business/BusinessTeamPage';
import { BusinessAuditLogsPage } from './pages/business/BusinessAuditLogsPage';
import { BusinessApiKeysPage } from './pages/business/BusinessApiKeysPage';
import { TeamJoinPage } from './pages/TeamJoinPage';
import { HomeRedirect } from './components/subscription/HomeRedirect';
import { RequireAccountTypeOnboarding } from './components/onboarding/RequireAccountTypeOnboarding';
import { BRAND } from './config/brand.config';
import { ShareViewerPage } from './pages/ShareViewerPage';
import { HandoverPage } from './pages/HandoverPage';
import { ClientReportPage } from './pages/ClientReportPage';
import { PinitGateway, RegisterGateway } from './pages/auth/PinitGateway';
import { PreRegisterRoute } from './pages/auth/PreRegisterGateway';
import { PreRegisterAccountTypePage } from './pages/auth/PreRegisterAccountTypePage';
import { FaceLoginPage } from './pages/auth/FaceLoginPage';
import { RequireAuth } from './components/auth/RequireAuth';
// Master Admin now lives in its own app (master-admin/, port 3003) — see
// lib/open-master-admin.ts. ./admin/* stays on disk unreferenced until that
// app is verified end-to-end, then gets removed.

export const router = createBrowserRouter([
  // ── Auth (public) ─────────────────────────────────────────────────────────
  { path: '/login', element: <PinitGateway /> },
  {
    path: '/register/account-type',
    errorElement: <RouteErrorBoundary />,
    element: <PreRegisterRoute />,
    children: [{ index: true, element: <PreRegisterAccountTypePage /> }],
  },
  { path: '/register', element: <RegisterGateway /> },
  { path: '/face-auth', element: <FaceLoginPage /> },
  {
    path: '/extension/auth',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RequireAuth>
        <ExtensionAuthPage />
      </RequireAuth>
    ),
  },

  // ── Public share viewer ───────────────────────────────────────────────────
  { path: '/s/:token', element: <ShareViewerPage /> },
  { path: '/share/:token', element: <ShareViewerPage /> },
  // Public, like the share viewer — the handover token is the authority.
  { path: '/handover/:token', element: <HandoverPage /> },
  // Public too — the report token is the authority, and the page sends no auth.
  { path: '/client-report/:token', element: <ClientReportPage /> },

  // ── Team invite join (remembers token if login is required) ────────────────
  { path: '/team/join/:token', element: <TeamJoinPage /> },

  // ── Onboarding (auth required, isolated shell — no dashboard chrome) ──────
  {
    path: '/onboarding',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RequireAuth>
        <OnboardingLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="account-type" replace /> },
      { path: 'account-type', element: <AccountTypeOnboardingPage /> },
      { path: 'business-setup', element: <Navigate to="/business" replace /> },
    ],
  },

  // ── Application (auth + onboarding complete + dashboard shell) ────────────
  {
    path: '/',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RequireAuth>
        <RequireAccountTypeOnboarding>
          <DashboardLayout />
        </RequireAccountTypeOnboarding>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'business', element: <BusinessDashboardPage /> },
      { path: 'business/clients', element: <ClientsPage /> },
      { path: 'business/clients/:clientId', element: <ClientWorkspacePage /> },
      { path: 'business/campaigns/:campaignId', element: <CampaignWorkspacePage /> },
      { path: 'business/settings', element: <OrganizationSettingsPage /> },
      { path: 'business/team', element: <BusinessTeamPage /> },
      { path: 'business/audit-logs', element: <BusinessAuditLogsPage /> },
      { path: 'business/api-keys', element: <BusinessApiKeysPage /> },
      { path: 'enterprise', element: <Navigate to="/business" replace /> },
      { path: 'generate', element: <GeneratePage /> },
      { path: 'vault', element: <VaultPage /> },
      { path: 'vault/assets/:assetId/share', element: <VaultSharePage /> },
      { path: 'vault/assets/:assetId/shares/:shareId', element: <VaultShareManagePage /> },
      { path: 'vault-integrity', element: <VaultIntegrityPage /> },
      { path: 'dna-records', element: <DnaRecordsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'timeline', element: <TimelinePage /> },
      { path: 'forensic-diff', element: <ForensicDiffPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'monitoring', element: <MonitoringPage /> },
      { path: 'protected-posts', element: <Navigate to="/vault" replace /> },
      { path: 'protected-posts/:id', element: <Navigate to="/vault" replace /> },
      { path: 'assets', element: <Navigate to="/vault" replace /> },
      { path: 'assets/:id', element: <Navigate to="/vault" replace /> },
      { path: 'duplicate-attempts', element: <DuplicateAttemptsPage /> },
      { path: 'unmask-requests', element: <UnmaskRequestsPage /> },
      { path: 'chain/:dnaRecordId', element: <ForwardChainPage /> },
      { path: 'intelligence/:vaultId', element: <IntelligenceReportPage /> },
      { path: 'link-tree/:parentToken', element: <LinkTreePage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'upgrade', element: <UpgradePage /> },
      { path: 'subscription', element: <SubscriptionPage /> },
      { path: 'subscription/checkout', element: <CheckoutPage /> },
      { path: 'subscription/payment', element: <PaymentPage /> },
      { path: 'subscription/success', element: <PaymentSuccessPage /> },
      { path: 'subscription/failed', element: <PaymentFailedPage /> },
      { path: 'access-intelligence/:token', element: <LinkIntelligencePage /> },
      { path: 'access-intelligence', element: <AccessIntelligencePage /> },
      { path: 'pinit-hub/investigation', element: <UnifiedInvestigationPage /> },
      { path: 'unified-investigation', element: <Navigate to={BRAND.investigationPath} replace /> },
      { path: 'link/:token', element: <LinkIntelligencePage /> },
      { path: 'certificates', element: <CertificatesPage /> },
      { path: 'verify-certificate', element: <VerifyCertificatePage /> },
      // 'admin-portal' retired — duplicate of the Master Admin console (master-admin/, port 3003).
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
