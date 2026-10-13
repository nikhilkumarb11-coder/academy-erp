/**
 * Read-side fee helpers over cached tables. The server (backend/core/Fees.js) owns every write;
 * these only summarise what it stored, so screens agree with receipts.
 */
import type { CoreTables, FeeDue, Payment } from '../data/types';
import { daysBetween } from './dates';
import { num } from './values';

export const isOpenDue = (d: FeeDue) => num(d.balance) > 0 && d.status !== 'Paid' && d.status !== 'Waived';
export const dueNet = (d: FeeDue) => num(d.amount_due) - num(d.discount) + num(d.adjustment);

export const byDueOrder = (a: FeeDue, b: FeeDue) =>
  String(a.due_date).localeCompare(String(b.due_date)) || String(a.created_at).localeCompare(String(b.created_at));

export type AgeBucket = '1–7 days' | '8–15 days' | '16–30 days' | '30+ days';
export const AGE_BUCKETS: AgeBucket[] = ['1–7 days', '8–15 days', '16–30 days', '30+ days'];

/** Overdue ageing (PRD §6.3); null when not yet due. */
export function ageBucket(dueDate: string, today: string): AgeBucket | null {
  const days = daysBetween(dueDate, today);
  if (days <= 0) return null;
  if (days <= 7) return '1–7 days';
  if (days <= 15) return '8–15 days';
  if (days <= 30) return '16–30 days';
  return '30+ days';
}

/** Unspent advance of a family: credit allocations of payments that are not cancelled. */
export function creditOf(t: Pick<CoreTables, 'Payments' | 'PaymentAllocations'>, parentId: string): number {
  const ok = new Set(t.Payments.filter((p) => p.parent_id === parentId && p.status === 'Recorded').map((p) => p.id));
  return t.PaymentAllocations.filter((a) => !a.due_id && ok.has(a.payment_id)).reduce((s, a) => s + num(a.amount), 0);
}

/** "Karate · Oct 2026" or the charge name. */
export function dueTitle(t: Pick<CoreTables, 'Enrollments' | 'Courses'>, due: FeeDue): { title: string; period: string } {
  if (due.kind === 'OneTime') return { title: due.period_label, period: '' };
  const enrollment = t.Enrollments.find((e) => e.id === due.enrollment_id);
  const course = t.Courses.find((c) => c.id === enrollment?.course_id);
  return { title: course?.name ?? 'Course', period: due.period_label };
}

export interface FamilySummary {
  parentId: string;
  guardian: string;
  phone: string;
  children: string[];
  outstanding: number;
  overdue: number;
  oldestDue: string | null;
  bucket: AgeBucket | null;
  credit: number;
  openDues: FeeDue[];
}

/** One row per family with money owed (or credit), most overdue first. */
export function familySummaries(t: CoreTables, today: string): FamilySummary[] {
  const open = new Map<string, FeeDue[]>();
  t.FeeDues.forEach((d) => {
    if (!isOpenDue(d)) return;
    const list = open.get(d.parent_id) ?? [];
    list.push(d);
    open.set(d.parent_id, list);
  });
  const studentsByParent = new Map<string, string[]>();
  t.Students.forEach((s) => studentsByParent.set(s.parent_id, [...(studentsByParent.get(s.parent_id) ?? []), s.name]));

  return t.Parents.map((p) => {
    const dues = (open.get(p.id) ?? []).sort(byDueOrder);
    const overdueDues = dues.filter((d) => d.due_date < today);
    const oldest = dues[0]?.due_date ?? null;
    return {
      parentId: p.id,
      guardian: p.guardian_name,
      phone: p.phone,
      children: studentsByParent.get(p.id) ?? [],
      outstanding: dues.reduce((s, d) => s + num(d.balance), 0),
      overdue: overdueDues.reduce((s, d) => s + num(d.balance), 0),
      oldestDue: oldest,
      bucket: oldest ? ageBucket(oldest, today) : null,
      credit: creditOf(t, p.id),
      openDues: dues,
    };
  })
    .filter((f) => f.outstanding > 0 || f.credit > 0)
    .sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding || a.guardian.localeCompare(b.guardian));
}

/** How the server will split a payment when no dues are chosen: oldest first, remainder as credit. */
export function previewAllocation(openDues: FeeDue[], amount: number): { due: FeeDue; amount: number }[] {
  let left = amount;
  const out: { due: FeeDue; amount: number }[] = [];
  [...openDues].sort(byDueOrder).forEach((due) => {
    if (left <= 0) return;
    const take = Math.min(left, num(due.balance));
    out.push({ due, amount: take });
    left -= take;
  });
  return out;
}

/** Money received in a date range (inclusive), excluding cancelled payments. */
export function collected(payments: Payment[], from: string, to: string): number {
  return payments.filter((p) => p.status === 'Recorded' && p.paid_at >= from && p.paid_at <= to).reduce((s, p) => s + num(p.amount), 0);
}

/** Fills {placeholders} in a message template; unknown ones are left visible so the user notices. */
export function fillTemplate(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}
