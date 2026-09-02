import { useLocation, Link } from 'react-router-dom';
import { Plus, Menu } from 'lucide-react';
import { ProfileDropdown } from './ProfileDropdown';
import { NotificationBell } from './NotificationBell';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { BRAND } from '../../config/brand.config';
import { useAccountViewMode } from '../../hooks/useAccountViewMode';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/':                    { title: 'Home', subtitle: 'What needs your attention' },
  '/business':            { title: 'Home', subtitle: 'Team operations' },
  '/generate':            { title: 'Protect New Asset', subtitle: 'Upload your file and we’ll create its protected identity' },
  '/vault':               { title: 'My Assets', subtitle: 'Your protected files — share and track' },
  '/vault-integrity':     { title: 'Security Check', subtitle: 'Confirm your files are stored safely' },
  '/dna-records':         { title: 'Protected Files', subtitle: 'Files you have protected in Pinit HUB' },
  '/timeline':            { title: 'Timeline', subtitle: 'Complete chronological history of the asset' },
  '/reports':             { title: 'Reports', subtitle: 'Investigation and comparison reports' },
  '/certificates':        { title: 'Certificates', subtitle: 'Ownership proof you can share' },
  '/verify-certificate':  { title: 'Verify certificate', subtitle: 'Check if a certificate is still valid' },
  '/search':              { title: 'Search', subtitle: 'Find files and activity' },
  '/forensic-diff':       { title: 'Compare files', subtitle: 'See what changed between two files' },
  '/monitoring':          { title: 'Monitoring', subtitle: 'Watch for copies of your files online' },
  '/protected-posts':     { title: 'My Assets', subtitle: 'Your protected files' },
  '/assets':              { title: 'My Assets', subtitle: 'Your protected files' },
  '/access-intelligence': { title: 'Asset Activity', subtitle: 'See who accessed this asset and what happened' },
  '/unmask-requests':     { title: 'Access Requests', subtitle: 'Approve sensitive data reveal requests' },
  '/duplicate-attempts':  { title: 'Duplicate Checks', subtitle: 'When someone tried to re-upload your file' },
  '/profile':             { title: 'Account', subtitle: 'Your account and preferences' },
  '/upgrade':             { title: 'Plans', subtitle: 'Choose the plan that fits you' },
  '/subscription':        { title: 'Billing', subtitle: 'Billing and plan details' },
  [BRAND.investigationPath]: { title: 'Investigate a File', subtitle: 'Find out whether a file is connected to protected work' },
};

interface TopbarProps {
  onMenu?: () => void;
}

export function Topbar({ onMenu }: TopbarProps) {
  const location = useLocation();
  const { isBusinessShell } = useAccountViewMode();
  const notificationsOpen = location.pathname === '/profile' && new URLSearchParams(location.search).get('tab') === 'notifications';
  const meta = notificationsOpen
    ? { title: 'Notifications', subtitle: 'Choose what we notify you about' }
    : (PAGE_META[location.pathname]
    ?? (/^\/vault\/assets\/[^/]+\/shares\//.test(location.pathname)
      ? { title: 'Manage share', subtitle: 'Secure link details and actions' }
      : /^\/vault\/assets\/[^/]+\/share$/.test(location.pathname)
        ? { title: 'Share secure link', subtitle: 'Control how this protected file can be accessed' }
        : location.pathname.startsWith('/access-intelligence/')
          ? { title: 'Asset Activity', subtitle: 'See who accessed this asset and what happened' }
          : location.pathname.startsWith('/protected-posts/') || location.pathname.startsWith('/assets/')
            ? { title: 'My Assets', subtitle: 'Your protected files' }
            : location.pathname.startsWith('/business/clients')
              ? { title: 'Clients', subtitle: 'Campaigns, reviews and deliveries' }
              : location.pathname.startsWith('/business/campaigns')
                ? { title: 'Campaign', subtitle: 'Reviews, approvals and deliveries' }
                : location.pathname.startsWith('/business/team')
                  ? { title: 'Creators', subtitle: 'People on this workspace' }
                  : { title: BRAND.name, subtitle: '' }));

  return (
    <header
      className="hub-header h-14 flex items-center justify-between px-3 sm:px-6 border-b border-slate-200 bg-white/95 backdrop-blur-xl sticky top-0 z-[100] shrink-0"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          onClick={onMenu}
          className="lg:hidden btn-icon btn-ghost shrink-0 touch-manipulation"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="lg:hidden min-w-0 flex-1 max-w-[14rem]">
          <WorkspaceSwitcher compact />
        </div>
        <div className="hidden lg:block min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{meta.title}</p>
          {meta.subtitle && (
            <p className="hidden xl:block text-xs text-slate-500 truncate">{meta.subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 justify-end">
        {isBusinessShell && (
          <span className="hidden md:inline-flex text-2xs font-semibold text-dna-700 bg-dna-50 border border-dna-100 rounded-full px-2.5 py-1">
            Business
          </span>
        )}
        <Link
          to="/generate"
          className="btn btn-primary btn-sm text-xs hidden lg:flex nav-cta"
        >
          <Plus size={14} />
          Protect New
        </Link>
        <NotificationBell />
        <ProfileDropdown />
      </div>
    </header>
  );
}
