import { useLocation, Link } from 'react-router-dom';
import { Plus, ChevronRight } from 'lucide-react';
import { Dna } from 'lucide-react';
import { ProfileDropdown } from './ProfileDropdown';
import { NotificationBell } from './NotificationBell';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/':                    { title: 'Dashboard',             subtitle: 'System overview & analytics'              },
  '/generate':            { title: 'Generate DNA',           subtitle: ''        },
  '/compare':             { title: 'Compare',                subtitle: ''        },
  '/vault':               { title: 'Vault',                  subtitle: 'Encrypted file storage'                 },
  '/vault-integrity':     { title: 'Vault Integrity',        subtitle: 'Verify encrypted files exist on disk'   },
  '/dna-records':         { title: 'DNA Records',             subtitle: 'All generated fingerprint records'      },
  '/timeline':            { title: 'File Timeline',           subtitle: 'Complete lifecycle audit trail'         },
  '/reports':             { title: 'Forensic Reports',        subtitle: 'Analysis, tampering detection & exports'},
  '/certificates':        { title: 'Certificates',            subtitle: ''      },
  '/verify-certificate':  { title: 'Verify Certificate',     subtitle: 'Verify certificate authenticity live'   },
  '/search':              { title: 'AI Search',              subtitle: 'Find documents by meaning using FAISS'        },
  '/forensic-diff':       { title: 'Difference Engine',      subtitle: 'What changed, where, and how severely'     },
  '/monitoring':          { title: 'Monitoring',             subtitle: 'Watch internet for unauthorized file copies' },
};

interface TopbarProps {
  onMenu?: () => void;
}

export function Topbar({ onMenu: _onMenu }: TopbarProps) {
  const location = useLocation();
  const meta = PAGE_META[location.pathname] ?? { title: 'PINIT-DNA', subtitle: '' };

  return (
    <header
      className="h-14 flex items-center justify-between px-4 sm:px-6 border-b border-bg-border bg-bg-card/95 backdrop-blur-md sticky top-0 z-30 shrink-0"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="lg:hidden w-8 h-8 rounded-xl bg-dna-500 flex items-center justify-center shrink-0 shadow-sm">
          <Dna size={16} className="text-white" />
        </div>
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-gray-500 mono shrink-0">
          <Dna size={12} className="text-dna-500" />
          <span>PINIT-DNA</span>
          <ChevronRight size={10} />
        </div>
        <div className="min-w-0">
          <p className="text-base lg:text-sm font-semibold text-white truncate">{meta.title}</p>
        </div>
        {meta.subtitle && (
          <p className="hidden md:block text-xs text-gray-500 truncate">— {meta.subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <Link
          to="/generate"
          className="btn btn-primary btn-sm text-xs hidden lg:flex"
        >
          <Plus size={14} />
          Generate DNA
        </Link>
        <NotificationBell />
        <ProfileDropdown />
      </div>
    </header>
  );
}
