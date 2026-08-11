import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { CONTENT_TAG } from '@/lib/content';

/**
 * On-demand cache bust for the public landing deploy.
 *
 * Admin runs on a separate Vercel project, so `revalidateTag` there only clears
 * that project's cache. After every CMS write, admin POSTs here with a shared
 * secret so the landing host refreshes `site-content` immediately.
 */
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'REVALIDATE_SECRET is not configured on this host.' },
      { status: 503 },
    );
  }

  let body: { secret?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 });
  }

  if (body.secret !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  revalidateTag(CONTENT_TAG);
  revalidatePath('/', 'layout');

  return NextResponse.json({ ok: true, revalidated: true, tag: CONTENT_TAG });
}
