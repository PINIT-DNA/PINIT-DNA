import { Outlet } from 'react-router-dom';
import { AssetQuotaBanner } from './AssetQuotaBanner';

/** Layout wrapper — shows asset quota banner; no forced upgrade redirects. */
export function PlanOnboardingGate() {
  return (
    <>
      <AssetQuotaBanner />
      <Outlet />
    </>
  );
}
