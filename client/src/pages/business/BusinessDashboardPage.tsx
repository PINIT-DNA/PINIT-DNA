import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ArrowRight, Briefcase, Sparkles, Store, Users } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import { useOrganization } from '../../hooks/useOrganization';
import { useBusinessDashboard } from '../../hooks/useBusinessDashboard';
import { UpgradeWelcomeModal } from '../../components/subscription/UpgradeWelcomeModal';
import {
  consumePendingUpgradeWelcome,
  markUpgradeWelcomeSeen,
} from '../../lib/subscription/upgrade-welcome';
import { BusinessWelcomeCard } from '../../components/business/BusinessWelcomeCard';
import { BusinessSetupWizard } from '../../components/business/BusinessSetupWizard';
import { ClientsOverviewSection } from '../../components/business/dashboard/ClientsOverviewSection';
import type { PlanCode } from '../../hooks/useSubscription';
import { CreatorHomeView, type HomeAttentionItem, type HomePortfolioGroup } from '../home/CreatorHomeView';
import {
  friendlyMatchLabel,
  resolveHomeActivityHref,
  type HomeActivityEvent,
} from '../../lib/home-activity';
import { isRealDisplayName, useUserProfile } from '../../hooks/useUserProfile';
import { toUserPinitId } from '../../lib/pinit-identity';
import {
  createExchangeSso,
  getExchangeBuyerSummary,
  getExchangeSellerSummary,
  getLiveTrackingMap,
  getMonitoringStatus,
  type ExchangeBuyerSummary,
  type MonitoringStatus,
} from '../../services/dashboard.api';
import { getBusinessOverview } from '../../services/business.api';
import { BRAND } from '../../config/brand.config';
import type { DashboardFileMapPoint } from '../../components/maps/DashboardFilesMap';
import { listForensicReports } from '../../lib/forensic-reports-storage';

