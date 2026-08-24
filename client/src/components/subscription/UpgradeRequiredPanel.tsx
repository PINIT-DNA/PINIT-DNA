import { Link } from 'react-router-dom';
import { Sparkles, ShieldCheck, Radio, FileSearch, BarChart3 } from 'lucide-react';

interface UpgradeRequiredPanelProps {
  title?: string;
  featureLabel?: string;
  requiredPlan?: string;
}

const UNLOCK_ITEMS = [
  { icon: FileSearch, label: 'Investigate & get clear reports' },
  { icon: Radio, label: 'Asset monitoring & leak detection' },
  { icon: ShieldCheck, label: 'Smart Share links with access tracking' },
  { icon: BarChart3, label: 'Access intelligence & tracking analytics' },
];

export function UpgradeRequiredPanel({
  title = 'Upgrade to Pinit HUB Pro',
  featureLabel = 'this premium module',
  requiredPlan = 'PRO',
}: UpgradeRequiredPanelProps) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-2xl border border-bg-border bg-bg-card/80 backdrop-blur-sm p-8 text-center shadow-lg">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-5">
          <Sparkles className="text-amber-400" size={28} />
        </div>
        <h1 className="text-xl font-bold text-white tracking-tight mb-2">{title}</h1>
        <p className="text-sm text-gray-400 mb-6">
          {featureLabel} requires an active <span className="text-amber-300 font-medium">{requiredPlan}</span> subscription.
          Your Free plan still includes DNA generation, Vault, and certificates.
        </p>
        <ul className="text-left space-y-3 mb-8">
          {UNLOCK_ITEMS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-start gap-3 text-sm text-gray-300">
              <Icon size={16} className="text-dna-400 mt-0.5 shrink-0" />
              <span>{label}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/upgrade"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-dna-600 hover:bg-dna-500 text-white text-sm font-semibold transition-colors"
          >
            Upgrade Now
          </Link>
          <Link
            to="/vault"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-bg-border text-gray-300 hover:text-white text-sm transition-colors"
          >
            Continue with Free
          </Link>
        </div>
      </div>
    </div>
  );
}
