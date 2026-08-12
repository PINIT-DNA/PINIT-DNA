import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'li' | 'section';
}) {
  return (
    <Tag className={`panel rounded-[var(--radius-xl)] border border-line bg-ink-2/60 ${className}`}>
      {children}
    </Tag>
  );
}
