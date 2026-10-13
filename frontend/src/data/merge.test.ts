import { describe, expect, it } from 'vitest';
import { applyDelta, fromSnapshot } from './merge';
import { CORE_TABS, type CoreSnapshot } from './types';

function snapshot(partial: Partial<Record<string, unknown[]>>, serverTime = '2026-10-13T10:00:00+05:30'): CoreSnapshot {
  const base = Object.fromEntries(CORE_TABS.map((t) => [t, []]));
  return { ...base, ...partial, settings: { academy_name: 'X' }, serverTime } as unknown as CoreSnapshot;
}

const student = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, updated_at: '2026-10-13', ...extra });

describe('fromSnapshot', () => {
  it('drops soft-deleted rows and records server time', () => {
    const data = fromSnapshot(snapshot({ Students: [student('a', 'A'), student('b', 'B', { deleted: 'TRUE' })] }));
    expect(data.tables.Students.map((s) => s.id)).toEqual(['a']);
    expect(data.syncedAt).toBe('2026-10-13T10:00:00+05:30');
  });
});

describe('applyDelta', () => {
  const initial = fromSnapshot(snapshot({ Students: [student('a', 'A'), student('b', 'B')], Courses: [{ id: 'c1' }] }));

  it('updates changed rows by id and appends new ones', () => {
    const next = applyDelta(initial, snapshot({ Students: [student('b', 'B2'), student('c', 'C')] }, 'T2'));
    expect(next.tables.Students.map((s) => [s.id, s.name])).toEqual([['a', 'A'], ['b', 'B2'], ['c', 'C']]);
    expect(next.syncedAt).toBe('T2');
  });

  it('removes rows deleted on another device', () => {
    const next = applyDelta(initial, snapshot({ Students: [student('a', 'A', { deleted: true })] }));
    expect(next.tables.Students.map((s) => s.id)).toEqual(['b']);
  });

  it('keeps table identity when nothing changed, so React does not re-render', () => {
    const next = applyDelta(initial, snapshot({}, 'T3'));
    expect(next).toBe(initial);
    expect(next.syncedAt).toBe('T3');
    const { settings: _omitted, ...withoutSettings } = snapshot({}, 'T4');
    expect(applyDelta(initial, withoutSettings as CoreSnapshot)).toBe(initial);
  });

  it('is idempotent when the same rows arrive twice (inclusive since)', () => {
    const delta = snapshot({ Students: [student('b', 'B2')] });
    const once = applyDelta(initial, delta);
    const twice = applyDelta(once, delta);
    expect(twice.tables.Students).toEqual(once.tables.Students);
  });
});
