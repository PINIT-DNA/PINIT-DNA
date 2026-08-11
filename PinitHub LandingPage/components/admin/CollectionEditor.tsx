'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createListItem, deleteListItem, moveListItem, updateListItem } from '@/lib/admin/actions/content';
import { openLiveLanding } from '@/lib/admin/open-live';
import type { FieldDef } from '@/lib/admin/fields';
import type { ListCollectionKey } from '@/lib/admin/registry';
import { FieldRow } from './fields/FieldInput';
import { Modal } from './Modal';

type Row = Record<string, unknown> & { id: string };

/**
 * Generic list editor — add / edit / delete / reorder — driven entirely by a
 * `FieldDef[]` from the registry. Every one of the ~17 list collections on the
 * landing page shares this one component instead of a hand-written page each.
 */
export function CollectionEditor({
  collectionKey,
  label,
  fields,
  defaults,
  rows,
  titleField,
}: {
  collectionKey: ListCollectionKey;
  label: string;
  fields: FieldDef[];
  defaults: Record<string, unknown>;
  rows: Row[];
  titleField?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const openCreate = () => {
    setDraft({ ...defaults });
    setError('');
    setEditing('new');
  };
  const openEdit = (row: Row) => {
    setDraft({ ...row });
    setError('');
    setEditing(row);
  };
  const close = () => {
    setEditing(null);
    setError('');
  };

  const save = () => {
    setError('');
    startTransition(async () => {
      const result =
        editing === 'new'
          ? await createListItem(collectionKey, draft)
          : await updateListItem(collectionKey, (editing as Row).id, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      router.refresh();
      openLiveLanding(result.previewUrl);
    });
  };

  const remove = (row: Row) => {
    if (!confirm(`Delete this ${label.toLowerCase()} entry? This cannot be undone.`)) return;
    setBusyId(row.id);
    startTransition(async () => {
      const result = await deleteListItem(collectionKey, row.id);
      setBusyId(null);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      router.refresh();
    });
  };

  const move = (row: Row, direction: 'up' | 'down') => {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await moveListItem(collectionKey, row.id, direction);
      setBusyId(null);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      router.refresh();
    });
  };

  const titleOf = (row: Row) => {
    const key = titleField ?? fields.find((f) => f.kind === 'text')?.key;
    const value = key ? row[key] : undefined;
    return typeof value === 'string' && value ? value : '(untitled)';
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-[0.8125rem] text-mute-2">
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] px-4 py-2 text-[0.8125rem] font-medium text-ink transition-transform hover:scale-[1.02] active:scale-95"
        >
          + Add row
        </button>
      </div>

      <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {rows.length === 0 && <li className="px-5 py-8 text-center text-[0.875rem] text-mute-2">No rows yet.</li>}
        {rows.map((row, i) => {
          const rowBusy = busyId === row.id && pending;
          return (
            <li key={row.id} className="flex items-center gap-3 bg-ink-2/40 px-4 py-3">
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  disabled={i === 0 || rowBusy}
                  onClick={() => move(row, 'up')}
                  aria-label="Move up"
                  className="grid h-5 w-5 place-items-center text-mute-2 hover:text-paper disabled:opacity-25"
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={i === rows.length - 1 || rowBusy}
                  onClick={() => move(row, 'down')}
                  aria-label="Move down"
                  className="grid h-5 w-5 place-items-center text-mute-2 hover:text-paper disabled:opacity-25"
                >
                  ▼
                </button>
              </div>
              <button
                type="button"
                onClick={() => openEdit(row)}
                className="min-w-0 flex-1 truncate text-left text-[0.9375rem] text-paper hover:text-cyan"
              >
                {titleOf(row)}
              </button>
              <button
                type="button"
                onClick={() => openEdit(row)}
                className="shrink-0 text-[0.8125rem] text-mute-2 hover:text-paper"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => remove(row)}
                disabled={rowBusy}
                className="shrink-0 text-[0.8125rem] text-red-400/80 hover:text-red-400 disabled:opacity-40"
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>

      {editing !== null && (
        <Modal title={editing === 'new' ? `New ${label} row` : `Edit ${label} row`} onClose={close}>
          <div className="space-y-4">
            {fields.map((f) => (
              <FieldRow
                key={f.key}
                field={f}
                value={draft[f.key]}
                onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              />
            ))}
            {error && (
              <p role="alert" className="text-[0.8125rem] text-red-400">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3 border-t border-line pt-4">
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 text-[0.875rem] text-mute-2 hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] px-5 py-2 text-[0.875rem] font-medium text-ink disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Save & view live site'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
