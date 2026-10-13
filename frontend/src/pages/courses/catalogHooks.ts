import type { Batch, Category, ChargeItem, Course, FeePlan } from '../../data/types';
import { useWrite, type WriteResult } from '../../data/useWrite';
import { num } from '../../lib/values';

export type CatalogTab = 'Categories' | 'Courses' | 'Batches' | 'FeePlans' | 'ChargeItems';
type CatalogRow = Category | Course | Batch | FeePlan | ChargeItem;

export function useCatalogSave() {
  return useWrite<{ tab: CatalogTab; row: Partial<CatalogRow> & Record<string, unknown> }, WriteResult>('catalog.save');
}

export function useCatalogDelete() {
  return useWrite<{ tab: CatalogTab; id: string }, WriteResult>('catalog.delete');
}

export function bySortOrder<T extends { sort_order?: unknown; name: string }>(a: T, b: T) {
  return num(a.sort_order, 9999) - num(b.sort_order, 9999) || a.name.localeCompare(b.name);
}
