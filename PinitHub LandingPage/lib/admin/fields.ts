/**
 * Declarative field descriptions for the admin content editors.
 *
 * Every collection and singleton in `lib/admin/registry.ts` describes its
 * shape with these, and `components/admin/fields/FieldInput.tsx` renders the
 * matching control. Adding a new editable field to a model means adding one
 * entry here — no new form markup.
 */

export type FieldDef =
  | { key: string; label: string; kind: 'text'; required?: boolean; placeholder?: string; hint?: string }
  | { key: string; label: string; kind: 'textarea'; required?: boolean; rows?: number; hint?: string }
  | { key: string; label: string; kind: 'number'; step?: number; min?: number; max?: number; required?: boolean }
  | { key: string; label: string; kind: 'boolean'; hint?: string }
  | { key: string; label: string; kind: 'select'; options: readonly string[]; required?: boolean }
  | { key: string; label: string; kind: 'icon' }
  | { key: string; label: string; kind: 'color' };

export type FieldValue = string | number | boolean;

/** Coerce a raw form value to the type the field (and Prisma column) expects. */
export function coerceField(field: FieldDef, raw: unknown): FieldValue {
  if (field.kind === 'boolean') return raw === true || raw === 'true' || raw === 'on';
  if (field.kind === 'number') {
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
    return Number.isFinite(n) ? n : 0;
  }
  return String(raw ?? '');
}

/** Coerce every field in `values` in one pass, ready to hand to Prisma as `data`. */
export function buildData(fields: FieldDef[], values: Record<string, unknown>): Record<string, FieldValue> {
  const data: Record<string, FieldValue> = {};
  for (const field of fields) data[field.key] = coerceField(field, values[field.key]);
  return data;
}

/** First required-but-blank field, as a user-facing message — or null if the data is complete. */
export function validateRequired(fields: FieldDef[], data: Record<string, FieldValue>): string | null {
  for (const field of fields) {
    if (!('required' in field) || !field.required) continue;
    const value = data[field.key];
    if (typeof value === 'string' && value.trim() === '') return `"${field.label}" is required.`;
  }
  return null;
}
