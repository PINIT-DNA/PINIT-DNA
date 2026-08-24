import type { CurrentUser } from '@/lib/auth/server';
import { LogoutButton } from './LogoutButton';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';

export function AdminShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-ink text-paper">
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 lg:px-8">
          <MobileNav role={user.role} />
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="text-[0.8125rem] font-medium text-paper">{user.name}</p>
              <p className="eyebrow text-[0.625rem]">{user.role}</p>
            </div>
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
