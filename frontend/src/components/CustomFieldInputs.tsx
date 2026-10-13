import { useMemo } from 'react';
import type { CustomField } from '../data/types';
import { useCoreTables } from '../data/useCoreData';
import { bool, num } from '../lib/values';
import { Field, SelectField } from './ui';

export type ExtraValues = Record<string, string>;

/** Active custom fields for an entity, in display order. */
export function useCustomFields(entity: CustomField['entity']): CustomField[] {
  const tables = useCoreTables();
  return useMemo(
    () => (tables?.CustomFields ?? []).filter((f) => f.entity === entity && bool(f.active)).sort((a, b) => num(a.sort_order) - num(b.sort_order)),
    [tables, entity],
  );
}

/** Renders inputs for tenant-defined fields (e.g. Syllabus, Current belt). Values are stored in the row's `extra` JSON. */
export function CustomFieldInputs({
  entity,
  values,
  onChange,
  errorFor,
}: {
  entity: CustomField['entity'];
  values: ExtraValues;
  onChange: (key: string, value: string) => void;
  errorFor?: (key: string) => string | undefined;
}) {
  const fields = useCustomFields(entity);
  if (!fields.length) return null;

  return (
    <>
      {fields.map((f) => {
        const label = `${f.label}${bool(f.required) ? '' : ' (optional)'}`;
        const value = values[f.key] ?? '';
        const error = errorFor?.(f.key);
        if (f.type === 'select') {
          const options = String(f.options || '').split('|').filter(Boolean);
          return (
            <SelectField key={f.id} label={label} value={value} onChange={(e) => onChange(f.key, e.target.value)} error={error}>
              <option value="">—</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </SelectField>
          );
        }
        return (
          <Field
            key={f.id}
            label={label}
            type={f.type === 'date' ? 'date' : 'text'}
            inputMode={f.type === 'number' ? 'decimal' : undefined}
            value={value}
            onChange={(e) => onChange(f.key, e.target.value)}
            error={error}
          />
        );
      })}
    </>
  );
}
