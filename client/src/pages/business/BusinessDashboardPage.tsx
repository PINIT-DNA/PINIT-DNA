import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import { useOrganization } from '../../hooks/useOrganization';
import { useBusinessDashboard, fmtAgo } from '../../hooks/useBusinessDashboard';
import { getForensicReportCount } from '../../lib/forensic-reports-storage';
import { UpgradeWelcomeModal } from '../../components/subscription/UpgradeWelcomeModal';
import {
  consumePendingUpgradeWelcome,
  markUpgradeWelcomeSeen,
} from '../../lib/subscription/upgrade-welcome';
import { BusinessWelcomeCard } from '../../components/business/BusinessWelcomeCard';
import { BusinessSetupWizard } from '../../components/business/BusinessSetupWizard';
import {
  OpsDashboardHeader,
  OrgOverviewGrid,
  LiveActivityFeed,
  ActiveAlertsPanel,
  BusinessNotificationsPanel,
  InvestigationSnapshot,
  VaultExplorerSnapshot,
  AccessIntelligenceSnapshot,
  MonitoringSnapshot,
  ReportsSnapshot,
  CertificatesSnapshot,
  QuickActionsBar,
  TeamSnapshotPanel,
} from '../../components/business/dashboard/BusinessOpsSections';
import { ClientsOverviewSection } from '../../components/business/dashboard/ClientsOverviewSection';
import type { PlanCode } from '../../hooks/useSubscription';

