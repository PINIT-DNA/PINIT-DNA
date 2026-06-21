import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ThemeProvider, useTheme } from './theme';
import { TabBar } from './TabBar';
import './app.css';

const TAB_ROUTES = ['/', '/app/dna', '/app/vault', '/app/forensics', '/app/profile'];

// Friendly titles for feature pages opened from the tabs.
const FEATURE_TITLES: Record<string, string> = {
  '/generate': 'Generate DNA', '/compare': 'DNA Compare', '/vault': 'Vault Explorer',
  '/dna-records': 'DNA Records', '/timeline': 'File Timeline', '/reports': 'Forensic Reports',
  '/certificates': 'Certificates', '/verify-certificate': 'Verify Certificate',
  '/monitoring': 'Monitoring', '/security-center': 'Security Center', '/forensic-diff': 'Difference Engine',
  '/forensic-dashboard': 'Forensic Dashboard', '/duplicate-attempts': 'Duplicate Attempts',
  '/unmask-requests': 'Unmask Requests', '/vault-integrity': 'Vault Integrity',
  '/profile': 'Profile', '/access-intelligence': 'Access Intelligence', '/verify-leaked': 'Verify Leaked File',
};

function Shell() {
  const { mode } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isTab = TAB_ROUTES.includes(pathname);
  const title = FEATURE_TITLES[pathname] ?? 'Back';

  return (
    // Feature (web) pages are light-designed → always render them on a light
    // surface so they stay readable even when the app is in dark mode.
    <div className="pinit-app" data-theme={isTab ? mode : 'light'}>
      {!isTab && (
        <div className="pa-feature-hd">
          <button onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={20} /></button>
          <span>{title}</span>
        </div>
      )}
      <div className="pa-scroll" style={!isTab ? { paddingTop: 8, background: '#f6f8fb' } : undefined}>
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}

/** Native app layout (APK only): themed scroll area + bottom tab bar. */
export function NativeShell() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}
