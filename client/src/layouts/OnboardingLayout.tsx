import { Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { BRAND } from '../config/brand.config';
import { OnboardingCompleteGate } from '../components/onboarding/OnboardingCompleteGate';

/**
 * Isolated onboarding shell — no sidebar, topbar, notifications, or dashboard chrome.
 * Used only while account setup is incomplete (Slack / Notion / M365 pattern).
 * publicMode: pre-registration account type picker (no auth gate).
 */
export function OnboardingLayout({ publicMode = false }: { publicMode?: boolean }) {
  return (
    <div className="pinit-auth min-h-[100dvh]">
      <div className="pa-bg" aria-hidden>
        <span className="pa-orb pa-orb-a" />
        <span className="pa-orb pa-orb-b" />
        <span className="pa-grid" />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] flex-col">
        <header className="shrink-0 px-6 py-5 sm:px-10">
          <div className="pa-brand max-w-3xl mx-auto">
            <img src={BRAND.logoSrc} alt={BRAND.name} className="pa-logo-img" />
            <div>
              <div className="pa-brand-name">{BRAND.name}</div>
              <div className="pa-brand-tag">{publicMode ? 'Get started' : 'Account setup'}</div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 pb-12">
          {publicMode ? <Outlet /> : <OnboardingCompleteGate />}
        </main>
      </div>

      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: '#ffffff',
            color: '#0f172a',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            fontSize: '13px',
            maxWidth: 'min(100vw - 24px, 360px)',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#ffffff' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#ffffff' } },
        }}
      />
    </div>
  );
}
