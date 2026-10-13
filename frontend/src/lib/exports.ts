/**
 * Spreadsheet-friendly exports of every list (PRD §6.10): names instead of ids, plain numbers for money,
 * phones formatted with spaces so Excel keeps them as text.
 */
import type { CoreTables, Settings } from '../data/types';
import { downloadCsv } from './finance';
import { creditOf, dueTitle, isOpenDue } from './ledger';
import { formatPhone } from './phone';
import { bool, num } from './values';

type Cell = string | number;

export interface ExportDef {
  id: string;
  label: string;
  rows: (t: CoreTables, settings: Settings) => Cell[][];
}

const OPEN = new Set(['Active', 'On hold']);

function lookups(t: CoreTables, settings: Settings) {
  const cc = settings.country_code || '91';
  const parents = new Map(t.Parents.map((p) => [p.id, p]));
  const students = new Map(t.Students.map((s) => [s.id, s]));
  const courses = new Map(t.Courses.map((c) => [c.id, c]));
  const outstandingByParent = new Map<string, number>();
  const outstandingByStudent = new Map<string, number>();
  t.FeeDues.filter(isOpenDue).forEach((d) => {
    outstandingByParent.set(d.parent_id, (outstandingByParent.get(d.parent_id) ?? 0) + num(d.balance));
    outstandingByStudent.set(d.student_id, (outstandingByStudent.get(d.student_id) ?? 0) + num(d.balance));
  });
  return {
    phone: (p: string) => (p ? formatPhone(p, cc) : ''),
    parents,
    students,
    courses,
    outstandingByParent,
    outstandingByStudent,
  };
}

