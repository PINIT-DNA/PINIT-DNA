'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { updateSection } from '@/lib/admin/actions/sections';
import { openLiveLanding } from '@/lib/admin/open-live';

type SectionRow = {
  id: string;
  key: string;
  index: string;
  label: string;
  title: string;
  lede: string;
  visible: boolean;
};

export function SectionsEditor({ sections }: { sections: SectionRow[] }) {
  return (
    <div className="mt-8 space-y-4">
      {sections.map((s) => (
        <SectionCard key={s.id} section={s} />
      ))}
    </div>
  );
}

function SectionCard({ section }: { section: SectionRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState(section.label);
  const [title, setTitle] = useState(section.title);
  const [lede, setLede] = useState(section.lede);
  const [visible, setVisible] = useState(section.visible);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const dirty =
    label !== section.label || title !== section.title || lede !== section.lede || visible !== section.visible;

  const save = () => {
    setError('');
    startTransition(async () => {
      const result = await updateSection(section.id, { label, title, lede, visible });
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
    <div className={`panel p-6 ${!visible ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <p className="eyebrow">
          {section.index} · {section.key}
        </p>
        <label className="flex shrink-0 cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => {
              setVisible(e.target.checked);
              setSaved(false);
            }}
            className="h-4 w-4 accent-cyan"
          />
          <span className="text-[0.8125rem] text-mute">{visible ? 'Visible' : 'Hidden'}</span>
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[0.75rem] font-medium text-mute-2">Nav label</span>
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setSaved(false);
            }}
            className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-[0.875rem] text-paper outline-none focus:border-cyan/45"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[0.75rem] font-medium text-mute-2">Title</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setSaved(false);
            }}
            className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-[0.875rem] text-paper outline-none focus:border-cyan/45"
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="mb-1.5 block text-[0.75rem] font-medium text-mute-2">Lede</span>
        <textarea
          value={lede}
          onChange={(e) => {
            setLede(e.target.value);
            setSaved(false);
          }}
          rows={2}
          className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-[0.875rem] text-paper outline-none focus:border-cyan/45"
        />
      </label>

      {error && (
        <p role="alert" className="mt-3 text-[0.8125rem] text-red-400">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] px-5 py-2 text-[0.8125rem] font-medium text-ink disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save & view live site'}
        </button>
        {saved && !dirty && (
          <span className="text-[0.8125rem] text-signal">Saved — opening live landing page…</span>
        )}
      </div>
    </div>
  );
}
