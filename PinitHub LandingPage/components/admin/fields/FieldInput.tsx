'use client';

import type { FieldDef } from '@/lib/admin/fields';
import { ICON_NAMES, icon as resolveIcon } from '@/lib/icons';

const BASE_INPUT =
  'w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-[0.875rem] text-paper outline-none transition-colors placeholder:text-mute-2/50 focus:border-cyan/45';

/** Renders the correct control for one field, with no label — see `FieldRow` for the labeled version. */
export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (field.kind) {
    case 'text':
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={BASE_INPUT}
        />
      );
    case 'textarea':
      return (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={field.rows ?? 4}
          className={`${BASE_INPUT} resize-y`}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          value={String(value ?? 0)}
          step={field.step ?? 'any'}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)}
          className={BASE_INPUT}
        />
      );
    case 'boolean':
      return (
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-line bg-ink accent-cyan"
          />
          <span className="text-[0.8125rem] text-mute">{value ? 'Enabled' : 'Disabled'}</span>
        </label>
      );
    case 'select':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={`${BASE_INPUT} appearance-none`}
        >
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'icon': {
      const Icon = resolveIcon(String(value ?? ''));
      return (
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-ink">
            <Icon className="h-4 w-4 text-cyan" />
          </span>
          <select
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className={`${BASE_INPUT} appearance-none`}
          >
            {ICON_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case 'color':
      return (
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-9 w-9 shrink-0 rounded-lg border border-line"
            style={{ background: String(value ?? '#000000') }}
          />
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#55E6FF or rgba(...)"
            className={BASE_INPUT}
          />
        </div>
      );
    default:
      return null;
  }
}

/** A `FieldInput` with its label, required marker, and hint text. */
export function FieldRow({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const hint = 'hint' in field ? field.hint : undefined;

  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">
        {field.label}
        {'required' in field && field.required && <span className="ml-1 text-cyan/70">*</span>}
      </span>
      <FieldInput field={field} value={value} onChange={onChange} />
      {hint && field.kind !== 'boolean' && <span className="mt-1.5 block text-[0.75rem] text-mute-2/70">{hint}</span>}
    </label>
  );
}
