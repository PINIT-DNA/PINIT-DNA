'use server';

import { audit, requireUserOrNull } from '@/lib/auth/server';
import { prisma } from '@/lib/prisma';
import { refreshPublicContent } from '@/lib/revalidate-public';
import type { ActionResult } from '../types';

/**
 * Section chrome only — not a full collection editor, because `order` here is
 * cosmetic: `app/page.tsx` renders sections in a fixed, hardcoded sequence, so
 * reordering rows in this table would silently do nothing. Only the fields
 * that actually affect the rendered page are editable.
 */
export async function updateSection(
  id: string,
  data: { label: string; title: string; lede: string; visible: boolean },
): Promise<ActionResult> {
  const user = await requireUserOrNull('EDITOR');
  if (!user) return { ok: false, error: 'Unauthorized.' };

  if (!data.label.trim() || !data.title.trim()) {
    return { ok: false, error: 'Label and title are required.' };
  }

  const row = await prisma.sectionMeta.update({
    where: { id },
    data: {
      label: data.label.trim(),
      title: data.title.trim(),
      lede: data.lede.trim(),
      visible: data.visible,
    },
  });

  await audit(user, 'UPDATE', 'sectionMeta', id, `${row.key} — ${row.visible ? 'visible' : 'hidden'}`);
  const previewUrl = await refreshPublicContent();
  return { ok: true, previewUrl };
}
