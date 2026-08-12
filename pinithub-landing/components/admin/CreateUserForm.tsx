'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { createUser } from '@/lib/admin/actions/users';
import { ROLES, ROLE_LABELS } from '@/lib/auth/roles';

const EMPTY = { email: '', name: '', role: 'EDITOR', password: '' };

export function CreateUserForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    startTransition(async () => {
      const result = await createUser(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setValues(EMPTY);
      setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] px-5 py-2.5 text-[0.875rem] font-medium text-ink transition-transform hover:scale-[1.02] active:scale-95"
      >
        + New user
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="panel max-w-xl space-y-4 p-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">Email</span>
          <input
            type="email"
            required
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[0.875rem] text-paper outline-none focus:border-cyan/45"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">Name</span>
          <input
            type="text"
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[0.875rem] text-paper outline-none focus:border-cyan/45"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">Role</span>
          <select
            value={values.role}
            onChange={(e) => setValues((v) => ({ ...v, role: e.target.value }))}
            className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[0.875rem] text-paper outline-none focus:border-cyan/45"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">Temporary password</span>
          <input
            type="text"
            required
            minLength={8}
            value={values.password}
            onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[0.875rem] text-paper outline-none focus:border-cyan/45"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-[0.8125rem] text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-4 py-2 text-[0.875rem] text-mute-2 hover:text-paper"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] px-5 py-2 text-[0.875rem] font-medium text-ink disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </form>
  );
}
