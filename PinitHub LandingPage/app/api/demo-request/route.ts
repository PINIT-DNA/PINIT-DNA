import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEMO_COUNTRIES, DEMO_INDUSTRIES, DEMO_SIZES, DEMO_TIMES } from '@/lib/defaults';
import { prisma } from '@/lib/prisma';
import { clientIp, rateLimit } from '@/lib/rate-limit';

/**
 * Public endpoint behind the "Book a live demo" form.
 *
 * The option lists are validated against `lib/defaults.ts` rather than accepted
 * as free text, so the admin inbox never has to display something the form
 * could not have produced. Anything that fails validation is rejected with a
 * field map the client renders inline.
 */

const schema = z.object({
  name: z.string().trim().min(1, 'This field is required.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid business email.').max(200),
  company: z.string().trim().min(1, 'This field is required.').max(160),
  phone: z.string().trim().max(40).default(''),
  title: z.string().trim().min(1, 'This field is required.').max(120),
  country: z.enum(DEMO_COUNTRIES as [string, ...string[]], { message: 'Select your country.' }),
  size: z.enum(DEMO_SIZES as [string, ...string[]], { message: 'Select an organization size.' }),
  industry: z.enum(DEMO_INDUSTRIES as [string, ...string[]], { message: 'Select your industry.' }),
  // Calendar dates only; the form pins this to today or later.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.'),
  time: z.enum(DEMO_TIMES as [string, ...string[]], { message: 'Choose a preferred time.' }),
  message: z.string().trim().max(4000).default(''),
  consent: z.literal(true, { message: 'Please accept the Privacy Policy to continue.' }),
});

export async function POST(request: Request) {
  const ip = clientIp(request.headers);

  // Booking a demo is a deliberate act; five an hour from one host is plenty.
  const limit = rateLimit(`demo:${ip}`, 5, 60 * 60_000);
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
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fields[key]) fields[key] = issue.message;
    }
    return NextResponse.json({ ok: false, error: 'Please check the form.', fields }, { status: 400 });
  }

  const { consent: _consent, ...data } = parsed.data;

  // The date input on the client is pinned to today or later, but that is only
  // a UI hint — a client can send anything, so the past is rejected here too.
  const todayIso = new Date().toISOString().slice(0, 10);
  if (data.date < todayIso) {
    return NextResponse.json(
      { ok: false, error: 'Please check the form.', fields: { date: 'Choose today or a later date.' } },
      { status: 400 },
    );
  }

  try {
    // Two people cannot hold the same slot. REJECTED bookings free the slot
    // back up; every other status (including COMPLETED — a slot that has
    // already happened) keeps it held so a stale request can't be re-booked
    // over a session that already ran. The check and the write share a
    // transaction so a second request racing in cannot slip between them.
    await prisma.$transaction(
      async (tx) => {
        const conflict = await tx.demoRequest.findFirst({
          where: { date: data.date, time: data.time, status: { not: 'REJECTED' } },
          select: { id: true },
        });
        if (conflict) {
          throw new SlotTakenError();
        }
        await tx.demoRequest.create({ data });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Please check the form.',
          fields: { time: 'This time slot on this date is already booked. Please choose another.' },
        },
        { status: 409 },
      );
    }
    console.error('[demo-request] failed to save —', error);
    return NextResponse.json(
      { ok: false, error: 'We could not save your request. Please try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

class SlotTakenError extends Error {}
