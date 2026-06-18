import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Sidebar } from '../components/nav/Sidebar';
import { Topbar } from '../components/nav/Topbar';

export function DashboardLayout() {
  // Mobile/APK only — drawer open state. Desktop (lg+) ignores this entirely.
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Backdrop — only when the drawer is open on small screens */}
      {navOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Main content — offset by the sidebar only from lg up */}
      <div className="flex-1 flex flex-col overflow-hidden lg:ml-60">
        <Topbar onMenu={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      {/* Toast notifications */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#0f1623',
            color: '#f1f5f9',
            border: '1px solid #1e293b',
            borderRadius: '12px',
            fontSize: '13px',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#0f1623' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#0f1623' } },
        }}
      />
    </div>
  );
}
