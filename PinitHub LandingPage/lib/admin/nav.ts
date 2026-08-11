import type { Role } from '@/lib/auth/roles';

/** Single source of truth for the admin sidebar and the mobile nav select. */
export const ADMIN_NAV: { href: string; label: string; minRole: Role }[] = [
  { href: '/admin', label: 'Dashboard', minRole: 'EDITOR' },
  { href: '/admin/content', label: 'Content', minRole: 'EDITOR' },
  { href: '/admin/content/sections', label: 'Sections', minRole: 'EDITOR' },
  { href: '/admin/settings', label: 'Site settings', minRole: 'EDITOR' },
  { href: '/admin/inbox/demos', label: 'Demo requests', minRole: 'ADMIN' },
  { href: '/admin/inbox/newsletter', label: 'Newsletter', minRole: 'ADMIN' },
  { href: '/admin/users', label: 'Users', minRole: 'OWNER' },
  { href: '/admin/audit-log', label: 'Audit log', minRole: 'OWNER' },
];
