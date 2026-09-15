import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/admin/LoginForm';
import { Logo } from '@/components/ui/Logo';
import { getCurrentUser } from '@/lib/auth/server';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only ever hand the client an internal path — never let a crafted `next`
  // query param send a signed-in admin somewhere off-site.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/admin';

  // Full database-backed check, not just JWT validity — a token can be
  // well-signed but stale (password reset, deactivation, role change). Only
  // a genuinely current session skips the login form.
  const user = await getCurrentUser();
  if (user) redirect(target);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-ink px-4">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(120%_88%_at_50%_0%,#0d1c3d_0%,#070E22_42%,#050816_78%)]" />
        <div className="lattice absolute inset-0 opacity-40" />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="panel p-8">
          <h1 className="font-display text-xl font-semibold text-paper">Admin sign in</h1>
          <p className="mt-1.5 text-[0.875rem] text-mute-2">Sign in to manage PINITHUB content.</p>
          <LoginForm next={target} />
        </div>
      </div>
    </div>
  );
}