export function BusinessDashboardPage() {
  const { user } = useAuth();
  const { subscription, planCode } = useSubscription();
  const { organization, skipWelcome, completeSetup } = useOrganization(true);
  const dashboard = useBusinessDashboard();
  const [welcomePlan, setWelcomePlan] = useState<PlanCode | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [welcomeBusy, setWelcomeBusy] = useState(false);

  useEffect(() => {
    if (!user?.sub) return;
    const pending = consumePendingUpgradeWelcome(user.sub);
    if (pending === 'ENTERPRISE') setWelcomePlan('ENTERPRISE');
  }, [user?.sub]);

  const teamDisplay = subscription?.teamMemberLimit != null
    ? `${subscription.teamMemberCount ?? 1} / ${subscription.teamMemberLimit}`
    : '1 / 1';

  const storagePct = useMemo(() => {
    const used = subscription?.storageUsedBytes ?? dashboard.stats?.totalEncryptedBytes ?? 0;
    const limit = subscription?.storageLimitBytes;
    if (!limit || limit <= 0) return null;
    return (used / limit) * 100;
  }, [subscription, dashboard.stats]);

  const certRecent = useMemo(
    () =>
      dashboard.certificates.slice(0, 4).map((c) => ({
        id: c.certificateId,
        label: c.certificateId,
        ago: fmtAgo(c.issuedAt),
      })),
    [dashboard.certificates],
  );

  const reportCount = getForensicReportCount();

  const orgName = organization?.name?.trim() || 'Your Organization';
  const workspaceLabel = organization?.defaultWorkspace?.name ?? 'Main Workspace';
  const threatAlerts =
    (dashboard.monitorStats?.pendingAlerts ?? dashboard.pendingAlerts.length) +
    (dashboard.security?.duplicateAttempts.count ?? 0);

  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-5 pb-16">
      {organization?.showWelcome && organization.shortId && (
        <BusinessWelcomeCard
          orgShortId={organization.shortId}
          busy={welcomeBusy}
          onStartSetup={() => setWizardOpen(true)}
          onSkip={async () => {
            setWelcomeBusy(true);
            try {
              await skipWelcome();
            } finally {
              setWelcomeBusy(false);
            }
          }}
        />
      )}

      <OpsDashboardHeader
        orgName={orgName}
        workspaceLabel={workspaceLabel}
        orgShortId={organization?.shortId}
        planName={subscription?.planName ?? 'Free'}
        refreshing={dashboard.refreshing || dashboard.loading}
        onRefresh={dashboard.refetch}
      />

      {dashboard.loading && (
        <div className="rounded-lg border border-dna-500/20 bg-dna-500/5 px-3 py-2 text-2xs text-dna-300 flex items-center gap-2">
          <span className="w-3 h-3 border-2 border-dna-400 border-t-transparent rounded-full animate-spin" />
          Loading live organization data…
        </div>
      )}

      {dashboard.error && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          Some dashboard data could not be loaded. Use Refresh or try again in a moment.
        </div>
      )}

      <QuickActionsBar />

      <ClientsOverviewSection />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <LiveActivityFeed events={dashboard.activityEvents} />
        </div>
        <ActiveAlertsPanel
          security={dashboard.security}
          pendingAlerts={dashboard.pendingAlerts}
          storagePct={storagePct}
          planName={subscription?.planName ?? 'Free'}
        />
      </div>

      <OrgOverviewGrid
        protectedAssets={subscription?.protectedAssetCount ?? dashboard.stats?.totalVaultRecords ?? 0}
        dnaGenerated={dashboard.stats?.totalDnaRecords ?? 0}
        activeInvestigations={dashboard.investigations.length}
        threatAlerts={threatAlerts}
        storageUsed={subscription?.storageUsedBytes ?? dashboard.stats?.totalEncryptedBytes ?? 0}
        storageLimit={subscription?.storageLimitBytes ?? null}
        teamDisplay={teamDisplay}
        sharedAssets={dashboard.shareLinks.filter((l) => l.isActive).length}
        certificates={dashboard.certificates.length}
      />

      {!organization?.setupCompletedAt && (
        <div className="rounded-xl border border-dna-500/25 bg-dna-500/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Sparkles size={16} className="text-dna-400 shrink-0" />
            Complete your organization profile for client-ready branding.
          </div>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-dna-400 hover:text-dna-500"
          >
            Open setup wizard
            <ArrowRight size={12} />
          </button>
        </div>
      )}

      <BusinessNotificationsPanel
        notifications={dashboard.notifications}
        unreadCount={dashboard.unreadNotifications}
        onRefresh={dashboard.refetch}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <InvestigationSnapshot investigations={dashboard.investigations} />
        <VaultExplorerSnapshot
          records={dashboard.vaultRecords}
          workspaceName={workspaceLabel}
          ownerName={orgName}
        />
        <AccessIntelligenceSnapshot
          links={dashboard.shareLinks}
          shareStats={dashboard.shareStats}
        />
        <MonitoringSnapshot stats={dashboard.monitorStats} alerts={dashboard.pendingAlerts} />
        <ReportsSnapshot reportCount={reportCount} />
        <CertificatesSnapshot count={dashboard.certificates.length} recent={certRecent} />
      </div>

      <TeamSnapshotPanel
        ownerName={orgName}
        teamDisplay={teamDisplay}
        planCode={planCode ?? 'FREE'}
      />

      {planCode === 'FREE' && (
        <div className="rounded-xl border border-dna-500/20 bg-dna-500/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-gray-400">
            Business Free includes full platform access with a 5 protected asset quota. Upgrade for teams, storage, and Enterprise modules.
          </p>
          <Link
            to="/upgrade"
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-center shrink-0"
          >
            View plans
          </Link>
        </div>
      )}

      {welcomePlan && user?.sub && (
        <UpgradeWelcomeModal
          open
          planCode="ENTERPRISE"
          onDismiss={() => {
            markUpgradeWelcomeSeen(user.sub, 'ENTERPRISE');
            setWelcomePlan(null);
          }}
        />
      )}

      <BusinessSetupWizard
        open={wizardOpen}
        organization={organization}
        onClose={() => setWizardOpen(false)}
        onComplete={async (payload) => {
          await completeSetup(payload);
          setWizardOpen(false);
        }}
      />
    </div>
  );
}
