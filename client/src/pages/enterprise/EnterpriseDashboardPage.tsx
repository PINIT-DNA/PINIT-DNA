import { Link } from 'react-router-dom';
import {
  Building2, Users, Shield, Activity, AlertTriangle,
  Sparkles, ArrowRight, Settings, CreditCard,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import { useUserProfile } from '../../hooks/useUserProfile';
import { formatBytes } from '../../hooks/useApi';
import { BRAND } from '../../config/brand.config';
import { UpgradeWelcomeModal } from '../../components/subscription/UpgradeWelcomeModal';
import { useEffect, useState } from 'react';
import {
  consumePendingUpgradeWelcome,
  markUpgradeWelcomeSeen,
} from '../../lib/subscription/upgrade-welcome';
import type { PlanCode } from '../../hooks/useSubscription';

export function EnterpriseDashboardPage() {
  const { user } = useAuth();
  const { firstName, displayName } = useUserProfile();
  const { subscription, planCode, loading } = useSubscription();
  const [welcomePlan, setWelcomePlan] = useState<PlanCode | null>(null);

  useEffect(() => {
    if (!user?.sub) return;
    const pending = consumePendingUpgradeWelcome(user.sub);
    if (pending === 'ENTERPRISE') setWelcomePlan('ENTERPRISE');
  }, [user?.sub]);

  if (!loading && planCode !== 'ENTERPRISE') {
    return (
      <div className="max-w-lg mx-auto p-8 text-center space-y-4">
        <Building2 size={40} className="mx-auto text-purple-400" />
        <h1 className="text-xl font-bold text-white">Enterprise workspace</h1>
        <p className="text-sm text-gray-400">
          Upgrade to Enterprise to access organization dashboard, teams, and unlimited storage.
        </p>
        <Link
          to="/upgrade"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold"
        >
          Upgrade to Enterprise
          <ArrowRight size={14} />
        </Link>
      </div>
    );
  }

  const orgName = displayName !== 'there'
    ? `${firstName}'s Organization`
    : 'Your Organization';

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-purple-400 text-sm font-medium mb-1">
            <Sparkles size={14} />
            Enterprise
          </div>
          <h1 className="text-2xl font-bold text-white">Good morning, {firstName}</h1>
          <p className="text-sm text-gray-400 mt-1">{orgName} · Unlimited storage · This week</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/subscription"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-bg-border text-xs text-gray-300 hover:bg-bg-elevated"
          >
            <CreditCard size={14} />
            Billing
          </Link>
          <Link
            to="/profile"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-bg-border text-xs text-gray-300 hover:bg-bg-elevated"
          >
            <Settings size={14} />
            Settings
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Organization Assets', value: '—', sub: 'Shared vault', color: 'text-dna-400' },
          { label: 'DNA Generated (30d)', value: '—', sub: 'Across teams', color: 'text-amber-400' },
          {
            label: 'Storage',
            value: subscription ? formatBytes(subscription.storageUsedBytes) : '—',
            sub: 'Unlimited plan',
            color: 'text-emerald-400',
          },
          { label: 'Team members', value: '1', sub: 'Invite your team', color: 'text-purple-400' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-bg-border bg-bg-card p-4">
            <p className="text-2xs text-gray-500 mb-1">{stat.label}</p>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-2xs text-gray-500 mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-bg-border bg-bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Shield size={16} className="text-purple-400" />
              Active Investigations
            </h2>
            <Link to={BRAND.investigationPath} className="text-2xs text-dna-400 hover:underline">
              View all
            </Link>
          </div>
          <p className="text-sm text-gray-500 py-6 text-center">
            No open investigations.{' '}
            <Link to={BRAND.investigationPath} className="text-dna-400 hover:underline">
              Start one
            </Link>
          </p>
        </div>

        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400" />
              Threat Alerts
            </h2>
            <Link to="/monitoring" className="text-2xs text-dna-400 hover:underline">
              Monitoring
            </Link>
          </div>
          <p className="text-sm text-gray-400">Monitoring & leak detection ready. Enroll assets to receive alerts.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-bg-border bg-bg-card p-5">
          <h2 className="font-semibold text-white mb-3 flex items-center gap-2">
            <Activity size={16} className="text-dna-400" />
            Quick actions
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { to: '/vault', label: 'Shared Vault' },
              { to: BRAND.investigationPath, label: 'Investigate' },
              { to: '/monitoring', label: 'Monitoring' },
              { to: '/upgrade', label: 'Invite team' },
            ].map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="rounded-xl border border-bg-border bg-bg-elevated px-3 py-2.5 text-xs font-medium text-gray-300 hover:border-purple-500/40 hover:text-white transition-colors"
              >
                {a.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-5">
          <div className="flex items-center gap-3 mb-3">
            <Users size={18} className="text-purple-400" />
            <div>
              <p className="font-semibold text-white">Enterprise plan active</p>
              <p className="text-2xs text-gray-500">
                {subscription?.planName ?? 'Enterprise'} · Renews monthly
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Organization setup (teams, invites, audit logs) coming in the next Enterprise phase.
          </p>
          <Link
            to="/subscription"
            className="text-xs text-purple-400 hover:underline inline-flex items-center gap-1"
          >
            Manage subscription <ArrowRight size={12} />
          </Link>
        </div>
      </div>

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
    </div>
  );
}
