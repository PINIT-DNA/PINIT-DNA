'use server';

import { revalidatePath } from 'next/cache';
import { audit, requireUserOrNull } from '@/lib/auth/server';
import { DEMO_STATUSES, type DemoStatus } from '@/lib/defaults';
import { prisma } from '@/lib/prisma';
import type { ActionResult } from '../types';

export async function updateDemoRequest(
  id: string,
  data: { status?: string; notes?: string },
): Promise<ActionResult> {
  const user = await requireUserOrNull('ADMIN');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  if (data.status !== undefined && !DEMO_STATUSES.includes(data.status as DemoStatus)) {
    return { ok: false, error: 'Invalid status.' };
  }

  const row = await prisma.demoRequest.update({
    where: { id },
    data: {
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
  });

  await audit(user, 'STATUS', 'demoRequest', id, `${row.name} — ${row.status}`);
  revalidatePath('/admin/inbox/demos');
  revalidatePath(`/admin/inbox/demos/${id}`);
  return { ok: true };
}

export async function deleteDemoRequest(id: string): Promise<ActionResult> {
  const user = await requireUserOrNull('ADMIN');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  const row = await prisma.demoRequest.delete({ where: { id } });

  await audit(user, 'DELETE', 'demoRequest', id, `${row.name} <${row.email}>`);
  revalidatePath('/admin/inbox/demos');
  return { ok: true };
}

export async function setSubscriberActive(id: string, active: boolean): Promise<ActionResult> {
  const user = await requireUserOrNull('ADMIN');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  const row = await prisma.newsletterSubscriber.update({ where: { id }, data: { active } });

  await audit(user, 'STATUS', 'newsletterSubscriber', id, `${row.email} — ${active ? 'active' : 'inactive'}`);
  revalidatePath('/admin/inbox/newsletter');
  return { ok: true };
}

export async function deleteSubscriber(id: string): Promise<ActionResult> {
  const user = await requireUserOrNull('ADMIN');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  const row = await prisma.newsletterSubscriber.delete({ where: { id } });

  await audit(user, 'DELETE', 'newsletterSubscriber', id, row.email);
  revalidatePath('/admin/inbox/newsletter');
  return { ok: true };
}
