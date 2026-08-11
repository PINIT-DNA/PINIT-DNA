import { useLocation, Link } from 'react-router-dom';
import { useState } from 'react';
import { Plus, ChevronRight, Menu, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import { ProfileDropdown } from './ProfileDropdown';
import { NotificationBell } from './NotificationBell';
import { AccountModeSwitcher } from './AccountModeSwitcher';
import { BRAND } from '../../config/brand.config';
import { createExchangeSso } from '../../services/dashboard.api';
import { useAuth } from '../../context/AuthContext';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/':                    { title: 'Home',                  subtitle: 'What happened with your files'           },
  '/business':            { title: 'Organization home',     subtitle: 'Team operations overview'                },
  '/generate':            { title: 'Protect file',          subtitle: 'Create a protected identity for a file'  },
  '/vault':               { title: 'Digital Assets',        subtitle: 'Your protected files — share and track'  },
  '/vault-integrity':     { title: 'Vault check',           subtitle: 'Confirm your files are stored safely'    },
  '/dna-records':         { title: 'Protected files',       subtitle: 'Files you have protected in Pinit HUB'   },
  '/timeline':            { title: 'File activity',         subtitle: 'What happened to your files'             },
  '/reports':             { title: 'Reports',               subtitle: 'Investigation and comparison reports'   },
  '/certificates':        { title: 'Certificates',          subtitle: 'Ownership proof you can share'           },
  '/verify-certificate':  { title: 'Verify certificate',    subtitle: 'Check if a certificate is still valid'   },
  '/search':              { title: 'Search',                subtitle: 'Find files and activity'                 },
  '/forensic-diff':       { title: 'Compare files',         subtitle: 'See what changed between two files'      },
  '/monitoring':          { title: 'Monitoring',            subtitle: 'Watch for copies of your files online'  },
  '/protected-posts':     { title: 'Digital Assets',        subtitle: 'Your protected files'                    },
  '/assets':              { title: 'Digital Assets',        subtitle: 'Your protected files'                    },
  '/access-intelligence': { title: 'Tracking',              subtitle: 'Who opened your shared files'            },
  '/unmask-requests':     { title: 'Unmask requests',       subtitle: 'Approve sensitive data reveal requests'  },
  '/duplicate-attempts':  { title: 'Duplicate attempts',    subtitle: 'When someone tried to re-upload your file' },
  '/profile':             { title: 'Profile',               subtitle: 'Your account and preferences'            },
  '/upgrade':             { title: 'Plans',                 subtitle: 'Choose the plan that fits you'           },
  '/subscription':        { title: 'Subscription',          subtitle: 'Billing and plan details'                },
  [BRAND.investigationPath]: { title: 'Investigate',        subtitle: 'Find the owner of a suspected file'      },
};

interface TopbarProps {
  onMenu?: () => void;
}

export function Topbar({ onMenu }: TopbarProps) {
  const location = useLocation();
  const { user } = useAuth();
  const [openingExchange, setOpeningExchange] = useState(false);
  const meta = PAGE_META[location.pathname]
    ?? (location.pathname.startsWith('/access-intelligence/')
      ? { title: 'Tracking', subtitle: 'Activity for this shared file' }
      : location.pathname.startsWith('/protected-posts/') || location.pathname.startsWith('/assets/')
        ? { title: 'Digital Assets', subtitle: 'Your protected files' }
        : { title: BRAND.name, subtitle: '' });

  const openExchange = async () => {
    if (!user) {
      toast.error('Sign in to Hub first, then open Exchange');
      return;
    }
    setOpeningExchange(true);
    try {
      const result = await createExchangeSso();
      window.open(result.exchangeUrl, '_blank', 'noopener,noreferrer');
      toast.success('Opening Pinit Exchange with your Hub identity…');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err instanceof Error ? err.message : 'Could not open Exchange');
      toast.error(msg);
    } finally {
      setOpeningExchange(false);
    }
  };

  return (
    <header
      className="h-14 flex items-center justify-between px-3 sm:px-6 border-b border-bg-border bg-white/80 dark:bg-bg-card/95 backdrop-blur-xl sticky top-0 z-[100] shrink-0"
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
        <button
          type="button"
          onClick={() => void openExchange()}
          disabled={openingExchange}
          className="btn btn-ghost btn-sm text-xs hidden md:flex items-center gap-1.5"
          title="Open Pinit Exchange with Hub SSO"
        >
          <Store size={14} />
          {openingExchange ? 'Opening…' : 'Exchange'}
        </button>
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
