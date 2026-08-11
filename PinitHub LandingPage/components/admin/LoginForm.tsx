'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { loginAction } from '@/lib/admin/actions/auth';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    startTransition(async () => {
      const result = await loginAction(email, password);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(next);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <label className="block">
        <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[0.9375rem] text-paper outline-none transition-colors focus:border-cyan/45"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[0.9375rem] text-paper outline-none transition-colors focus:border-cyan/45"
        />
      </label>
      {error && (
        <p role="alert" className="text-[0.8125rem] text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] py-2.5 text-[0.9375rem] font-medium text-ink transition-transform hover:scale-[1.01] active:scale-95 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
