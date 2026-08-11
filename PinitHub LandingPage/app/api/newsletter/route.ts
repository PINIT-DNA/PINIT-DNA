import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/** Public endpoint behind the footer newsletter field. */

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200),
  source: z.string().trim().max(40).default('footer'),
});

export async function POST(request: Request) {
  const ip = clientIp(request.headers);

  const limit = rateLimit(`newsletter:${ip}`, 10, 60 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid email address.' },
      { status: 400 },
    );
  }

  const { email, source } = parsed.data;

  try {
    // Re-subscribing is not an error, and must not leak whether the address was
    // already on the list.
    await prisma.newsletterSubscriber.upsert({
      where: { email },
      create: { email, source },
      update: { active: true },
    });
  } catch (error) {
    console.error('[newsletter] failed to save —', error);
    return NextResponse.json(
      { ok: false, error: 'We could not sign you up. Please try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