export function BusinessDashboardPage() {
  const { user } = useAuth();
  const { firstName, displayName, profile } = useUserProfile();
  const { subscription, planCode } = useSubscription();
  const { organization, skipWelcome, completeSetup } = useOrganization(true);
  const dashboard = useBusinessDashboard();
  const [welcomePlan, setWelcomePlan] = useState<PlanCode | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [activityFilter, setActivityFilter] = useState('all');
  const [activityQuery, setActivityQuery] = useState('');
  const [trackingPoints, setTrackingPoints] = useState<DashboardFileMapPoint[]>([]);
  const [trackingMeta, setTrackingMeta] = useState({ recent: 0, total: 0 });
  const [monitoringStatus, setMonitoringStatus] = useState<MonitoringStatus | null>(null);
  const [campaignCount, setCampaignCount] = useState(0);
  const [campaignAssetCount, setCampaignAssetCount] = useState(0);
  const [campaignGroups, setCampaignGroups] = useState<HomePortfolioGroup[]>([]);
  const [exchangeSelling, setExchangeSelling] = useState<{
    unavailable?: boolean;
    metrics: { active_listings_count: number };
  } | null>(null);
  const [exchangeBuying, setExchangeBuying] = useState<ExchangeBuyerSummary | null>(null);

  useEffect(() => {
    if (!user?.sub) return;
    const pending = consumePendingUpgradeWelcome(user.sub);
    if (pending === 'ENTERPRISE') setWelcomePlan('ENTERPRISE');
  }, [user?.sub]);

  useEffect(() => {
    getLiveTrackingMap()
      .then((data) => {
        setTrackingPoints(data.points);
        setTrackingMeta({ recent: data.recentAccessCount, total: data.totalAccessPoints });
      })
      .catch(() => {});
    getMonitoringStatus().then(setMonitoringStatus).catch(() => setMonitoringStatus(null));
    getExchangeSellerSummary()
      .then((data) => setExchangeSelling({ unavailable: data.unavailable, metrics: data.metrics }))
      .catch(() => setExchangeSelling(null));
    getExchangeBuyerSummary().then(setExchangeBuying).catch(() => setExchangeBuying(null));
    getBusinessOverview()
      .then((o) => {
        setCampaignCount(o.campaignCount);
        setCampaignAssetCount(o.assetCount);
        setCampaignGroups(
          o.recentCampaigns.map((c) => ({
            id: c.id,
            title: c.name,
            category: c.clientName,
            vault_ids: [],
            itemCount: c.assetCount,
            href: `/business/campaigns/${c.id}`,
          })),
        );
      })
      .catch(() => {
        setCampaignCount(0);
        setCampaignAssetCount(0);
        setCampaignGroups([]);
      });
  }, []);

  const teamDisplay = subscription?.teamMemberLimit != null
    ? `${subscription.teamMemberCount ?? 1} / ${subscription.teamMemberLimit}`
    : '1 / 1';

  const orgName = organization?.name?.trim() || 'Your Organization';

  const welcomeName = isRealDisplayName(displayName)
    ? firstName
    : (toUserPinitId(user?.shortId) || user?.shortId?.trim() || null);

  const attention = useMemo((): HomeAttentionItem[] => {
    const now = Date.now();
    const soon = now + 72 * 60 * 60 * 1000;
    const items: HomeAttentionItem[] = [];

    for (const link of dashboard.shareLinks) {
      if (!link.isActive || !link.expiresAt) continue;
      const exp = new Date(link.expiresAt).getTime();
      if (Number.isNaN(exp) || exp > soon || exp < now) continue;
      const opens = link.accessLogs?.length ?? 0;
      items.push({
        key: `share-${link.token}`,
        tone: 'info',
        title: 'Your share of',
        strong: link.filename,
        detail: `Expires ${formatDistanceToNow(new Date(exp), { addSuffix: true })}`
          + (opens ? ` · opened ${opens} ${opens === 1 ? 'time' : 'times'}` : ' · not opened yet'),
        to: `/access-intelligence/${link.token}`,
        action: 'Review link',
      });
    }

    const dupes = dashboard.security?.duplicateAttempts;
    for (const item of (dupes?.items ?? []).slice(0, 2)) {
      items.push({
        key: `dupe-${item.filename}-${item.ago}`,
        tone: 'warn',
        title: 'Someone else tried to protect',
        strong: item.filename,
        detail: `${friendlyMatchLabel(item.matchType)} · ${item.riskLevel.toLowerCase()} risk · ${item.ago}`,
        to: '/duplicate-attempts',
        action: 'Review attempt',
      });
    }

    for (const alert of dashboard.pendingAlerts.slice(0, 2)) {
      let where = alert.url;
      try { where = new URL(alert.url).hostname; } catch { /* keep */ }
      items.push({
        key: `alert-${alert.id}`,
        tone: 'warn',
        title: 'Monitoring matched',
        strong: alert.filename,
        detail: `${Math.round(alert.similarity)}% similar · ${friendlyMatchLabel(alert.matchType)} · found on ${where}`,
        to: '/monitoring',
        action: 'Review match',
      });
    }

    return items.slice(0, 4);
  }, [dashboard.shareLinks, dashboard.security, dashboard.pendingAlerts]);

  const homeActivity = useMemo((): HomeActivityEvent[] => {
    const extra: HomeActivityEvent[] = dashboard.investigations.slice(0, 4).map((report) => ({
      id: `evd-${report.id}`,
      type: 'EVIDENCE_CREATED',
      date: report.savedAt,
      detail: report.kind === 'investigation' ? report.filename : 'Comparison',
    }));
    return [...dashboard.activityEvents, ...extra]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((ev) => ({
        ...ev,
        href: resolveHomeActivityHref(ev, {
          vaultRecords: dashboard.vaultRecords,
          shareLinks: dashboard.shareLinks,
        }),
      }));
  }, [dashboard.activityEvents, dashboard.vaultRecords, dashboard.shareLinks, dashboard.investigations]);

  const geoLine = dashboard.shareStats && (dashboard.shareStats.countriesReached > 0)
    ? `${dashboard.shareStats.countriesReached} ${dashboard.shareStats.countriesReached === 1 ? 'country' : 'countries'}`
    : null;

  const activeShareCount = dashboard.shareLinks.filter((l) => l.isActive).length;
  const evidenceCount = listForensicReports().length || dashboard.investigations.length;
  const suspiciousCount = dashboard.security?.duplicateAttempts.count ?? 0;
  const monitoringMatches = dashboard.monitorStats?.confirmedMatches
    ?? dashboard.pendingAlerts.length;

  const openExchangeSeller = async () => {
    try {
      const result = await createExchangeSso();
      const url = new URL(result.exchangeUrl);
      url.pathname = '/exchange/seller';
      window.open(url.toString(), 'pinit-exchange', 'noopener,noreferrer');
    } catch {
      /* Home still works */
    }
  };

  const handleRefresh = () => {
    dashboard.refetch();
    getLiveTrackingMap()
      .then((data) => {
        setTrackingPoints(data.points);
        setTrackingMeta({ recent: data.recentAccessCount, total: data.totalAccessPoints });
      })
      .catch(() => {});
    getBusinessOverview()
      .then((o) => {
        setCampaignCount(o.campaignCount);
        setCampaignAssetCount(o.assetCount);
        setCampaignGroups(
          o.recentCampaigns.map((c) => ({
            id: c.id,
            title: c.name,
            category: c.clientName,
            vault_ids: [],
            itemCount: c.assetCount,
            href: `/business/campaigns/${c.id}`,
          })),
        );
      })
      .catch(() => {});
  };

  return (
    <div className="pb-8">
      {organization?.showWelcome && organization.shortId && (
        <div className="max-w-[1400px] mx-auto mb-6">
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
        </div>
      )}

      {dashboard.error && (
        <div className="max-w-[1400px] mx-auto mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          Some dashboard data could not be loaded. Use Refresh or try again in a moment.
        </div>
      )}

      <CreatorHomeView
        greetingName={welcomeName}
        profile={profile}
        kicker={orgName}
        lede="Pinit HUB protects creative assets, keeps originals secure, lets you share them, tracks access, monitors usage, helps investigate matches, and preserves evidence."
        projectStatLabel="Campaigns"
        protectedCount={subscription?.protectedAssetCount ?? dashboard.stats?.totalVaultRecords ?? dashboard.vaultRecords.length}
        projectCount={campaignCount}
        portfolioItemCount={campaignAssetCount}
        portfolioItemLabel="Campaign assets"
        activeShareCount={activeShareCount}
        loadingStats={dashboard.loading && !dashboard.stats}
        onRefresh={handleRefresh}
        refreshing={dashboard.refreshing || dashboard.loading}
        attention={attention}
        attentionLoading={dashboard.loading && !dashboard.security}
        vaultRecords={dashboard.vaultRecords}
        activity={homeActivity}
        activityFilter={activityFilter}
        onActivityFilter={setActivityFilter}
        activityQuery={activityQuery}
        onActivityQuery={setActivityQuery}
        portfolioGroups={campaignGroups}
        portfolioHeadline=""
        portfolioAbout=""
        portfolioLocation=""
        portfolioSectionTitle="Campaigns"
        portfolioSectionTo="/business/clients"
        recentProjectsTitle="Recent campaigns"
        profilePortfolioTo="/business/clients"
        monitoringEnabled={monitoringStatus == null ? null : monitoringStatus.monitoringEnabled}
        monitoringMatches={monitoringMatches}
        evidenceCount={evidenceCount}
        suspiciousCount={suspiciousCount}
        trackingPoints={trackingPoints}
        trackingRecent={trackingMeta.recent}
        trackingTotal={trackingMeta.total}
        geoLine={geoLine}
        onOpenExchange={() => void openExchangeSeller()}
        workspaceModules={[
          {
            to: '/business/clients',
            title: 'Campaigns',
            detail: campaignCount === 1 ? '1 campaign' : `${campaignCount} campaigns`,
          },
          {
            to: '/monitoring',
            title: 'Monitoring',
            detail: monitoringMatches === 1 ? '1 match' : `${monitoringMatches} matches`,
          },
          {
            to: '/reports',
            title: 'Evidence',
            detail: evidenceCount === 1 ? '1 report' : `${evidenceCount} reports`,
          },
          {
            to: BRAND.investigationPath,
            title: 'Intelligence',
            detail: 'Compare a file to protected work',
          },
        ]}
        extraQuickActions={(
          <>
            <RouterLink to="/business/clients" className="btn btn-secondary justify-center gap-2 min-h-[44px]">
              <Users size={15} /> Clients
            </RouterLink>
            <RouterLink to="/business/clients" className="btn btn-secondary justify-center gap-2 min-h-[44px]">
              <Briefcase size={15} /> Campaigns
            </RouterLink>
          </>
        )}
        extraShortcuts={(
          <>
            <RouterLink to="/business/clients" className="hub-home-link">Clients</RouterLink>
            <RouterLink to="/business/team" className="hub-home-link">Team</RouterLink>
          </>
        )}
      >
        <ClientsOverviewSection />

        {!organization?.setupCompletedAt && (
          <div className="hub-home-block flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 text-sm hub-home-body">
              <Sparkles size={16} className="text-dna-500 shrink-0" />
              Complete your organization profile for client-ready branding.
            </div>
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-dna-600"
            >
              Open setup wizard
              <ArrowRight size={12} />
            </button>
          </div>
        )}

        <section className="hub-home-block">
          <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
            <div>
              <h2 className="hub-home-section">Marketplace</h2>
              <p className="hub-home-meta mt-1">
                {exchangeSelling?.unavailable && exchangeBuying?.unavailable
                  ? 'No marketplace activity to show right now.'
                  : 'What you are selling and what you have licensed.'}
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm gap-2" onClick={() => void openExchangeSeller()}>
              <Store size={13} />
              Open Exchange
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 hub-home-body">
            <p>
              {!exchangeSelling || exchangeSelling.unavailable
                ? 'No listings or sales to show yet.'
                : `${exchangeSelling.metrics.active_listings_count} live listings`}
            </p>
            <p>
              {!exchangeBuying || exchangeBuying.unavailable
                ? 'No purchases or licences to show yet.'
                : `${exchangeBuying.metrics.purchases_count} purchases`}
            </p>
          </div>
        </section>

        <section className="hub-home-block">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="hub-home-section">Team</h2>
            <RouterLink
              to={planCode === 'FREE' ? '/upgrade' : '/business/team'}
              className="hub-home-link"
            >
              {planCode === 'FREE' ? 'Upgrade for teams' : 'Manage team'}
            </RouterLink>
          </div>
          <p className="hub-home-body">
            {orgName} · capacity {teamDisplay}
          </p>
        </section>

        {planCode === 'FREE' && (
          <div className="hub-home-block flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="hub-home-body">
              Business Free includes full platform access with a 5 protected asset quota. Upgrade for teams, storage, and Enterprise modules.
            </p>
            <RouterLink
              to="/upgrade"
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-center shrink-0"
            >
              View plans
            </RouterLink>
          </div>
        )}
      </CreatorHomeView>

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
