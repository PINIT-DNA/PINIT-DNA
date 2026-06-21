import { Outlet } from 'react-router-dom';
import { ThemeProvider, useTheme } from './theme';
import { TabBar } from './TabBar';
import './app.css';

function Shell() {
  const { mode } = useTheme();
  return (
    <div className="pinit-app" data-theme={mode}>
      <div className="pa-scroll">
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
