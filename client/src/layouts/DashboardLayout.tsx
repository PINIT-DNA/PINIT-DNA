import { Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Sidebar } from '../components/nav/Sidebar';
import { Topbar } from '../components/nav/Topbar';

export function DashboardLayout() {
  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar />

      {/* Main content area — offset by sidebar width */}
      <div className="flex-1 flex flex-col overflow-hidden ml-60">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
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
