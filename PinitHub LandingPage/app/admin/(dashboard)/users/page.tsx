import { CreateUserForm } from '@/components/admin/CreateUserForm';
import { UsersTable } from '@/components/admin/UsersTable';
import { requireUser } from '@/lib/auth/server';
import { prisma } from '@/lib/prisma';

export default async function AdminUsersPage() {
  const me = await requireUser('OWNER');
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-paper">Users</h1>
      <p className="mt-1.5 text-[0.9375rem] text-mute-2">Owner, admin, and editor accounts for the admin panel.</p>

      <div className="mt-8">
        <CreateUserForm />
      </div>

      <div className="mt-8">
        <UsersTable
          currentUserId={me.id}
          users={users.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name ?? u.email,
            role: u.role,
            active: u.active,
            lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toLocaleString() : 'Never',
          }))}
        />
      </div>
    </div>
  );
}
