import type { ReactNode } from 'react';

export default function PortfolioPages(props: {
  portfolio: unknown;
  onSelectListing?: (listing?: unknown) => void;
  onContact?: () => void;
  onHire?: () => void;
  onShare?: () => void;
}): ReactNode;
