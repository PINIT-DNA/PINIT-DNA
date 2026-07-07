import { cn } from './utils';

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
  /** Wider pages (dashboard, vault explorer) */
  wide?: boolean;
}

/** Standard page container — prevents horizontal overflow on mobile */
export function PageShell({ children, className, wide }: PageShellProps) {
  return (
    <div
      className={cn(
        'w-full min-w-0 mx-auto space-y-4 sm:space-y-6',
        wide ? 'max-w-[1600px]' : 'max-w-[1400px]',
        className,
      )}
    >
      {children}
    </div>
  );
}
