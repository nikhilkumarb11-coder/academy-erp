/**
 * Read-side fee helpers over cached tables. The server (backend/core/Fees.js) owns every write;
 * these only summarise what it stored, so screens agree with receipts.
 */
import type { CoreTables, FeeDue, Payment } from '../data/types';
import { daysBetween } from './dates';
import { byId } from './indexes';
import { isDeleted, num } from './values';

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
  const enrollment = byId(t.Enrollments).get(due.enrollment_id);
  const course = enrollment ? byId(t.Courses).get(enrollment.course_id) : undefined;
  return { title: course?.name ?? 'Course', period: due.period_label };
}

export interface FamilySummary {
  parentId: string;
  guardian: string;
  phone: string;
  children: string[];
  /** Course names of open dues — used by Fees search. */
  courses: string[];
  courseIds: string[];
  outstanding: number;
  overdue: number;
  oldestDue: string | null;
  bucket: AgeBucket | null;
  credit: number;
  openDues: FeeDue[];
}

/** Whether a due's billing period covers `month` ('yyyy-MM'). One-time charges use due_date's month. */
export function dueCoversMonth(due: FeeDue, month: string): boolean {
  if (due.kind === 'Recurring') {
    const start = String(due.period_start || '').slice(0, 7);
    const end = String(due.period_end || '').slice(0, 7);
    return !!start && !!end && start <= month && month <= end;
  }
  return String(due.due_date || due.period_start || '').slice(0, 7) === month;
}

export interface MonthDueRow {
  due: FeeDue;
  parentId: string;
  guardian: string;
  studentName: string;
  courseName: string;
  amountDue: number;
  paid: number;
  balance: number;
}

/** Every due (paid or not) that covers a month, optionally limited to one course. */
export function duesInMonth(t: CoreTables, month: string, courseId = ''): MonthDueRow[] {
  const students = byId(t.Students);
  const parents = byId(t.Parents);
  const enrollments = byId(t.Enrollments);
  const courses = byId(t.Courses);
  return t.FeeDues
    .filter((d) => !isDeleted(d) && d.status !== 'Waived' && dueCoversMonth(d, month))
    .map((due) => {
      const enrollment = enrollments.get(due.enrollment_id);
      const course = enrollment ? courses.get(enrollment.course_id) : undefined;
      if (courseId && enrollment?.course_id !== courseId) return null;
      const student = students.get(due.student_id);
      const parent = parents.get(due.parent_id);
      const { title } = dueTitle(t, due);
      return {
        due,
        parentId: due.parent_id,
        guardian: parent?.guardian_name ?? '',
        studentName: student?.name ?? '?',
        courseName: due.kind === 'OneTime' ? title : (course?.name ?? title),
        amountDue: dueNet(due),
        paid: num(due.amount_paid),
        balance: num(due.balance),
      };
    })
    .filter((r): r is MonthDueRow => !!r)
    .sort((a, b) => a.courseName.localeCompare(b.courseName) || a.studentName.localeCompare(b.studentName));
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

  const enrollments = byId(t.Enrollments);
  const courses = byId(t.Courses);
  return t.Parents.map((p) => {
    const dues = (open.get(p.id) ?? []).sort(byDueOrder);
    const overdueDues = dues.filter((d) => d.due_date < today);
    const oldest = dues[0]?.due_date ?? null;
    const courseNames = new Set<string>();
    const courseIds = new Set<string>();
    dues.forEach((d) => {
      const { title } = dueTitle({ Enrollments: t.Enrollments, Courses: t.Courses }, d);
      if (title) courseNames.add(title);
      const en = enrollments.get(d.enrollment_id);
      const c = en ? courses.get(en.course_id) : undefined;
      if (c?.name) courseNames.add(c.name);
      if (en?.course_id) courseIds.add(en.course_id);
    });
    return {
      parentId: p.id,
      guardian: p.guardian_name,
      phone: p.phone,
      children: studentsByParent.get(p.id) ?? [],
      courses: [...courseNames],
      courseIds: [...courseIds],
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
