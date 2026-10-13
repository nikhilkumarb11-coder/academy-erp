import { describe, expect, it } from 'vitest';
import type { CoreTables } from '../data/types';
import { mapImport, normalizeDate, parseCsv } from './csv';
import { EXPORTS } from './exports';
import { toCsv } from './finance';

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes, CRLF and a BOM, and drops blank lines', () => {
    const text = '\uFEFFname,notes\r\n"Rao, Ravi","said ""hi""\nthen left"\r\n\r\nDiya,\r\n';
    expect(parseCsv(text)).toEqual([['name', 'notes'], ['Rao, Ravi', 'said "hi"\nthen left'], ['Diya', '']]);
  });

  it('detects semicolon and tab separated files', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('round-trips what toCsv writes', () => {
    const rows = [['Name', 'Amount'], ['A "quoted", name', '12']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('mapImport', () => {
  it('maps common header names, normalizes dates and amounts, and reports missing columns', () => {
    const m = mapImport([
      ['Parent Name', 'Mobile Number', 'Student', 'DOB', 'Course', 'Pending Fees', 'Shoe size'],
      ['Ravi', '98765 43210', 'Aarav', '3/7/2015', 'Karate', '₹1,500', '6'],
    ]);
    expect(m.rows).toEqual([{ guardian_name: 'Ravi', phone: '98765 43210', student_name: 'Aarav', dob: '2015-07-03', courses: 'Karate', opening_due: '1500' }]);
    expect(m.ignored).toEqual(['Shoe size']);
    expect(m.missing).toEqual([]);
    expect(mapImport([['Name', 'Phone']]).missing).toEqual(['guardian_name']);
  });

  it('reads the date shapes Excel saves, day first', () => {
    expect(normalizeDate('12-03-2015')).toBe('2015-03-12');
    expect(normalizeDate('2015/3/12')).toBe('2015-03-12');
    expect(normalizeDate('03-12-15')).toBe('2015-12-03');
    expect(normalizeDate('05-06-25')).toBe('2025-06-05');
    expect(normalizeDate('11-02-98')).toBe('1998-02-11');
    expect(normalizeDate('6/25/2025')).toBe('2025-06-25');
    expect(normalizeDate('12-Mar-15')).toBe('2015-03-12');
    expect(normalizeDate('2 November 2018')).toBe('2018-11-02');
    expect(normalizeDate('Mar 12, 2015')).toBe('2015-03-12');
    expect(normalizeDate('31-02-2015')).toBe('31-02-2015');
    expect(normalizeDate('March 2015')).toBe('March 2015');
  });
});

describe('exports', () => {
  const t = {
    Categories: [{ id: 'G1', name: 'Martial Arts' }],
    Courses: [{ id: 'C1', category_id: 'G1', name: 'Karate', monthly_fee: 1000, classes_per_week: 3, active: true }],
    Batches: [],
    FeePlans: [{ id: 'F1', name: 'Monthly' }],
    Parents: [{ id: 'P1', guardian_name: 'Ravi', phone: '+919876543210', alt_phone: '', email: '', address: '' }],
    Students: [{ id: 'S1', parent_id: 'P1', name: 'Aarav', class: '5', dob: '', gender: '', join_date: '2026-06-01', status: 'Active' }],
    Enrollments: [{ id: 'E1', student_id: 'S1', course_id: 'C1', fee_plan_id: 'F1', batch_id: '', monthly_fee_override: '', start_date: '2026-06-01', end_date: '', status: 'Active', discount_note: '' }],
    FeeDues: [{ id: 'D1', kind: 'Recurring', enrollment_id: 'E1', student_id: 'S1', parent_id: 'P1', period_label: 'Oct 2026', amount_due: 1000, discount: 0, adjustment: 0, amount_paid: 400, balance: 600, status: 'Partial', due_date: '2026-10-05' }],
    Payments: [{ id: 'PY1', parent_id: 'P1', amount: 400, mode: 'UPI', paid_at: '2026-10-02T10:00:00+05:30', receipt_no: 'RA/1', status: 'Recorded', gateway_payment_id: '', notes: '', cancel_reason: '' }],
    PaymentAllocations: [{ payment_id: 'PY1', due_id: 'D1', amount: 400 }],
    ExpenseCategories: [],
    Expenses: [],
    Enquiries: [{ id: 'Q1', enquiry_date: '2026-10-01', name: 'Kiran', phone: '+919000000001', course_interested: 'C1', source: 'Walk-in', status: 'New', next_followup_date: '', trial_date: '', lost_reason: '', notes: '' }],
  } as unknown as CoreTables;
  const rows = (id: string) => EXPORTS.find((e) => e.id === id)!.rows(t, { country_code: '91' });

  it('uses names, formatted phones and outstanding balances', () => {
    expect(rows('students')[1]).toEqual(['S1', 'Aarav', '5', '', '', '2026-06-01', 'Active', 'Karate', 'Ravi', '+91 98765 43210', 600]);
    expect(rows('families')[1]).toEqual(['Ravi', '+91 98765 43210', '', '', '', 'Aarav', 600, 0]);
    expect(rows('dues')[1]).toEqual(['2026-10-05', 'Aarav', 'Ravi', '+91 98765 43210', 'Karate', 'Oct 2026', 1000, 0, 0, 400, 600, 'Partial']);
    expect(rows('payments')[1].slice(0, 6)).toEqual(['2026-10-02', 'RA/1', 'Ravi', '+91 98765 43210', 400, 'UPI']);
    expect(rows('enquiries')[1].slice(0, 4)).toEqual(['2026-10-01', 'Kiran', '+91 90000 00001', 'Karate']);
    expect(rows('enrolments')[1]).toEqual(['Aarav', 'Karate', '', 'Monthly', 1000, '2026-06-01', '', 'Active', '']);
    expect(rows('courses')[1]).toEqual(['Martial Arts', 'Karate', 1000, 3, 'Yes', 1]);
  });
});
