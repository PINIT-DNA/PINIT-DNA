import { createContext, useContext, ReactNode } from 'react';
import type { AdminDomain, MyCapabilities } from '../api/super-admin.api';

const AdminCapabilitiesContext = createContext<MyCapabilities | null>(null);

export function AdminCapabilitiesProvider({
  value,
  children,
}: {
  value: MyCapabilities;
  children: ReactNode;
}) {
  return (
    <AdminCapabilitiesContext.Provider value={value}>{children}</AdminCapabilitiesContext.Provider>
  );
}

/** Current admin console user's role + capability domains. Must be used inside RequireSuperAdmin. */
export function useAdminCapabilities(): MyCapabilities {
  const ctx = useContext(AdminCapabilitiesContext);
  if (!ctx) {
    throw new Error('useAdminCapabilities must be used within AdminCapabilitiesProvider');
  }
  return ctx;
}

export function useCanAccess(domain: AdminDomain): boolean {
  const { isOwner, capabilities } = useAdminCapabilities();
  return isOwner || capabilities.includes(domain);
}
