import { CORE_TABS, type CoreData, type CoreSnapshot, type CoreTables } from './types';
import { isDeleted } from '../lib/values';

/** Rows changed by a write, keyed by tab: { Students: [...], Enrollments: [...] }. */
export type Changes = Partial<Record<string, { id: string; deleted?: unknown }[]>>;

export function fromSnapshot(snapshot: CoreSnapshot): CoreData {
  const tables = {} as CoreTables;
  CORE_TABS.forEach((tab) => {
    (tables as unknown as Record<string, unknown[]>)[tab] = (snapshot[tab] ?? []).filter((r) => !isDeleted(r));
  });
  return { tables, settings: snapshot.settings ?? {}, syncedAt: snapshot.serverTime };
}

/**
 * Replaces changed rows by id and removes soft-deleted ones. Tables without changes keep
 * their identity so React components reading them do not re-render.
 */
export function mergeTables(current: CoreTables, changes: Changes): CoreTables {
  let changed = false;
  const tables = { ...current };

  CORE_TABS.forEach((tab) => {
    const rows = changes[tab] ?? [];
    if (!rows.length) return;
    changed = true;
    const byId = new Map(((current[tab] ?? []) as { id: string }[]).map((r) => [r.id, r]));
    rows.forEach((r) => {
      if (isDeleted(r)) byId.delete(r.id);
      else byId.set(r.id, r);
    });
    (tables as unknown as Record<string, unknown[]>)[tab] = [...byId.values()];
  });

  return changed ? tables : current;
}

/** Applies a sync delta (rows changed since the last sync) to cached data. */
export function applyDelta(current: CoreData, delta: CoreSnapshot): CoreData {
  const settingsChanged = JSON.stringify(delta.settings ?? {}) !== JSON.stringify(current.settings);
  return {
    tables: mergeTables(current.tables, delta as unknown as Changes),
    settings: settingsChanged ? delta.settings ?? current.settings : current.settings,
    syncedAt: delta.serverTime,
  };
}

/** Applies the rows returned by a write. Leaves syncedAt alone so the next sync still fetches other devices' edits. */
export function applyChanges(current: CoreData, changes: Changes): CoreData {
  const tables = mergeTables(current.tables, changes);
  return tables === current.tables ? current : { ...current, tables };
}
