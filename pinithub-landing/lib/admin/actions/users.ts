'use server';

import { revalidatePath } from 'next/cache';
import { audit, hashPassword, requireUserOrNull } from '@/lib/auth/server';
import { isRole } from '@/lib/auth/roles';
import { prisma } from '@/lib/prisma';
import type { ActionResult } from '../types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function createUser(data: {
  email: string;
  name: string;
  role: string;
  password: string;
}): Promise<ActionResult> {
  const actor = await requireUserOrNull('OWNER');
  if (!actor) return { ok: false, error: 'Unauthorized.' };

  const email = data.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (!isRole(data.role)) return { ok: false, error: 'Invalid role.' };
  if (data.password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: 'A user with that email already exists.' };

  const user = await prisma.user.create({
    data: {
      email,
      name: data.name.trim() || email,
      role: data.role,
      passwordHash: await hashPassword(data.password),
    },
  });

  await audit(actor, 'CREATE', 'user', user.id, `${user.email} (${user.role})`);
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function updateUserRole(id: string, role: string): Promise<ActionResult> {
  const actor = await requireUserOrNull('OWNER');
  if (!actor) return { ok: false, error: 'Unauthorized.' };
  if (!isRole(role)) return { ok: false, error: 'Invalid role.' };
  if (id === actor.id && role !== 'OWNER') {
    return { ok: false, error: 'You cannot remove your own owner access.' };
  }

  const user = await prisma.user.update({ where: { id }, data: { role, tokenVersion: { increment: 1 } } });

  await audit(actor, 'UPDATE', 'user', id, `role → ${role} (${user.email})`);
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function setUserActive(id: string, active: boolean): Promise<ActionResult> {
  const actor = await requireUserOrNull('OWNER');
  if (!actor) return { ok: false, error: 'Unauthorized.' };
  if (id === actor.id && !active) return { ok: false, error: 'You cannot deactivate your own account.' };

  // Bumping tokenVersion signs the user out immediately, not just once their
  // current session token expires — matters most for the deactivate path.
  const user = await prisma.user.update({
    where: { id },
    data: { active, tokenVersion: { increment: 1 } },
  });

  await audit(actor, 'STATUS', 'user', id, `${user.email} — ${active ? 'activated' : 'deactivated'}`);
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function resetUserPassword(id: string, password: string): Promise<ActionResult> {
  const actor = await requireUserOrNull('OWNER');
  if (!actor) return { ok: false, error: 'Unauthorized.' };
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };

  const user = await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
  });

  await audit(actor, 'UPDATE', 'user', id, `password reset (${user.email})`);
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function deleteUser(id: string): Promise<ActionResult> {
  const actor = await requireUserOrNull('OWNER');
  if (!actor) return { ok: false, error: 'Unauthorized.' };
  if (id === actor.id) return { ok: false, error: 'You cannot delete your own account.' };

  const user = await prisma.user.delete({ where: { id } });

  await audit(actor, 'DELETE', 'user', id, user.email);
  revalidatePath('/admin/users');
  return { ok: true };
}
