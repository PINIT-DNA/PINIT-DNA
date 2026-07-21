import { Link } from 'react-router-dom';
import { useSubscription } from '../../hooks/useSubscription';

/** Shows protected asset usage when the plan has an asset limit. */
export function AssetQuotaBanner() {
  const { subscription, loading } = useSubscription();

  if (loading || subscription?.assetLimit == null) return null;

  const used = subscription.protectedAssetCount ?? 0;
  const limit = subscription.assetLimit;
  const remaining = subscription.assetsRemaining ?? Math.max(0, limit - used);
  const exhausted = remaining <= 0;

  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${
        exhausted
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-dna-500/25 bg-dna-500/5'
      }`}
    >
      <div className="text-sm">
        <span className="text-white font-medium">
          {used} of {limit} protected assets used
        </span>
        <span className="text-gray-400 ml-2">
          {exhausted ? '— upgrade for unlimited' : `· ${remaining} remaining`}
        </span>
      </div>
      {exhausted ? (
        <Link
          to="/upgrade?from=quota"
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 text-center"
        >
          Upgrade now
        </Link>
      ) : (
        <div className="h-1.5 w-full sm:w-32 bg-bg-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-dna-500 rounded-full transition-all"
            style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
