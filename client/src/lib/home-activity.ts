export type HomeActivityEvent = {
  id: string;
  type: string;
  date: string;
  detail: string;
  href?: string | null;
};

export const HOME_ACTIVITY_TABS: Array<{
  id: string;
  label: string;
  empty: string;
  moreTo?: string;
  moreLabel?: string;
}> = [
  { id: 'all', label: 'All Activity', empty: 'No activity yet.', moreTo: '/timeline', moreLabel: 'Asset timeline' },
  { id: 'mine', label: 'My Activity', empty: 'You have not recorded any actions yet.' },
  { id: 'assets', label: 'Assets', empty: 'No asset activity yet.', moreTo: '/vault', moreLabel: 'Open Vault' },
  { id: 'projects', label: 'Projects', empty: 'No project activity yet.', moreTo: '/profile?tab=portfolio', moreLabel: 'Open Portfolio' },
  { id: 'portfolio', label: 'Portfolio', empty: 'No portfolio activity yet.', moreTo: '/profile?tab=portfolio', moreLabel: 'Open Portfolio' },
  { id: 'clients', label: 'Clients', empty: 'No client activity yet.', moreTo: '/business/clients', moreLabel: 'Open Clients' },
  { id: 'sharing', label: 'Sharing', empty: 'No sharing activity yet.', moreTo: '/access-intelligence', moreLabel: 'Open Sharing' },
  { id: 'exchange', label: 'Exchange', empty: 'No marketplace activity yet.' },
  { id: 'protection', label: 'Protection', empty: 'No protection activity yet.', moreTo: '/generate', moreLabel: 'Protect New' },
  { id: 'evidence', label: 'Evidence', empty: 'No evidence activity yet.', moreTo: '/reports', moreLabel: 'Open Evidence' },
];

function fileHint(detail: string | undefined): string {
  const text = (detail ?? '').trim();
  if (!text) return 'an asset';
  if (text.includes(' · ')) return 'a shared asset';
  return text;
}

/** User-facing Home copy. Does not invent filenames that the API did not send. */
export function humanizeHomeActivity(ev: HomeActivityEvent): { title: string; subtitle: string } {
  const detail = (ev.detail ?? '').trim();
  switch (ev.type) {
    case 'DNA_GENERATED':
    case 'VAULT_UPLOAD':
      return { title: 'Asset Protected', subtitle: `${fileHint(detail)} was protected` };
    case 'SHARE_CREATED':
      return { title: 'Asset Shared', subtitle: `${fileHint(detail)} was shared` };
    case 'ACCESS_VIEWED':
      return { title: 'Asset Viewed', subtitle: detail ? `A share was opened · ${detail}` : 'Someone viewed a shared asset' };
    case 'ACCESS_DOWNLOADED':
      return { title: 'Download', subtitle: detail ? `A shared file was downloaded · ${detail}` : 'A shared file was downloaded' };
    case 'CERT_GENERATED':
      return { title: 'Certificate Created', subtitle: 'A certificate was issued from your account' };
    case 'RISK_EVENT':
      return { title: 'Security Event', subtitle: detail || 'A high-risk action was recorded on a share' };
    case 'EVIDENCE_CREATED':
      return { title: 'Evidence Created', subtitle: detail ? `Evidence created for ${detail}` : 'Evidence was saved' };
    case 'MONITORING_MATCH':
      return { title: 'Monitoring Match', subtitle: detail || 'A possible copy was found' };
    case 'PORTFOLIO_UPDATED':
      return { title: 'Portfolio Updated', subtitle: 'Your portfolio was saved' };
    case 'PORTFOLIO_VIEWED':
      return { title: 'Portfolio Viewed', subtitle: detail || 'Someone viewed your portfolio' };
    default:
      return { title: 'Activity', subtitle: detail || 'Account activity' };
  }
}

const SELF_TYPES = new Set([
  'DNA_GENERATED', 'VAULT_UPLOAD', 'SHARE_CREATED', 'CERT_GENERATED',
  'PORTFOLIO_UPDATED', 'EVIDENCE_CREATED',
]);

export function homeActivityFilter(ev: HomeActivityEvent, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'mine') return SELF_TYPES.has(ev.type);
  if (filter === 'assets') return ev.type === 'VAULT_UPLOAD' || ev.type === 'DNA_GENERATED';
  if (filter === 'projects') return false;
  if (filter === 'portfolio') return ev.type === 'PORTFOLIO_UPDATED' || ev.type === 'PORTFOLIO_VIEWED';
  if (filter === 'clients') return false;
  if (filter === 'sharing') return ev.type === 'SHARE_CREATED' || ev.type.startsWith('ACCESS_');
  if (filter === 'protection') return ev.type === 'DNA_GENERATED' || ev.type === 'VAULT_UPLOAD' || ev.type === 'RISK_EVENT';
  if (filter === 'evidence') return ev.type === 'EVIDENCE_CREATED';
  if (filter === 'exchange') return ev.type === 'EXCHANGE';
  return true;
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Present match types without exposing hash/algorithm internals. */
export function friendlyMatchLabel(raw: string): string {
  const t = (raw ?? '').replace(/_/g, ' ').trim();
  if (!t) return 'Match';
  if (/exact/i.test(t)) return 'Exact match';
  if (/near|similar/i.test(t)) return 'Similar match';
  return t.replace(/\bhash\b/ig, '').replace(/\s+/g, ' ').trim() || 'Match';
}

export type ActivityHrefContext = {
  vaultRecords: Array<{ id: string; dnaRecordId: string; originalFileName: string }>;
  shareLinks: Array<{ token: string; filename: string; vaultId?: string | null }>;
};

export function resolveHomeActivityHref(ev: HomeActivityEvent, ctx: ActivityHrefContext): string | null {
  switch (ev.type) {
    case 'VAULT_UPLOAD':
      return `/vault?id=${encodeURIComponent(ev.id)}`;
    case 'DNA_GENERATED': {
      const byDna = ctx.vaultRecords.find((v) => v.dnaRecordId === ev.id);
      const byName = ctx.vaultRecords.find((v) => v.originalFileName === ev.detail);
      const vault = byDna ?? byName;
      return vault ? `/vault?id=${encodeURIComponent(vault.id)}` : '/vault';
    }
    case 'SHARE_CREATED': {
      const link = ctx.shareLinks.find((l) => l.filename === ev.detail);
      if (link) return `/access-intelligence/${encodeURIComponent(link.token)}`;
      return '/access-intelligence';
    }
    case 'ACCESS_VIEWED':
    case 'ACCESS_DOWNLOADED':
    case 'RISK_EVENT':
      return '/access-intelligence';
    case 'CERT_GENERATED':
      return '/certificates';
    case 'EVIDENCE_CREATED':
      return '/reports';
    case 'MONITORING_MATCH':
      return '/monitoring';
    case 'PORTFOLIO_UPDATED':
    case 'PORTFOLIO_VIEWED':
      return '/profile?tab=portfolio';
    default:
      return null;
  }
}
