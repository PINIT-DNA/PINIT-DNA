'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { logoutAction } from '@/lib/admin/actions/auth';

export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await logoutAction();
          router.push('/admin/login');
          router.refresh();
        });
      }}
      className="rounded-full border border-line px-4 py-2 text-[0.8125rem] text-mute-2 transition-colors hover:border-red-400/40 hover:text-red-400 disabled:opacity-50"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
