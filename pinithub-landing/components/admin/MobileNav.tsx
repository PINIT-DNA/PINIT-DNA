'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ADMIN_NAV } from '@/lib/admin/nav';
import { atLeast, type Role } from '@/lib/auth/roles';

export function MobileNav({ role }: { role: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  const links = ADMIN_NAV.filter((l) => atLeast(role, l.minRole));
  const current =
    links.find((l) => (l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href)))?.href ??
    links[0]?.href;

  return (
    <select
      value={current}
      onChange={(e) => router.push(e.target.value)}
      aria-label="Admin navigation"
      className="rounded-lg border border-line bg-ink px-3 py-2 text-[0.8125rem] text-paper lg:hidden"
    >
      {links.map((l) => (
        <option key={l.href} value={l.href}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
