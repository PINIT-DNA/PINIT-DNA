import { useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  resolveExchangeReturn,
  stashExchangeReturn,
} from '../../lib/exchange-return';

/**
 * Exchange return must not mint SSO from leftover Hub tokens alone.
 * Always continue to biometric login (fallback). Server-issued SSO still happens
 * after Face + PAD + Passkey via LoginFlow → createExchangeSso (requireAuth).
 */
export function ExchangeReturnHandoff({ fallback }: { fallback: ReactNode }) {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const target = resolveExchangeReturn(searchParams.get('exchange_return'));
    if (target) stashExchangeReturn(target);
  }, [searchParams]);

  return <>{fallback}</>;
}
