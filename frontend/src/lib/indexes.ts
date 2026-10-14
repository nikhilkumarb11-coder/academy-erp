/**
 * Lookups over cached tables, built once per table array. mergeTables keeps an unchanged table's
 * array identity, so an index lives until that table actually changes.
 */
const byIdCache = new WeakMap<readonly object[], Map<string, unknown>>();
const groupCache = new WeakMap<readonly object[], Map<string, Map<string, unknown[]>>>();

export function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  let index = byIdCache.get(rows) as Map<string, T> | undefined;
  if (!index) {
    index = new Map(rows.map((r) => [r.id, r]));
    byIdCache.set(rows, index);
  }
  return index;
}

/** Rows grouped by a column, e.g. groupBy(PaymentAllocations, 'payment_id').get(paymentId). */
export function groupBy<T extends object, K extends keyof T & string>(rows: readonly T[], key: K): Map<string, T[]> {
  let perKey = groupCache.get(rows);
  if (!perKey) {
    perKey = new Map();
    groupCache.set(rows, perKey);
  }
  let groups = perKey.get(key) as Map<string, T[]> | undefined;
  if (!groups) {
    groups = new Map();
    rows.forEach((r) => {
      const k = String(r[key] ?? '');
      const list = groups!.get(k);
      if (list) list.push(r);
      else groups!.set(k, [r]);
    });
    perKey.set(key, groups as Map<string, unknown[]>);
  }
  return groups;
}
