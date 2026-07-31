import { cn } from './utils';

interface TableWrapProps {
  children: React.ReactNode;
  className?: string;
}

/** Scrollable table container — use on every wide table */
export function TableWrap({ children, className }: TableWrapProps) {
  return (
    <div className={cn('table-wrap -mx-4 sm:mx-0', className)}>
      <div className="overflow-x-auto overscroll-x-contain">
        {children}
      </div>
    </div>
  );
}
