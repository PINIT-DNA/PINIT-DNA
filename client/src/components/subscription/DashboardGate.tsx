import { Outlet } from 'react-router-dom';
import { AssetQuotaBanner } from './AssetQuotaBanner';

/** Dashboard content gate — asset quota banner only (onboarding handled outside DashboardLayout). */
export function DashboardGate() {
  return (
    <>
      <AssetQuotaBanner />
      <Outlet />
    </>
  );
}
