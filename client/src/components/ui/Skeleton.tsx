import { cn } from './utils';

interface SkeletonProps { className?: string; }

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('skeleton', className)} />;
}

export function SkeletonCard() {
  return (
    <div className="card space-y-3 animate-fade-in">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-3.5 border-b border-bg-border/60">
          <Skeleton className={`h-4 ${i === 0 ? 'w-32' : i === 1 ? 'w-20' : 'w-16'}`} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <>{Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}</>
  );
}
