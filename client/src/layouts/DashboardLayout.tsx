import { useState } from 'react';
import { DashboardGate } from '../components/subscription/DashboardGate';
import { Toaster } from 'react-hot-toast';
import { Sidebar } from '../components/nav/Sidebar';
import { Topbar } from '../components/nav/Topbar';
import { MobileBottomNav } from '../components/nav/MobileBottomNav';

export function DashboardLayout() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] bg-transparent overflow-hidden">
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
          <DashboardGate />
        </main>
      </div>

      <MobileBottomNav onOpenMenu={() => setNavOpen(true)} />

      <Toaster
        position="top-center"
        containerClassName="!top-14 lg:!top-auto lg:!bottom-4"
        toastOptions={{
          style: {
            background: '#ffffff',
            color: '#0f172a',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            fontSize: '13px',
            maxWidth: 'min(100vw - 24px, 360px)',
            boxShadow: '0 8px 24px -8px rgba(15,23,42,0.18)',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#ffffff' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#ffffff' } },
        }}
      />
    </div>
  );
}
