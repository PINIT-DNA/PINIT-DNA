'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { updateSingleton } from '@/lib/admin/actions/content';
import { openLiveLanding } from '@/lib/admin/open-live';
import type { FieldDef } from '@/lib/admin/fields';
import type { SingletonKey } from '@/lib/admin/registry';
import { FieldRow } from './fields/FieldInput';

/** One record, edited as a plain form — no list, no modal. */
export function SingletonForm({
  singletonKey,
  fields,
  initial,
}: {
  singletonKey: SingletonKey;
  fields: FieldDef[];
  initial: Record<string, unknown>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, unknown>>(initial);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const set = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  const save = () => {
    setError('');
    startTransition(async () => {
      const result = await updateSingleton(singletonKey, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
      openLiveLanding(result.previewUrl);
    });
  };

  return (
    <div className="max-w-2xl space-y-5">
      {fields.map((f) => (
        <FieldRow key={f.key} field={f} value={draft[f.key]} onChange={(v) => set(f.key, v)} />
      ))}

      {error && (
        <p role="alert" className="text-[0.8125rem] text-red-400">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-[0.8125rem] text-signal">Saved — opening live landing page…</p>
      )}

      <div className="flex justify-end border-t border-line pt-5">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] px-6 py-2.5 text-[0.875rem] font-medium text-ink disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save & view live site'}
        </button>
      </div>
    </div>
  );
}
