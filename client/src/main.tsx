import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AuthProvider } from './context/AuthContext';
import { supabase, SUPABASE_PROJECT_URL } from './lib/supabase';
import './index.css';

// Verify the Supabase connection (project: kqdqmimdqecensurjplh) on startup.
// Uses the public anon key; failures are non-fatal — the app's primary data
// path is the PINIT-DNA backend API.
supabase.auth.getSession()
  .then(() => console.info('[PINIT] Supabase connected:', SUPABASE_PROJECT_URL))
  .catch((e) => console.warn('[PINIT] Supabase connectivity check failed:', e?.message ?? e));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);
