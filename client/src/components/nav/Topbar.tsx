import { useLocation, Link } from 'react-router-dom';
import { Bell, Plus, ChevronRight } from 'lucide-react';
import { Dna } from 'lucide-react';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/':                    { title: 'Dashboard',             subtitle: 'System overview & analytics'              },
  '/generate':            { title: 'Generate DNA',           subtitle: 'Upload a file and fingerprint it'        },
  '/compare':             { title: 'DNA Comparison',         subtitle: 'Layer-by-layer forensic comparison'      },
  '/vault':               { title: 'Vault Explorer',          subtitle: 'Encrypted file storage'                 },
  '/vault-integrity':     { title: 'Vault Integrity Monitor', subtitle: 'Verify encrypted files exist on disk'   },
  '/dna-records':         { title: 'DNA Records',             subtitle: 'All generated fingerprint records'      },
  '/timeline':            { title: 'File Timeline',           subtitle: 'Complete lifecycle audit trail'         },
  '/reports':             { title: 'Forensic Reports',        subtitle: 'Analysis, tampering detection & exports'},
  '/certificates':        { title: 'Certificates',            subtitle: 'Ownership and verification proofs'      },
  '/verify-certificate':  { title: 'Certificate Verification',subtitle: 'Verify certificate authenticity live'   },
  '/search':              { title: 'AI Semantic Search',       subtitle: 'Find documents by meaning using FAISS'        },
  '/forensic-diff':       { title: 'Forensic Difference Engine', subtitle: 'What changed, where, and how severely'     },
  '/monitoring':          { title: 'Monitoring & Crawler',       subtitle: 'Watch internet for unauthorized file copies' },
};

export function Topbar() {
  const location = useLocation();
  const meta = PAGE_META[location.pathname] ?? { title: 'Dashboard', subtitle: '' };

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-bg-border bg-bg-surface/80 backdrop-blur-sm sticky top-0 z-30">

      {/* Page breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mono shrink-0">
          <Dna size={12} className="text-dna-500" />
          <span>PINIT-DNA</span>
          <ChevronRight size={10} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{meta.title}</p>
        </div>
        {meta.subtitle && (
          <p className="hidden md:block text-xs text-gray-500 truncate">— {meta.subtitle}</p>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/generate"
          className="btn btn-primary btn-sm text-xs hidden sm:flex"
        >
          <Plus size={14} />
          Generate DNA
        </Link>

        <button className="btn-icon btn-ghost relative">
          <Bell size={16} className="text-gray-400" />
        </button>

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-dna-500 to-purple flex items-center justify-center text-xs font-bold text-white select-none">
          P
        </div>
      </div>
    </header>
  );
}
