import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/tokens';
import { appSurface } from '@/lib/site';

/**
 * Dual-deploy gate:
 *   APP_SURFACE=public → hide CMS from the shareable landing host
 *   APP_SURFACE=admin  → CMS-only host; marketing routes bounce to /admin
 *   APP_SURFACE=full   → local / single-host (auth still guards /admin)
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const surface = appSurface();

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
  matcher: ['/((?!_next/static|_next/image|brand/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)'],
};
