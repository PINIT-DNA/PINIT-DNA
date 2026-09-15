import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { superAdminRoutes } from './admin/routes';
import { SsoLandingPage } from './pages/SsoLandingPage';
import { SessionExpiredPage } from './pages/SessionExpiredPage';
import { AccessDeniedPage } from './pages/AccessDeniedPage';

const router = createBrowserRouter([
  { path: '/sso', element: <SsoLandingPage /> },
  { path: '/session-expired', element: <SessionExpiredPage /> },
  { path: '/access-denied', element: <AccessDeniedPage /> },
  superAdminRoutes,
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
