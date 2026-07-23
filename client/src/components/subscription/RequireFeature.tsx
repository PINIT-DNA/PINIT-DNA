import type { ReactNode } from 'react';
import { useSubscription } from '../../hooks/useSubscription';
import { UpgradeRequiredPanel } from './UpgradeRequiredPanel';

interface RequireFeatureProps {
  feature: string;
  featureLabel: string;
  children: ReactNode;
}

const ENTERPRISE_ONLY = new Set([
  'FEATURE_ENTERPRISE_TEAMS',
  'FEATURE_API_ACCESS',
  'FEATURE_BULK_UPLOAD',
  'FEATURE_AI_MONITORING',
]);

/**
 * Gates Enterprise-only modules. Core forensic modules stay open on Free (quota enforced elsewhere).
 */
export function RequireFeature({ feature, featureLabel, children }: RequireFeatureProps) {
  const { loading, subscription, hasFeature } = useSubscription();

  if (loading && !subscription) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (ENTERPRISE_ONLY.has(feature) && !hasFeature(feature)) {
    return (
      <UpgradeRequiredPanel
        title="Upgrade to Enterprise"
        featureLabel={featureLabel}
        requiredPlan="ENTERPRISE"
      />
    );
  }

  return <>{children}</>;
}

export function SubscriptionBadge() {
  const { subscription, loading } = useSubscription();
  if (loading || !subscription) return null;
  const tone =
    subscription.planCode === 'ENTERPRISE'
      ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
      : subscription.planCode === 'PRO'
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
        : 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded border font-semibold ${tone}`}>
      {subscription.planName}
    </span>
  );
}
