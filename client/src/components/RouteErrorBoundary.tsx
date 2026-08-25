import { useRouteError, useNavigate, isRouteErrorResponse } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

/**
 * Catches anything a route throws during render.
 *
 * Without an errorElement, React Router falls back to its own developer screen:
 * "Unexpected Application Error!" with a raw minified stack, which is what a
 * user saw in production when Vault check hit a response it did not expect.
 * A render bug should cost the page, not the whole app, and it should never
 * show a stack trace to someone who cannot act on it.
 *
 * The message is shown only in development. In production the detail goes to
 * the console for whoever is debugging, and the user gets a way out.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  // Always log — the screen deliberately withholds this in production.
  // eslint-disable-next-line no-console
  console.error('[Route error]', error);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="card max-w-md w-full text-center p-8">
        <div className="w-14 h-14 rounded-2xl bg-danger/10 border border-danger/30 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={26} className="text-danger" />
        </div>

        <h1 className="text-lg font-bold text-white mb-2">This page hit a problem</h1>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          Something went wrong loading this view. Your data is safe — nothing was
          changed. Try again, or head back to Home.
        </p>

        {import.meta.env.DEV && (
          <pre className="text-2xs text-left text-danger/80 bg-bg-elevated border border-bg-border rounded-lg p-3 mb-5 overflow-x-auto">
            {detail}
          </pre>
        )}

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn btn-primary flex-1"
          >
            <RefreshCw size={15} /> Try again
          </button>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="btn btn-secondary flex-1"
          >
            <Home size={15} /> Go Home
          </button>
        </div>
      </div>
    </div>
  );
}
