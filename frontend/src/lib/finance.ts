/**
 * Finance reports (PRD §6.9), computed on the device from cached data.
 * Cash basis: income is money received in the period (not cancelled), expenses are by expense date.
 */
import type { CoreTables, Settings } from '../data/types';
import { addMonths, monthLabel } from './dates';
import { isOpenDue } from './ledger';
import { isDeleted, num } from './values';

export interface Period {
  from: string;
  to: string;
  label: string;
}

export interface Line {
  label: string;
  amount: number;
}

export function monthPeriod(month: string): Period {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, label: monthLabel(month) };
}

/** First month (yyyy-mm) of the financial year containing `date`. */
export function fyStartMonth(date: string, startMonth: number): string {
  const [y, m] = date.split('-').map(Number);
  const s = startMonth >= 1 && startMonth <= 12 ? startMonth : 4;
  return `${m >= s ? y : y - 1}-${String(s).padStart(2, '0')}`;
}

/** Financial year containing `date`, shifted by `offset` years. Label: "FY 2026-27" (or "2026" when it starts in January). */
export function fyPeriod(date: string, startMonth: number, offset = 0): Period & { months: string[] } {
  const first = addMonths(fyStartMonth(date, startMonth), offset * 12);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
  const y = Number(first.slice(0, 4));
  const label = first.endsWith('-01') ? `${y}` : `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  return { from: monthPeriod(months[0]).from, to: monthPeriod(months[11]).to, label, months };
}

const inPeriod = (date: string, p: Pick<Period, 'from' | 'to'>) => {
  const d = date.slice(0, 10);
  return d >= p.from && d <= p.to;
};

type FinanceTables = Pick<CoreTables, 'Payments' | 'PaymentAllocations' | 'FeeDues' | 'Enrollments' | 'Courses' | 'ChargeItems' | 'Expenses' | 'ExpenseCategories' | 'BalanceItems'>;

function addTo(map: Map<string, number>, key: string, amount: number) {
  if (amount) map.set(key, (map.get(key) ?? 0) + amount);
}

const toLines = (map: Map<string, number>): Line[] =>
  [...map.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);

const sum = (lines: Line[]) => lines.reduce((s, l) => s + l.amount, 0);

export const ADVANCE_LABEL = 'Advance fees (not yet used)';

/** Income by course / charge (from how each payment was applied) and expenses by category. */
export function profitAndLoss(t: FinanceTables, period: Pick<Period, 'from' | 'to'>) {
  const dues = new Map(t.FeeDues.map((d) => [d.id, d]));
  const courseOfEnrollment = new Map(t.Enrollments.map((e) => [e.id, e.course_id]));
  const courseName = new Map(t.Courses.map((c) => [c.id, c.name]));
  const chargeName = new Map(t.ChargeItems.map((c) => [c.id, c.name]));
  const allocations = new Map<string, typeof t.PaymentAllocations>();
  t.PaymentAllocations.forEach((a) => allocations.set(a.payment_id, [...(allocations.get(a.payment_id) ?? []), a]));

  const income = new Map<string, number>();
  t.Payments.filter((p) => p.status === 'Recorded' && inPeriod(p.paid_at, period)).forEach((p) => {
    let applied = 0;
    (allocations.get(p.id) ?? []).forEach((a) => {
      const amount = num(a.amount);
      applied += amount;
      const due = a.due_id ? dues.get(a.due_id) : undefined;
      if (!a.due_id) addTo(income, ADVANCE_LABEL, amount);
      else if (!due) addTo(income, 'Other fees', amount);
      else if (due.kind === 'Recurring') addTo(income, courseName.get(courseOfEnrollment.get(due.enrollment_id) ?? '') ?? 'Course fees', amount);
      else addTo(income, chargeName.get(due.charge_item_id) ?? due.period_label ?? 'Other fees', amount);
    });
    addTo(income, 'Other receipts', Math.round((num(p.amount) - applied) * 100) / 100);
  });

  const categoryName = new Map(t.ExpenseCategories.map((c) => [c.id, c.name]));
  const expenses = new Map<string, number>();
  t.Expenses.filter((e) => !isDeleted(e) && inPeriod(e.date, period))
    .forEach((e) => addTo(expenses, categoryName.get(e.category_id) ?? 'Other', num(e.amount)));

  const incomeLines = toLines(income);
  const expenseLines = toLines(expenses);
  const incomeTotal = sum(incomeLines);
  const expenseTotal = sum(expenseLines);
  return { income: incomeLines, incomeTotal, expenses: expenseLines, expenseTotal, net: incomeTotal - expenseTotal };
}

export interface CashFlowRow {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
  /** Running total of net from the first month shown. */
  cumulative: number;
}

export function cashFlow(t: Pick<CoreTables, 'Payments' | 'Expenses'>, months: string[]): CashFlowRow[] {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  t.Payments.filter((p) => p.status === 'Recorded').forEach((p) => addTo(inflow, p.paid_at.slice(0, 7), num(p.amount)));
  t.Expenses.filter((e) => !isDeleted(e)).forEach((e) => addTo(outflow, e.date.slice(0, 7), num(e.amount)));
  let running = 0;
  return months.map((month) => {
    const i = inflow.get(month) ?? 0;
    const o = outflow.get(month) ?? 0;
    running += i - o;
    return { month, inflow: i, outflow: o, net: i - o, cumulative: running };
  });
}

/**
 * Simple balance sheet as of `asOf`. Cash is the owner's opening balances (entered as assets)
 * plus fees received less expenses since settings.opening_balances_date. Equity is the balancing figure.
 */
export function balanceSheet(t: FinanceTables, settings: Settings, asOf: string) {
  const since = settings.opening_balances_date || '';
  const items = t.BalanceItems.filter((b) => !isDeleted(b));
  const window = { from: since || '0000-01-01', to: asOf };
  const received = t.Payments.filter((p) => p.status === 'Recorded' && inPeriod(p.paid_at, window)).reduce((s, p) => s + num(p.amount), 0);
  const spent = t.Expenses.filter((e) => !isDeleted(e) && inPeriod(e.date, window)).reduce((s, e) => s + num(e.amount), 0);
  const receivable = t.FeeDues.filter((d) => isOpenDue(d) && d.due_date <= asOf).reduce((s, d) => s + num(d.balance), 0);
  const recorded = new Set(t.Payments.filter((p) => p.status === 'Recorded').map((p) => p.id));
  const advances = t.PaymentAllocations.filter((a) => !a.due_id && recorded.has(a.payment_id)).reduce((s, a) => s + num(a.amount), 0);

  const assets: Line[] = [
    ...items.filter((b) => b.type === 'Asset').map((b) => ({ label: b.name, amount: num(b.amount) })),
    { label: since ? 'Fees received less expenses since start date' : 'Fees received less expenses (all time)', amount: received - spent },
    { label: 'Fees receivable', amount: receivable },
  ];
  const liabilities: Line[] = [
    ...items.filter((b) => b.type === 'Liability').map((b) => ({ label: b.name, amount: num(b.amount) })),
    { label: 'Advance fees held for families', amount: advances },
  ];
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  return { assets, liabilities, totalAssets, totalLiabilities, equity: totalAssets - totalLiabilities, since };
}

/** RFC 4180 CSV; a BOM so Excel opens ₹ and names correctly. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
