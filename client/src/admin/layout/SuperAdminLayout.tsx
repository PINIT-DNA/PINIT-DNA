import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { SuperAdminSidebar } from './SuperAdminSidebar';

export function SuperAdminLayout() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] bg-[#09090b] text-zinc-100 overflow-hidden">
      <SuperAdminSidebar open={navOpen} onClose={() => setNavOpen(false)} />

      {navOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden lg:ml-64">
        <header className="h-14 shrink-0 border-b border-zinc-800 bg-[#0c0c0e] flex items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="lg:hidden p-2 -ml-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Open admin menu"
          >
            <Menu size={20} />
          </button>
          <p className="text-sm text-zinc-400 min-w-0 truncate">
            Enterprise Control Center — <span className="text-zinc-200">Global visibility</span>
          </p>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 mobile-main">
          <Outlet />
        </main>
      </div>

      <Toaster
        position="top-center"
        containerClassName="!top-14 lg:!top-auto lg:!top-4 lg:!right-4"
        toastOptions={{
          style: {
            background: '#18181b',
            color: '#fafafa',
            border: '1px solid #3f3f46',
            maxWidth: 'min(100vw - 24px, 360px)',
          },
        }}
      />
    </div>
  );
}
