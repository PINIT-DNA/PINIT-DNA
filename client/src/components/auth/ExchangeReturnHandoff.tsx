import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createExchangeSso } from '../../services/dashboard.api';
import {
  resolveExchangeReturn,
  stashExchangeReturn,
} from '../../lib/exchange-return';

/**
 * When Hub user is already authenticated and arrived from Exchange,
 * mint SSO and send them back. Query param or a fresh stash both count.
 */
export function ExchangeReturnHandoff({ fallback }: { fallback: ReactNode }) {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'checking' | 'redirecting' | 'done' | 'failed'>('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    const target = resolveExchangeReturn(searchParams.get('exchange_return'));
    if (!target) {
      setStatus('done');
      return;
    }
    stashExchangeReturn(target);

    let cancelled = false;
    (async () => {
      setStatus('redirecting');
      try {
        const sso = await createExchangeSso();
        if (cancelled) return;
        const url = new URL(target);
        url.searchParams.set('hub_sso', sso.token);
        window.location.replace(url.toString());
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not open Exchange');
          setStatus('failed');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  if (status === 'done' && !error) return <>{fallback}</>;

  return (
    <div className="pinit-auth" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {status !== 'failed' && (
        <div
          className="pa-spin"
          style={{
            width: 28,
            height: 28,
            border: '3px solid rgba(120,160,220,0.2)',
            borderTopColor: '#3b9eff',
            borderRadius: '50%',
          }}
        />
      )}
      <p style={{ color: status === 'failed' ? '#fca5a5' : 'rgba(200,220,255,0.75)', fontSize: 14 }}>
        {error || 'Opening Pinit Exchange…'}
      </p>
      {status === 'failed' && (
        <button type="button" className="pa-btn" onClick={() => window.location.reload()}>
          Try again
        </button>
      )}
    </div>
  );
}
