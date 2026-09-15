'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { atLeast, type Role } from '@/lib/auth/roles';
import { ADMIN_NAV } from '@/lib/admin/nav';
import { Logo } from '../ui/Logo';

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const links = ADMIN_NAV.filter((l) => atLeast(role, l.minRole));

  return (
    <nav className="hidden w-64 shrink-0 border-r border-line bg-ink-2/40 lg:flex lg:flex-col">
      <div className="border-b border-line px-6 py-5">
        <Link href="/admin">
          <Logo />
        </Link>
      </div>
      <ul className="flex-1 space-y-1 px-3 py-5">
        {links.map((l) => {
          const active = l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                className={`block rounded-lg px-3.5 py-2.5 text-[0.875rem] transition-colors ${
                  active ? 'bg-cyan/10 text-cyan' : 'text-mute-2 hover:bg-white/[0.04] hover:text-paper'
                }`}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-6 py-4">
        <a href="/" target="_blank" rel="noreferrer" className="text-[0.75rem] text-mute-2 hover:text-paper">
          ← View live site
        </a>
      </div>
    </nav>
  );
}
