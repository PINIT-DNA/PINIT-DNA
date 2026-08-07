import { Building2, Sparkles } from 'lucide-react';

interface BusinessWelcomeCardProps {
  orgShortId: string;
  onStartSetup: () => void;
  onSkip: () => void;
  busy?: boolean;
}

export function BusinessWelcomeCard({
  orgShortId,
  onStartSetup,
  onSkip,
  busy = false,
}: BusinessWelcomeCardProps) {
  return (
    <section className="rounded-2xl border border-purple-500/35 bg-gradient-to-br from-purple-500/10 via-bg-card to-bg-card p-6 sm:p-8 space-y-5">
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-12 h-12 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center">
          <Building2 size={22} className="text-purple-400" />
        </div>
        <div className="space-y-1 min-w-0">
          <div className="inline-flex items-center gap-2 text-purple-300 text-xs font-medium">
            <Sparkles size={12} />
            Welcome to PINITHub Business
          </div>
          <h2 className="text-xl font-bold text-white">Business mode is ready on your account</h2>
          <p className="text-sm text-gray-400">
            Same face, same number — only the prefix changes (USER ↔ ORG). Complete your organization profile when ready.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-bg-border bg-bg-elevated/80 px-4 py-3">
        <p className="text-2xs text-gray-500 uppercase tracking-wider mb-1">Organization PINIT ID</p>
        <p className="text-lg font-mono font-semibold text-white">{orgShortId}</p>
        <p className="text-2xs text-gray-500 mt-1">Shares your Individual account code — not a separate registration.</p>
      </div>

      <p className="text-sm text-gray-400">Complete your organization setup.</p>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onStartSetup}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white text-sm font-semibold"
        >
          Start Setup
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSkip}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-bg-border text-sm text-gray-300 hover:bg-bg-elevated disabled:opacity-60"
        >
          Skip for now
        </button>
      </div>
    </section>
  );
}
