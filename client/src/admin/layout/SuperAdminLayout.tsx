import { Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { SuperAdminSidebar } from './SuperAdminSidebar';

export function SuperAdminLayout() {
  return (
    <div className="flex h-screen bg-[#09090b] text-zinc-100 overflow-hidden">
      <SuperAdminSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 shrink-0 border-b border-zinc-800 bg-[#0c0c0e] flex items-center px-6">
          <p className="text-sm text-zinc-400">
            Enterprise Control Center — <span className="text-zinc-200">Global visibility</span>
          </p>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#18181b',
            color: '#fafafa',
            border: '1px solid #3f3f46',
          },
        }}
      />
    </div>
  );
}
