import { Link, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../ui/utils';

interface SubscriptionFlowShellProps {
  title: string;
  subtitle?: string;
  step?: { current: number; total: number; label?: string };
  backTo?: string;
  backLabel?: string;
  children: React.ReactNode;
  className?: string;
}

export function SubscriptionFlowShell({
  title,
  subtitle,
  step,
  backTo,
  backLabel = 'Back',
  children,
  className,
}: SubscriptionFlowShellProps) {
  const navigate = useNavigate();

  return (
    <div className={cn('min-h-[calc(100dvh-8rem)]', className)}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            {step && (
              <p className="text-2xs font-semibold uppercase tracking-wider text-dna-400 mb-2">
                Step {step.current} of {step.total}
                {step.label ? ` · ${step.label}` : ''}
              </p>
            )}
            <h1 className="text-xl sm:text-2xl font-bold text-white">{title}</h1>
            {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
          </div>
          {backTo ? (
            <Link
              to={backTo}
              className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-bg-elevated transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-bg-elevated transition-colors"
              aria-label="Go back"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {step && (
          <div className="flex gap-2">
            {Array.from({ length: step.total }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  i < step.current ? 'bg-dna-500' : 'bg-bg-border',
                )}
              />
            ))}
          </div>
        )}

        {children}

        {backTo && (
          <p className="text-center text-2xs text-gray-500 pt-2">
            <Link to={backTo} className="text-dna-400 hover:underline">{backLabel}</Link>
          </p>
        )}
      </div>
    </div>
  );
}
