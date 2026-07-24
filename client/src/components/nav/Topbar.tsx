import { useLocation, Link } from 'react-router-dom';
import { Plus, ChevronRight, Menu } from 'lucide-react';
import { ProfileDropdown } from './ProfileDropdown';
import { NotificationBell } from './NotificationBell';
import { AccountModeSwitcher } from './AccountModeSwitcher';
import { BRAND } from '../../config/brand.config';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/':                    { title: 'Dashboard',             subtitle: 'System overview & analytics'              },
  '/business':            { title: 'Business Dashboard',    subtitle: 'Organization overview & operations'       },
  '/generate':            { title: 'Protect file',           subtitle: 'Create a fingerprint to prove ownership' },
  '/vault':               { title: 'Files',                  subtitle: 'Your protected & encrypted files'         },
  '/vault-integrity':     { title: 'Vault Integrity',        subtitle: 'Verify encrypted files exist on disk'   },
  '/dna-records':         { title: 'DNA Records',             subtitle: 'All generated fingerprint records'      },
  '/timeline':            { title: 'View in Timeline',        subtitle: 'Complete lifecycle audit trail'         },
  '/reports':             { title: 'Forensic Reports',        subtitle: 'Analysis, tampering detection & exports'},
  '/certificates':        { title: 'Certificates',            subtitle: ''      },
  '/verify-certificate':  { title: 'Verify Certificate',     subtitle: 'Verify certificate authenticity live'   },
  '/search':              { title: 'AI Search',              subtitle: 'Find documents by meaning using FAISS'        },
  '/forensic-diff':       { title: 'Difference Engine',      subtitle: 'What changed, where, and how severely'     },
  '/monitoring':          { title: 'Monitoring',             subtitle: 'Watch internet for unauthorized file copies' },
  '/access-intelligence': { title: 'Tracking',               subtitle: 'Shared links and Share File tracking' },
  [BRAND.investigationPath]: { title: 'Unified Investigation', subtitle: 'Upload a file to check matches and authenticity' },
};

interface TopbarProps {
  onMenu?: () => void;
}

export function Topbar({ onMenu }: TopbarProps) {
  const location = useLocation();
  const meta = PAGE_META[location.pathname] ?? { title: BRAND.name, subtitle: '' };

  return (
    <header
      className="h-14 flex items-center justify-between px-3 sm:px-6 border-b border-bg-border bg-white/80 dark:bg-bg-card/95 backdrop-blur-xl sticky top-0 z-30 shrink-0"
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
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-gray-500 mono shrink-0">
          <img src={BRAND.logoSrc} alt="" className="w-3.5 h-3.5 rounded object-contain" aria-hidden />
          <span>{BRAND.name}</span>
          <ChevronRight size={10} />
        </div>
        <div className="min-w-0">
          <p className="text-base lg:text-sm font-semibold text-white truncate">{meta.title}</p>
        </div>
        {meta.subtitle && (
          <p className="hidden xl:block text-xs text-gray-500 truncate">— {meta.subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <AccountModeSwitcher />
        <Link
          to="/generate"
          className="btn btn-primary btn-sm text-xs hidden lg:flex nav-cta"
        >
          <Plus size={14} />
          Protect file
        </Link>
        <NotificationBell />
        <ProfileDropdown />
      </div>
    </header>
  );
}
