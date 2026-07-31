import { motion, AnimatePresence } from 'framer-motion';
import { Check, Sparkles, X, Zap, Building2 } from 'lucide-react';
import { UNLOCKED_FEATURES_BY_PLAN } from '../../lib/subscription/plans';
import type { PlanCode } from '../../hooks/useSubscription';
import { cn } from '../ui/utils';

interface UpgradeWelcomeModalProps {
  open: boolean;
  planCode: PlanCode;
  onDismiss: () => void;
}

export function UpgradeWelcomeModal({ open, planCode, onDismiss }: UpgradeWelcomeModalProps) {
  if (planCode === 'FREE') return null;

  const features = UNLOCKED_FEATURES_BY_PLAN[planCode] ?? [];
  const isEnterprise = planCode === 'ENTERPRISE';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[100] backdrop-blur-sm"
            onClick={onDismiss}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-[min(100vw-32px,480px)]"
          >
            <div
              className={cn(
                'rounded-2xl border p-6 shadow-2xl',
                isEnterprise
                  ? 'border-purple-500/40 bg-gradient-to-b from-purple-500/10 to-bg-card'
                  : 'border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-bg-card',
              )}
            >
              <button
                type="button"
                onClick={onDismiss}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
              >
                <X size={16} />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div
                  className={cn(
                    'w-12 h-12 rounded-xl flex items-center justify-center',
                    isEnterprise ? 'bg-purple-500/20' : 'bg-amber-500/20',
                  )}
                >
                  {isEnterprise ? (
                    <Building2 size={24} className="text-purple-400" />
                  ) : (
                    <Zap size={24} className="text-amber-400" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-dna-400">
                    <Sparkles size={14} />
                    Upgrade complete
                  </div>
                  <h2 className="text-lg font-bold text-white">
                    Welcome to PINITHub {isEnterprise ? 'Enterprise' : 'Pro'}
                  </h2>
                </div>
              </div>

              <p className="text-sm text-gray-400 mb-4">
                Your premium features are now unlocked. Here&apos;s what you can do:
              </p>

              <ul className="space-y-2 mb-6">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                    <Check size={14} className="text-emerald-400 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={onDismiss}
                className={cn(
                  'w-full py-2.5 rounded-xl text-sm font-semibold transition-colors',
                  isEnterprise
                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-black',
                )}
              >
                Explore new features
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
