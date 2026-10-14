import { describe, expect, it } from 'vitest';
import { fromSnapshot } from './merge';
import { beginSave, carryPending, dropStalePending, endSave, newId } from './pending';
import { CORE_TABS, type CoreSnapshot } from './types';

function data(expenses: unknown[]) {
  const base = Object.fromEntries(CORE_TABS.map((t) => [t, []]));
  return fromSnapshot({ ...base, Expenses: expenses, settings: {}, serverTime: 'T' } as unknown as CoreSnapshot);
}

describe('pending rows', () => {
  it('makes ids in the server format', () => {
    expect(newId('STU')).toMatch(/^STU-[a-z0-9]{6,12}-[a-z0-9]{6}$/);
    expect(newId('PAR')).not.toBe(newId('PAR'));
  });

  it('drops pending rows whose save is no longer running and keeps the rest', () => {
    const d = data([{ id: 'EXP-1' }, { id: 'TMP-a', _pending: true }, { id: 'TMP-b', _pending: true }]);
    beginSave(['TMP-b']);
    expect(dropStalePending(d).tables.Expenses.map((e) => e.id)).toEqual(['EXP-1', 'TMP-b']);
    endSave(['TMP-b']);
    expect(dropStalePending(d).tables.Expenses.map((e) => e.id)).toEqual(['EXP-1']);
    const clean = data([{ id: 'EXP-1' }]);
    expect(dropStalePending(clean)).toBe(clean);
  });

  it('carries running saves into a freshly loaded copy', () => {
    const old = data([{ id: 'TMP-c', _pending: true }]);
    const fresh = data([{ id: 'EXP-2' }]);
    expect(carryPending(old, fresh)).toBe(fresh);
    beginSave(['TMP-c']);
    expect(carryPending(old, fresh).tables.Expenses.map((e) => e.id)).toEqual(['EXP-2', 'TMP-c']);
    endSave(['TMP-c']);
  });
});
