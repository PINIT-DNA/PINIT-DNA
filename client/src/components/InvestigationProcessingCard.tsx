import { RefreshCw } from 'lucide-react';
import { cn } from './ui/utils';
import { InvestigationFilePreview } from './InvestigationFilePreview';

interface InvestigationProcessingCardProps {
  file?: File | null;
  fileName?: string;
  className?: string;
}

/** Shared post-capture / post-upload processing state for Unified Investigation */
export function InvestigationProcessingCard({
  file,
  fileName,
  className,
}: InvestigationProcessingCardProps) {
  const displayName = fileName ?? file?.name;

  return (
    <div className={cn('card border border-dna-500/20 overflow-hidden', className)}>
      <div className="p-6 flex flex-col items-center text-center gap-4">
        {file && (
          <div className="w-full max-w-[280px] aspect-[4/3] rounded-xl overflow-hidden border border-bg-border bg-black/40">
            <InvestigationFilePreview file={file} className="w-full h-full object-contain" />
          </div>
        )}

        <div className="flex items-center gap-3">
          <RefreshCw size={22} className="text-dna-400 animate-spin shrink-0" />
          <div className="text-left">
            <p className="text-base font-semibold text-white">Investigating evidence…</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {displayName ?? 'Running forensic analysis'}
            </p>
          </div>
        </div>

        <div className="w-full max-w-xs h-1 rounded-full bg-bg-border overflow-hidden">
          <div className="h-full w-2/5 bg-dna-400/90 rounded-full animate-pulse" />
        </div>
      </div>
    </div>
  );
}
