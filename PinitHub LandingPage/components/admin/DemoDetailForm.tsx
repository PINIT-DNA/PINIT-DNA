'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteDemoRequest, updateDemoRequest } from '@/lib/admin/actions/inbox';
import { DEMO_STATUSES } from '@/lib/defaults';
import { StatusPill } from './StatusPill';

export function DemoDetailForm({ id, status, notes }: { id: string; status: string; notes: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [statusValue, setStatusValue] = useState(status);
  const [notesValue, setNotesValue] = useState(notes);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const dirty = statusValue !== status || notesValue !== notes;

  const save = () => {
    setError('');
    startTransition(async () => {
      const result = await updateDemoRequest(id, { status: statusValue, notes: notesValue });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  const remove = () => {
    if (!confirm('Delete this demo request permanently?')) return;
    startTransition(async () => {
      const result = await deleteDemoRequest(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push('/admin/inbox/demos');
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-line bg-ink-2/40 p-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Status &amp; notes</p>
        <StatusPill status={statusValue} />
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">Status</span>
        <select
          value={statusValue}
          onChange={(e) => {
            setStatusValue(e.target.value);
            setSaved(false);
          }}
          className="w-full max-w-xs rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[0.875rem] text-paper outline-none focus:border-cyan/45"
        >
          {DEMO_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">Internal notes</span>
        <textarea
          value={notesValue}
          onChange={(e) => {
            setNotesValue(e.target.value);
            setSaved(false);
          }}
          rows={4}
          placeholder="Never shown publicly."
          className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[0.875rem] text-paper outline-none focus:border-cyan/45"
        />
      </label>

      {error && (
        <p role="alert" className="mt-3 text-[0.8125rem] text-red-400">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || pending}
            className="rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] px-5 py-2 text-[0.8125rem] font-medium text-ink disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save changes'}
          </button>
          {saved && !dirty && <span className="text-[0.8125rem] text-signal">Saved.</span>}
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="text-[0.8125rem] text-red-400/80 hover:text-red-400 disabled:opacity-40"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
