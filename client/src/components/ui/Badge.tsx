import { cn } from './utils';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'muted' | 'dna' | 'cyan' | 'orange';

const MAP: Record<Variant, string> = {
  success: 'bg-success/15 text-success border-success/20',
  warning: 'bg-warning/15 text-warning border-warning/20',
  danger:  'bg-danger/15  text-danger  border-danger/20',
  info:    'bg-info/15    text-info    border-info/20',
  purple:  'bg-purple/15  text-purple  border-purple/20',
  cyan:    'bg-cyan/15    text-cyan    border-cyan/20',
  orange:  'bg-orange/15  text-orange  border-orange/20',
  muted:   'bg-bg-elevated text-gray-400 border-bg-border',
  dna:     'bg-dna-500/15 text-dna-400 border-dna-500/20',
};

const DOT_MAP: Record<Variant, string> = {
  success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger',
  info: 'bg-info', purple: 'bg-purple', cyan: 'bg-cyan', orange: 'bg-orange',
  muted: 'bg-gray-500', dna: 'bg-dna-500',
};

interface BadgeProps {
  variant?: Variant;
  dot?: boolean;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'muted', dot, pulse, children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full border',
      MAP[variant], className
    )}>
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', DOT_MAP[variant])} />}
          <span className={cn('relative inline-flex rounded-full h-1.5 w-1.5', DOT_MAP[variant])} />
        </span>
      )}
      {children}
    </span>
  );
}

// Classification badge helper
export function ClassificationBadge({ value }: { value: string }) {
  const map: Record<string, { variant: Variant; label: string }> = {
    DNA_MATCH:  { variant: 'success', label: 'DNA MATCH'  },
    SIMILAR:    { variant: 'warning', label: 'SIMILAR'    },
    DIFFERENT:  { variant: 'danger',  label: 'DIFFERENT'  },
    COMPLETE:   { variant: 'success', label: 'COMPLETE'   },
    PARTIAL:    { variant: 'warning', label: 'PARTIAL'    },
    FAILED:     { variant: 'danger',  label: 'FAILED'     },
    PENDING:    { variant: 'muted',   label: 'PENDING'    },
    PROCESSING: { variant: 'info',    label: 'PROCESSING' },
    LIVE:       { variant: 'success', label: 'LIVE'       },
    PLANNED:    { variant: 'muted',   label: 'PLANNED'    },
  };
  const cfg = map[value] ?? { variant: 'muted' as Variant, label: value };
  return <Badge variant={cfg.variant} dot>{cfg.label}</Badge>;
}

// File type color badge
export function FileTypeBadge({ type }: { type: string }) {
  const map: Record<string, Variant> = {
    IMAGE: 'purple', PDF: 'danger', DOCX: 'info', PPTX: 'orange',
    TXT: 'muted', CSV: 'success', JSON: 'warning', ZIP: 'cyan',
    VIDEO: 'dna', AUDIO: 'info',
  };
  return <Badge variant={map[type] ?? 'muted'}>{type}</Badge>;
}
