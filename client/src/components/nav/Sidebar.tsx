import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Dna, Shield, Archive, FileSearch,
  GitCompare, Award, ChevronRight, Zap,
} from 'lucide-react';
import { cn } from '../ui/utils';

const NAV = [
  { to: '/',            icon: LayoutDashboard, label: 'Dashboard',      end: true },
  { to: '/generate',   icon: Dna,             label: 'Generate DNA'            },
  { to: '/compare',    icon: GitCompare,       label: 'DNA Compare'            },
  { to: '/vault',      icon: Archive,          label: 'Vault Explorer'         },
  { to: '/dna-records',icon: FileSearch,       label: 'DNA Records'            },
  { to: '/reports',    icon: Shield,           label: 'Forensic Reports'       },
  { to: '/certificates',icon: Award,           label: 'Certificates'           },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-bg-surface border-r border-bg-border flex flex-col z-40 select-none">

      {/* Logo */}
      <div className="h-14 flex items-center gap-3 px-5 border-b border-bg-border shrink-0">
        <div className="w-7 h-7 rounded-lg bg-dna-500 flex items-center justify-center shadow-glow-purple">
          <Dna size={14} className="text-white" />
        </div>
        <div className="leading-none">
          <p className="font-bold text-white text-sm tracking-tight">
            PINIT<span className="text-dna-400">-DNA</span>
          </p>
          <p className="text-2xs text-gray-500 mono mt-0.5">v2.0 · Universal</p>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <p className="text-2xs font-semibold text-gray-600 uppercase tracking-widest px-2 mb-2">
          Navigation
        </p>
        <ul className="space-y-0.5">
          {NAV.map(({ to, icon: Icon, label, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => cn(
                  'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-dna-500/15 text-dna-400 shadow-glow-purple/5'
                    : 'text-gray-400 hover:text-white hover:bg-bg-elevated'
                )}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={16} className={cn('shrink-0', isActive ? 'text-dna-400' : 'text-gray-500 group-hover:text-gray-300')} />
                    <span className="flex-1">{label}</span>
                    {isActive && <ChevronRight size={12} className="text-dna-500 shrink-0" />}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* System status footer */}
      <div className="shrink-0 p-3 border-t border-bg-border">
        <div className="rounded-xl bg-bg-elevated border border-bg-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-slow" />
            <span className="text-xs text-gray-400 font-medium">System Online</span>
          </div>
          <div className="flex items-center gap-1.5 text-2xs text-gray-600 mono">
            <Zap size={10} className="text-dna-500" />
            <span>10 file types · 6 DNA layers</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
