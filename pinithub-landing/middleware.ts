import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/tokens';
import { appSurface } from '@/lib/site';

/** Hub SPA origin — proxied under the same pinithub.com domain. */
const HUB_ORIGIN = (
  process.env.HUB_REWRITE_ORIGIN ||
  process.env.NEXT_PUBLIC_HUB_REWRITE_ORIGIN ||
  'https://pinit-dna.vercel.app'
).replace(/\/$/, '');

/** Exact Hub app routes (must not be handled by landing Next.js). */
const HUB_EXACT = new Set([
  '/login',
  '/register',
  '/face-auth',
  '/onboarding',
  '/business',
  '/generate',
  '/vault',
  '/vault-integrity',
  '/dna-records',
  '/reports',
  '/timeline',
  '/forensic-diff',
  '/search',
  '/monitoring',
  '/duplicate-attempts',
  '/unmask-requests',
  '/profile',
  '/upgrade',
  '/subscription',
  '/access-intelligence',
  '/unified-investigation',
  '/certificates',
  '/verify-certificate',
  '/admin-portal',
  '/pinithub-logo.png',
  '/share',
  '/help',
]);

const HUB_PREFIXES = [
  '/login/',
  '/register/',
  '/face-auth/',
  '/extension/',
  '/s/',
  '/share/',
  '/team/',
  '/onboarding/',
  '/business/',
  '/generate/',
  '/vault/',
  '/dna-records/',
  '/reports/',
  '/timeline/',
  '/forensic-diff/',
  '/search/',
  '/monitoring/',
  '/chain/',
  '/intelligence/',
  '/link-tree/',
  '/profile/',
  '/upgrade/',
  '/subscription/',
  '/access-intelligence/',
  '/pinit-hub/',
  '/link/',
  '/admin-portal/',
  '/static/',
  '/models/',
];

function isHubPath(pathname: string): boolean {
  if (HUB_EXACT.has(pathname)) return true;
  return HUB_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Dual-deploy gate + same-domain Hub proxy:
 *   APP_SURFACE=public → hide CMS from the shareable landing host
 *   APP_SURFACE=admin  → CMS-only host; marketing routes bounce to /admin
 *   APP_SURFACE=full   → local / single-host (auth still guards /admin)
 *
 * Hub paths (/login, /vault, …) rewrite to the Hub Vercel deployment so
 * www.pinithub.com/login serves Hub while / stays on Landing.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const surface = appSurface();

  // Same-domain Hub: proxy before landing routing
  if (isHubPath(pathname)) {
    const dest = new URL(`${pathname}${search}`, `${HUB_ORIGIN}/`);
    return NextResponse.rewrite(dest);
  }

  const isAdminPath =
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/api/admin');

  if (surface === 'public' && isAdminPath) {
    return new NextResponse('Not Found', { status: 404 });
  }

  if (surface === 'admin') {
    const isPublicApi =
      pathname.startsWith('/api/demo-request') ||
      pathname.startsWith('/api/newsletter') ||
      pathname.startsWith('/api/revalidate');
    if (!isAdminPath && !isPublicApi && pathname !== '/favicon.ico') {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
  }

  if (!isAdminPath) {
    return NextResponse.next();
  }

  if (pathname === '/admin/login') {
    return NextResponse.next();
  }

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    const login = new URL('/admin/login', request.url);
    if (pathname !== '/admin') login.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|brand/|.*\\.(?:jpg|jpeg|gif|svg|webp|ico)$).*)'],
};
