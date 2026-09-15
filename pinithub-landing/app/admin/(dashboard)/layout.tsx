import { AdminShell } from '@/components/admin/AdminShell';
import { requireUser } from '@/lib/auth/server';

/**
 * Every route under this group re-checks the session against the database —
 * the edge middleware already blocked unauthenticated requests, but it does
 * no I/O, so a deactivated account or a demoted role only takes effect here.
 */
export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser('EDITOR');
  return <AdminShell user={user}>{children}</AdminShell>;
}