export const EXPORTS: ExportDef[] = [
  {
    id: 'students',
    label: 'Students',
    rows: (t, settings) => {
      const l = lookups(t, settings);
      return [
        ['Student ID', 'Student', 'Class', 'Date of birth', 'Gender', 'Join date', 'Status', 'Courses', 'Guardian', 'Phone', 'Outstanding'],
        ...[...t.Students].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
          const p = l.parents.get(s.parent_id);
          const courses = t.Enrollments.filter((e) => e.student_id === s.id && OPEN.has(e.status)).map((e) => l.courses.get(e.course_id)?.name ?? '');
          return [s.id, s.name, s.class, s.dob, s.gender, s.join_date, s.status, courses.join('; '), p?.guardian_name ?? '', l.phone(p?.phone ?? ''), l.outstandingByStudent.get(s.id) ?? 0];
        }),
      ];
    },
  },
  {
    id: 'families',
    label: 'Families',
    rows: (t, settings) => {
      const l = lookups(t, settings);
      return [
        ['Guardian', 'Phone', 'Alternate phone', 'Email', 'Address', 'Children', 'Outstanding', 'Advance'],
        ...[...t.Parents].sort((a, b) => a.guardian_name.localeCompare(b.guardian_name)).map((p) => [
          p.guardian_name, l.phone(p.phone), l.phone(p.alt_phone), p.email, p.address,
          t.Students.filter((s) => s.parent_id === p.id).map((s) => s.name).join('; '),
          l.outstandingByParent.get(p.id) ?? 0, creditOf(t, p.id),
        ]),
      ];
    },
  },
  {
    id: 'enrolments',
    label: 'Enrolments',
    rows: (t, settings) => {
      const l = lookups(t, settings);
      const plans = new Map(t.FeePlans.map((p) => [p.id, p.name]));
      const batches = new Map(t.Batches.map((b) => [b.id, b.name]));
      return [
        ['Student', 'Course', 'Batch', 'Fee plan', 'Monthly fee', 'Start date', 'End date', 'Status', 'Discount note'],
        ...t.Enrollments.map((e) => {
          const course = l.courses.get(e.course_id);
          const fee = e.monthly_fee_override !== '' ? num(e.monthly_fee_override) : course && course.monthly_fee !== '' ? num(course.monthly_fee) : '';
          return [l.students.get(e.student_id)?.name ?? '', course?.name ?? '', batches.get(e.batch_id) ?? '', plans.get(e.fee_plan_id) ?? '', fee, e.start_date, e.end_date, e.status, e.discount_note];
        }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ];
    },
  },
  {
    id: 'dues',
    label: 'Fee dues',
    rows: (t, settings) => {
      const l = lookups(t, settings);
      return [
        ['Due date', 'Student', 'Guardian', 'Phone', 'Item', 'Period', 'Amount', 'Discount', 'Adjustment', 'Paid', 'Balance', 'Status'],
        ...[...t.FeeDues].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).map((d) => {
          const p = l.parents.get(d.parent_id);
          const { title, period } = dueTitle(t, d);
          return [d.due_date, l.students.get(d.student_id)?.name ?? '', p?.guardian_name ?? '', l.phone(p?.phone ?? ''), title, period,
            num(d.amount_due), num(d.discount), num(d.adjustment), num(d.amount_paid), num(d.balance), d.status];
        }),
      ];
    },
  },
  {
    id: 'payments',
    label: 'Payments',
    rows: (t, settings) => {
      const l = lookups(t, settings);
      return [
        ['Date', 'Receipt no', 'Guardian', 'Phone', 'Amount', 'Mode', 'Status', 'Gateway payment id', 'Notes', 'Cancel reason'],
        ...[...t.Payments].sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at))).map((p) => {
          const parent = l.parents.get(p.parent_id);
          return [String(p.paid_at).slice(0, 10), p.receipt_no, parent?.guardian_name ?? '', l.phone(parent?.phone ?? ''), num(p.amount), p.mode, p.status, p.gateway_payment_id, p.notes, p.cancel_reason];
        }),
      ];
    },
  },
  {
    id: 'expenses',
    label: 'Expenses',
    rows: (t) => {
      const cats = new Map(t.ExpenseCategories.map((c) => [c.id, c.name]));
      return [
        ['Date', 'Category', 'Payee', 'Amount', 'Mode', 'Source', 'Notes'],
        ...[...t.Expenses].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, cats.get(e.category_id) ?? '', e.payee, num(e.amount), e.mode, e.source, e.notes]),
      ];
    },
  },
  {
    id: 'enquiries',
    label: 'Enquiries',
    rows: (t, settings) => {
      const l = lookups(t, settings);
      return [
        ['Enquiry date', 'Name', 'Phone', 'Courses', 'Source', 'Status', 'Next follow-up', 'Trial date', 'Lost reason', 'Notes'],
        ...[...t.Enquiries].sort((a, b) => a.enquiry_date.localeCompare(b.enquiry_date)).map((q) => [
          q.enquiry_date, q.name, l.phone(q.phone),
          q.course_interested.split(',').map((id) => l.courses.get(id.trim())?.name ?? '').filter(Boolean).join('; '),
          q.source, q.status, q.next_followup_date, q.trial_date, q.lost_reason, q.notes,
        ]),
      ];
    },
  },
  {
    id: 'courses',
    label: 'Courses',
    rows: (t) => {
      const cats = new Map(t.Categories.map((c) => [c.id, c.name]));
      return [
        ['Category', 'Course', 'Monthly fee', 'Classes per week', 'Active', 'Active students'],
        ...t.Courses.map((c) => [
          cats.get(c.category_id) ?? '', c.name, c.monthly_fee === '' ? '' : num(c.monthly_fee), c.classes_per_week === '' ? '' : num(c.classes_per_week),
          bool(c.active) ? 'Yes' : 'No', t.Enrollments.filter((e) => e.course_id === c.id && e.status === 'Active').length,
        ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))),
      ];
    },
  },
];

export function exportList(id: string, t: CoreTables, settings: Settings, today: string) {
  const def = EXPORTS.find((e) => e.id === id);
  if (!def) throw new Error(`Unknown export ${id}`);
  downloadCsv(`${def.id}-${today}.csv`, def.rows(t, settings));
}
