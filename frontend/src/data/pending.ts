import { useSyncExternalStore } from 'react';
import { CORE_TABS, type CoreData, type CoreTables } from './types';

/** Ids of rows shown before their save finished; cleared when the server answers. */
const inflight = new Set<string>();
let saves = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (saves > 0) e.preventDefault();
  });
}

export function beginSave(ids: string[]) {
  ids.forEach((id) => inflight.add(id));
  saves += 1;
  notify();
}

export function endSave(ids: string[]) {
  ids.forEach((id) => inflight.delete(id));
  saves = Math.max(0, saves - 1);
  notify();
}

/** Number of saves still running in the background. */
export function usePendingSaves() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => saves,
  );
}

let seq = 0;
/** Id in the server's format (PREFIX-time-random), so a row can keep it once saved. */
export function newId(prefix: string) {
  seq = (seq + 1) % 1296;
  const rand = (crypto.getRandomValues(new Uint32Array(1))[0].toString(36) + seq.toString(36)).slice(0, 6).padEnd(6, '0');
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export const tempId = () => newId('TMP');

/** Copies rows whose save is still running from one cache version into a freshly loaded one. */
export function carryPending(from: CoreData | undefined, to: CoreData): CoreData {
  if (!from || !inflight.size) return to;
  let tables: CoreTables | null = null;
  CORE_TABS.forEach((tab) => {
    const pending = (from.tables[tab] as { id: string; _pending?: boolean }[]).filter((r) => r._pending && inflight.has(r.id));
    if (!pending.length) return;
    tables = tables ?? { ...to.tables };
    const ids = new Set(pending.map((r) => r.id));
    (tables as unknown as Record<string, unknown[]>)[tab] = [...(to.tables[tab] as { id: string }[]).filter((r) => !ids.has(r.id)), ...pending];
  });
  return tables ? { ...to, tables } : to;
}

/**
 * Removes rows left pending by a save that never finished (app closed mid-save).
 * Returns the same object when there is nothing to remove.
 */
export function dropStalePending(data: CoreData): CoreData {
  let tables: CoreTables | null = null;
  CORE_TABS.forEach((tab) => {
    const rows = data.tables[tab] as { id: string; _pending?: boolean }[];
    if (!rows.some((r) => r._pending && !inflight.has(r.id))) return;
    tables = tables ?? { ...data.tables };
    (tables as unknown as Record<string, unknown[]>)[tab] = rows.filter((r) => !r._pending || inflight.has(r.id));
  });
  return tables ? { ...data, tables } : data;
}
