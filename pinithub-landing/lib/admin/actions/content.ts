'use server';

import { revalidatePath } from 'next/cache';
import { audit, requireUserOrNull } from '@/lib/auth/server';
import { prisma } from '@/lib/prisma';
import { refreshPublicContent } from '@/lib/revalidate-public';
import { buildData, validateRequired } from '../fields';
import { LIST_REGISTRY, SINGLETON_REGISTRY, type ListCollectionKey, type SingletonKey } from '../registry';
import type { ActionResult } from '../types';

/** Short human summary for the audit log — the title field if the config names one, else the first text-ish field. */
function summarize(fields: { key: string; kind: string }[], data: Record<string, unknown>, titleField?: string): string {
  const key = titleField ?? fields.find((f) => f.kind === 'text')?.key;
  const value = key ? data[key] : undefined;
  return typeof value === 'string' && value ? value.slice(0, 80) : '';
}

export async function createListItem(
  key: ListCollectionKey,
  values: Record<string, unknown>,
): Promise<ActionResult> {
  const user = await requireUserOrNull('EDITOR');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  const cfg = LIST_REGISTRY[key];
  if (!cfg) return { ok: false, error: 'Unknown collection.' };

  const data = buildData(cfg.fields, values);
  const invalid = validateRequired(cfg.fields, data);
  if (invalid) return { ok: false, error: invalid };

  // Exactly one Feature row may carry the full-width analytics card.
  if (key === 'features' && data.featured === true) {
    await prisma.feature.updateMany({ where: { featured: true }, data: { featured: false } });
  }

  const count = await cfg.delegate.count();
  const row = await cfg.delegate.create({ data: { ...data, order: count } });

  await audit(user, 'CREATE', key, String(row.id ?? ''), summarize(cfg.fields, data, cfg.titleField));
  const previewUrl = await refreshPublicContent();
  revalidatePath(`/admin/content/${key}`);
  return { ok: true, previewUrl };
}

export async function updateListItem(
  key: ListCollectionKey,
  id: string,
  values: Record<string, unknown>,
): Promise<ActionResult> {
  const user = await requireUserOrNull('EDITOR');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  const cfg = LIST_REGISTRY[key];
  if (!cfg) return { ok: false, error: 'Unknown collection.' };

  const data = buildData(cfg.fields, values);
  const invalid = validateRequired(cfg.fields, data);
  if (invalid) return { ok: false, error: invalid };

  if (key === 'features' && data.featured === true) {
    await prisma.feature.updateMany({ where: { featured: true, NOT: { id } }, data: { featured: false } });
  }

  await cfg.delegate.update({ where: { id }, data });

  await audit(user, 'UPDATE', key, id, summarize(cfg.fields, data, cfg.titleField));
  const previewUrl = await refreshPublicContent();
  revalidatePath(`/admin/content/${key}`);
  return { ok: true, previewUrl };
}

export async function deleteListItem(key: ListCollectionKey, id: string): Promise<ActionResult> {
  const user = await requireUserOrNull('EDITOR');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  const cfg = LIST_REGISTRY[key];
  if (!cfg) return { ok: false, error: 'Unknown collection.' };

  await cfg.delegate.delete({ where: { id } });

  await audit(user, 'DELETE', key, id, '');
  const previewUrl = await refreshPublicContent();
  revalidatePath(`/admin/content/${key}`);
  return { ok: true, previewUrl };
}

export async function moveListItem(
  key: ListCollectionKey,
  id: string,
  direction: 'up' | 'down',
): Promise<ActionResult> {
  const user = await requireUserOrNull('EDITOR');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  const cfg = LIST_REGISTRY[key];
  if (!cfg) return { ok: false, error: 'Unknown collection.' };

  const rows = (await cfg.delegate.findMany({ orderBy: { order: 'asc' } })) as {
    id: string;
    order: number;
  }[];
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) return { ok: false, error: 'Row not found — it may have already been deleted.' };

  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= rows.length) return { ok: true }; // already at the edge

  const current = rows[index]!;
  const neighbor = rows[swapWith]!;
  await cfg.delegate.update({ where: { id: current.id }, data: { order: neighbor.order } });
  await cfg.delegate.update({ where: { id: neighbor.id }, data: { order: current.order } });

  const previewUrl = await refreshPublicContent();
  revalidatePath(`/admin/content/${key}`);
  return { ok: true, previewUrl };
}

export async function updateSingleton(key: SingletonKey, values: Record<string, unknown>): Promise<ActionResult> {
  const user = await requireUserOrNull('EDITOR');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  const cfg = SINGLETON_REGISTRY[key];
  if (!cfg) return { ok: false, error: 'Unknown section.' };

  const data = buildData(cfg.fields, values);
  const invalid = validateRequired(cfg.fields, data);
  if (invalid) return { ok: false, error: invalid };

  await cfg.delegate.update({ where: { id: 1 }, data });

  await audit(user, 'UPDATE', key, '1', cfg.label);
  const previewUrl = await refreshPublicContent();
  revalidatePath(`/admin/content/${key}`);
  if (key === 'siteSettings') {
    revalidatePath('/admin/settings');
  }
  return { ok: true, previewUrl };
}
