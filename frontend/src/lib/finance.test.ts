import { describe, expect, it } from 'vitest';
import type { CoreTables } from '../data/types';
import { ADVANCE_LABEL, balanceSheet, cashFlow, fyPeriod, monthPeriod, profitAndLoss, toCsv } from './finance';

const tables = {
  Courses: [{ id: 'C1', name: 'Karate' }, { id: 'C2', name: 'Abacus' }],
  Enrollments: [{ id: 'E1', course_id: 'C1' }, { id: 'E2', course_id: 'C2' }],
  ChargeItems: [{ id: 'CH1', name: 'Admission fee' }],
  FeeDues: [
    { id: 'D1', kind: 'Recurring', enrollment_id: 'E1', balance: 0, status: 'Paid', due_date: '2026-10-05' },
    { id: 'D2', kind: 'Recurring', enrollment_id: 'E2', balance: 400, status: 'Partial', due_date: '2026-10-05' },
    { id: 'D3', kind: 'OneTime', charge_item_id: 'CH1', balance: 0, status: 'Paid', due_date: '2026-10-01' },
    { id: 'D4', kind: 'Recurring', enrollment_id: 'E1', balance: 1000, status: 'Pending', due_date: '2026-11-05' },
  ],
  Payments: [
    { id: 'P1', amount: 2100, paid_at: '2026-10-02', status: 'Recorded' },
    { id: 'P2', amount: 500, paid_at: '2026-10-20', status: 'Cancelled' },
    { id: 'P3', amount: 800, paid_at: '2026-09-15', status: 'Recorded' },
  ],
  PaymentAllocations: [
    { payment_id: 'P1', due_id: 'D1', amount: 1000 },
    { payment_id: 'P1', due_id: 'D3', amount: 500 },
    { payment_id: 'P1', due_id: 'D2', amount: 400 },
    { payment_id: 'P1', due_id: '', amount: 200 },
    { payment_id: 'P2', due_id: 'D2', amount: 500 },
    { payment_id: 'P3', due_id: 'D2', amount: 800 },
  ],
  ExpenseCategories: [{ id: 'X1', name: 'Rent' }, { id: 'X2', name: 'Salaries' }],
  Expenses: [
    { id: 'EX1', date: '2026-10-05', category_id: 'X1', amount: 1500 },
    { id: 'EX2', date: '2026-10-07', category_id: 'X2', amount: 300 },
    { id: 'EX3', date: '2026-10-09', category_id: 'X2', amount: 999, deleted: true },
    { id: 'EX4', date: '2026-09-30', category_id: 'X1', amount: 1500 },
  ],
  BalanceItems: [
    { id: 'B1', type: 'Asset', name: 'Equipment', amount: 10000 },
    { id: 'B2', type: 'Liability', name: 'Loan', amount: 4000 },
  ],
} as unknown as CoreTables;

describe('finance', () => {
  it('builds periods for months and financial years', () => {
    expect(monthPeriod('2026-02')).toMatchObject({ from: '2026-02-01', to: '2026-02-28', label: 'Feb 2026' });
    const fy = fyPeriod('2026-02-10', 4);
    expect(fy).toMatchObject({ from: '2025-04-01', to: '2026-03-31', label: 'FY 2025-26' });
    expect(fy.months[0]).toBe('2025-04');
    expect(fyPeriod('2026-10-13', 4, -1).label).toBe('FY 2025-26');
    expect(fyPeriod('2026-10-13', 1).label).toBe('2026');
  });

  it('splits income by course and charge, ignoring cancelled payments', () => {
    const pl = profitAndLoss(tables, monthPeriod('2026-10'));
    expect(pl.income).toEqual([
      { label: 'Karate', amount: 1000 },
      { label: 'Admission fee', amount: 500 },
      { label: 'Abacus', amount: 400 },
      { label: ADVANCE_LABEL, amount: 200 },
    ]);
    expect(pl.incomeTotal).toBe(2100);
    expect(pl.expenses).toEqual([{ label: 'Rent', amount: 1500 }, { label: 'Salaries', amount: 300 }]);
    expect(pl.net).toBe(300);
  });

  it('shows monthly cash flow with a running total', () => {
    const rows = cashFlow(tables, ['2026-09', '2026-10']);
    expect(rows).toEqual([
      { month: '2026-09', inflow: 800, outflow: 1500, net: -700, cumulative: -700 },
      { month: '2026-10', inflow: 2100, outflow: 1800, net: 300, cumulative: -400 },
    ]);
  });

  it('balances assets against liabilities and equity', () => {
    const bs = balanceSheet(tables, { opening_balances_date: '2026-10-01' }, '2026-10-31');
    expect(bs.assets.map((a) => a.amount)).toEqual([10000, 300, 400]);
    expect(bs.liabilities.map((a) => a.amount)).toEqual([4000, 200]);
    expect(bs.equity).toBe(bs.totalAssets - bs.totalLiabilities);
    expect(bs.equity).toBe(6500);
  });

  it('quotes CSV cells that need it', () => {
    expect(toCsv([['a', 'b,c'], ['say "hi"', 5]])).toBe('\uFEFFa,"b,c"\r\n"say ""hi""",5\r\n');
  });
});
