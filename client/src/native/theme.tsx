import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Mode = 'light' | 'dark';
interface ThemeCtx { mode: Mode; toggle: () => void; setMode: (m: Mode) => void; }

const Ctx = createContext<ThemeCtx>({ mode: 'light', toggle: () => {}, setMode: () => {} });

/** Theme for the native app — light/dark, persisted in localStorage. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return (localStorage.getItem('pinit_theme') as Mode) || 'light';
    } catch {
      return 'light';
    }
  });

  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem('pinit_theme', m); } catch { /* ignore */ }
  };
  const toggle = () => setMode(mode === 'light' ? 'dark' : 'light');

  // Keep the native status-bar / page background in sync with the theme.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#07070f' : '#f3f4fb');
  }, [mode]);

  return <Ctx.Provider value={{ mode, toggle, setMode }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
