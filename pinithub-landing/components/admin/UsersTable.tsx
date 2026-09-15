'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteUser, resetUserPassword, setUserActive, updateUserRole } from '@/lib/admin/actions/users';
import { ROLES, ROLE_LABELS } from '@/lib/auth/roles';
import type { ActionResult } from '@/lib/admin/types';

type UserRow = { id: string; email: string; name: string; role: string; active: boolean; lastLoginAt: string };

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[720px] text-left text-[0.8125rem]">
        <thead className="border-b border-line bg-ink-2/60 text-mute-2">
          <tr>
            <th className="px-4 py-3 font-medium">User</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Last sign-in</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <UserRowItem key={u.id} user={u} isSelf={u.id === currentUserId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRowItem({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const run = (fn: () => Promise<ActionResult>) => {
    setError('');
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const changeRole = (role: string) => run(() => updateUserRole(user.id, role));
  const toggleActive = () => run(() => setUserActive(user.id, !user.active));
  const remove = () => {
    if (!confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    run(() => deleteUser(user.id));
  };
  const resetPassword = () => {
    const password = prompt(`New temporary password for ${user.email} (min 8 characters):`);
    if (!password) return;
    run(() => resetUserPassword(user.id, password));
  };

  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-white/[0.02]">
      <td className="px-4 py-3">
        <p className="text-paper">{user.name}</p>
        <p className="text-mute-2">
          {user.email}
          {isSelf && ' (you)'}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-red-400">
            {error}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <select
          value={user.role}
          onChange={(e) => changeRole(e.target.value)}
          disabled={pending || (isSelf && user.role === 'OWNER')}
          className="rounded-lg border border-line bg-ink px-2.5 py-1.5 text-[0.8125rem] text-paper outline-none disabled:opacity-50"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-mute-2">{user.lastLoginAt}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-block rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium ${
            user.active ? 'border-signal/40 bg-signal/10 text-signal' : 'border-line text-mute-2'
          }`}
        >
          {user.active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={resetPassword}
          disabled={pending}
          className="mr-3 text-mute-2 hover:text-paper disabled:opacity-40"
        >
          Reset password
        </button>
        <button
          type="button"
          onClick={toggleActive}
          disabled={pending || isSelf}
          className="mr-3 text-mute-2 hover:text-paper disabled:opacity-40"
        >
          {user.active ? 'Deactivate' : 'Activate'}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={pending || isSelf}
          className="text-red-400/80 hover:text-red-400 disabled:opacity-40"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
