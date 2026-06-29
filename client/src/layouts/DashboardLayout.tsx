import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Sidebar } from '../components/nav/Sidebar';
import { Topbar } from '../components/nav/Topbar';
import { MobileBottomNav } from '../components/nav/MobileBottomNav';

export function DashboardLayout() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] bg-bg-base overflow-hidden">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      {navOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0 lg:ml-60">
        <Topbar onMenu={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 pb-24 lg:pb-6 mobile-main">
          <Outlet />
        </main>
      </div>

      <MobileBottomNav onOpenMenu={() => setNavOpen(true)} />

      <Toaster
        position="top-center"
        containerClassName="!top-14 lg:!top-auto lg:!bottom-4"
        toastOptions={{
          style: {
            background: '#0f1623',
            color: '#f1f5f9',
            border: '1px solid #1e293b',
            borderRadius: '12px',
            fontSize: '13px',
            maxWidth: 'min(100vw - 24px, 360px)',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#0f1623' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#0f1623' } },
        }}
      />
    </div>
  );
}
