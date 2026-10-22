import { describe, expect, it } from 'vitest';
import type { FeeDue, Payment, PaymentAllocation } from '../data/types';
import { addDaysIso, addMonths, daysBetween, formatDate, monthLabel } from './dates';
import { ageBucket, creditOf, dueCoversMonth, fillTemplate, isOpenDue, previewAllocation } from './ledger';

const due = (id: string, due_date: string, balance: number, status: FeeDue['status'] = 'Pending') =>
  ({ id, due_date, balance, status, created_at: '', parent_id: 'P1' }) as unknown as FeeDue;

describe('ledger', () => {
  it('ages overdue dues into PRD buckets', () => {
    expect(ageBucket('2026-10-13', '2026-10-13')).toBeNull();
    expect(ageBucket('2026-10-12', '2026-10-13')).toBe('1–7 days');
    expect(ageBucket('2026-10-01', '2026-10-13')).toBe('8–15 days');
    expect(ageBucket('2026-09-20', '2026-10-13')).toBe('16–30 days');
    expect(ageBucket('2026-08-01', '2026-10-13')).toBe('30+ days');
  });

  it('previews oldest-first allocation like the server', () => {
    const dues = [due('b', '2026-10-05', 1000), due('a', '2026-09-05', 800)];
    expect(previewAllocation(dues, 1200).map((x) => [x.due.id, x.amount])).toEqual([['a', 800], ['b', 400]]);
    expect(previewAllocation(dues, 5000).reduce((s, x) => s + x.amount, 0)).toBe(1800);
  });

  it('counts only unspent credit of recorded payments', () => {
    const Payments = [{ id: 'p1', parent_id: 'P1', status: 'Recorded' }, { id: 'p2', parent_id: 'P1', status: 'Cancelled' }] as Payment[];
    const PaymentAllocations = [
      { payment_id: 'p1', due_id: '', amount: 300 },
      { payment_id: 'p1', due_id: 'd1', amount: 700 },
      { payment_id: 'p2', due_id: '', amount: 999 },
    ] as PaymentAllocation[];
    expect(creditOf({ Payments, PaymentAllocations }, 'P1')).toBe(300);
  });

  it('treats paid and waived dues as closed', () => {
    expect(isOpenDue(due('x', '2026-10-01', 0, 'Paid'))).toBe(false);
    expect(isOpenDue(due('x', '2026-10-01', 500, 'Partial'))).toBe(true);
    expect(isOpenDue(due('x', '2026-10-01', 0, 'Waived'))).toBe(false);
  });

  it('fills templates and leaves unknown placeholders visible', () => {
    expect(fillTemplate('Dear {parent}, ₹{amount} {payment_link}', { parent: 'Ravi', amount: '1,000' })).toBe('Dear Ravi, ₹1,000 {payment_link}');
  });

  it('matches dues whose period covers a month', () => {
    const recurring = { kind: 'Recurring', period_start: '2026-10-01', period_end: '2026-12-31', due_date: '2026-10-05' } as FeeDue;
    expect(dueCoversMonth(recurring, '2026-10')).toBe(true);
    expect(dueCoversMonth(recurring, '2026-12')).toBe(true);
    expect(dueCoversMonth(recurring, '2027-01')).toBe(false);
    const oneTime = { kind: 'OneTime', period_start: '2026-09-01', due_date: '2026-09-15' } as FeeDue;
    expect(dueCoversMonth(oneTime, '2026-09')).toBe(true);
    expect(dueCoversMonth(oneTime, '2026-10')).toBe(false);
  });
});

describe('dates', () => {
  it('does month and day arithmetic', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2026-10')).toBe('Oct 2026');
    expect(formatDate('2026-10-03')).toBe('3 Oct 2026');
    expect(daysBetween('2026-02-27', '2026-03-01')).toBe(2);
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
});
