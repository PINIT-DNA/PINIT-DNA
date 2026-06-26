import { useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from '../router';
import { AuthProvider } from '../context/AuthContext';
import { AppSplash } from './AppSplash';

/**
 * Root for the APK build. Shows the PINIT DNA splash once per launch, then
 * hands off to the app (auth → biometric/face login → dashboard). The web
 * build never renders this — see main.tsx.
 */
export function NativeApp() {
  const [splashDone, setSplashDone] = useState(() => {
    try {
      return sessionStorage.getItem('pinit_splash_shown') === '1';
    } catch {
      return false;
    }
  });

  if (!splashDone) {
    return (
      <AppSplash
        onDone={() => {
          try {
            sessionStorage.setItem('pinit_splash_shown', '1');
          } catch {
            /* ignore */
          }
          setSplashDone(true);
        }}
      />
    );
  }

  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
