import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Download, Printer, Settings2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ChartCard, Donut, InOutChart } from '../../components/charts';
import { Button, Card, PageHeader, Spinner } from '../../components/ui';
import type { CoreData } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { addMonths, formatDate, monthLabel, todayIso } from '../../lib/dates';
import { balanceSheet, cashFlow, downloadCsv, fyPeriod, monthPeriod, profitAndLoss, type Line } from '../../lib/finance';
import { isDeleted, num } from '../../lib/values';
import { useMoney } from '../fees/feeShared';
import { BalanceItemsSheet } from './BalanceItemsSheet';
import { ReportsOverview } from './ReportsOverview';

type Tab = 'overview' | 'pl' | 'cash' | 'balance';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'pl', label: 'Profit & loss' },
  { key: 'cash', label: 'Cash flow' },
  { key: 'balance', label: 'Balance sheet' },
];

export function ReportsPage() {
  const { data, isPending } = useCoreData();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview') as Tab;

  if (isPending || !data) return <Spinner />;
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Reports" subtitle="Income, expenses and what the academy owns" />
      </div>
      <h1 className="mb-4 hidden text-xl font-semibold print:block">
        {data.settings.academy_name} · {TABS.find((t) => t.key === tab)?.label}
      </h1>
      <div className="mb-4 flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-1 sm:inline-flex print:hidden" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => setParams((p) => { if (t.key === 'overview') p.delete('tab'); else p.set('tab', t.key); return p; }, { replace: true })}
            className={clsx('min-h-9 shrink-0 rounded-lg px-3 text-sm font-medium sm:px-4', tab === t.key ? 'bg-primary text-white' : 'text-muted')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <ReportsOverview data={data} />}
      {tab === 'pl' && <ProfitLoss data={data} />}
      {tab === 'cash' && <CashFlow data={data} />}
      {tab === 'balance' && <Balance data={data} />}
    </>
  );
}

const fyStart = (data: CoreData) => num(data.settings.fy_start_month, 4) || 4;

/** "PDF" opens the print dialog; the app chrome is hidden in print, so "Save as PDF" gives a clean report. */
function ExportButtons({ onCsv, className }: { onCsv: () => void; className?: string }) {
  return (
    <div className={clsx('flex gap-2 print:hidden', className)}>
      <Button variant="ghost" onClick={onCsv}><Download className="size-4" aria-hidden /> CSV</Button>
      <Button variant="ghost" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> PDF</Button>
    </div>
  );
}

function Stepper({ label, onPrev, onNext, nextDisabled }: { label: string; onPrev: () => void; onNext: () => void; nextDisabled: boolean }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-line bg-surface">
      <button type="button" aria-label="Previous" onClick={onPrev} className="grid size-11 place-items-center text-muted hover:text-primary"><ChevronLeft className="size-5" aria-hidden /></button>
      <span className="min-w-28 text-center font-medium">{label}</span>
      <button type="button" aria-label="Next" disabled={nextDisabled} onClick={onNext} className="grid size-11 place-items-center text-muted hover:text-primary disabled:opacity-30"><ChevronRight className="size-5" aria-hidden /></button>
    </div>
  );
}

function Section({ title, lines, total, totalLabel, empty }: { title: string; lines: Line[]; total: number; totalLabel: string; empty: string }) {
  const money = useMoney();
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {lines.length === 0 ? <p className="py-2 text-sm text-muted">{empty}</p> : (
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-3 py-2 text-sm">
              <span>{l.label}</span><span className="tabular-nums">{money(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="flex justify-between gap-3 border-t border-line pt-2 font-semibold">
        <span>{totalLabel}</span><span className="tabular-nums">{money(total)}</span>
      </p>
    </div>
  );
}

function ResultRow({ label, value, hint }: { label: string; value: number; hint?: ReactNode }) {
  const money = useMoney();
  return (
    <div className={clsx('rounded-xl px-4 py-3', value >= 0 ? 'bg-success/10' : 'bg-danger/10')}>
      <p className="flex justify-between gap-3 text-lg font-semibold">
        <span>{label}</span>
        <span className={clsx('tabular-nums', value >= 0 ? 'text-success' : 'text-danger')}>{money(value)}</span>
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function ProfitLoss({ data }: { data: CoreData }) {
  const today = todayIso();
  const [mode, setMode] = useState<'month' | 'fy'>('month');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [fyOffset, setFyOffset] = useState(0);
  const period = mode === 'month' ? monthPeriod(month) : fyPeriod(today, fyStart(data), fyOffset);
  const pl = profitAndLoss(data.tables, period);
  const margin = pl.incomeTotal ? Math.round((pl.net / pl.incomeTotal) * 100) : 0;

  function exportCsv() {
    downloadCsv(`profit-loss-${period.from}-to-${period.to}.csv`, [
      ['Profit and loss', period.label], [],
      ['Income', 'Amount'], ...pl.income.map((l) => [l.label, l.amount]), ['Total income', pl.incomeTotal], [],
      ['Expenses', 'Amount'], ...pl.expenses.map((l) => [l.label, l.amount]), ['Total expenses', pl.expenseTotal], [],
      ['Net profit', pl.net],
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-line bg-surface p-1">
          {(['month', 'fy'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={clsx('min-h-9 rounded-lg px-3 text-sm font-medium', mode === m ? 'bg-primary-soft text-primary' : 'text-muted')}>
              {m === 'month' ? 'Month' : 'Financial year'}
            </button>
          ))}
        </div>
        {mode === 'month'
          ? <Stepper label={monthLabel(month)} onPrev={() => setMonth((m) => addMonths(m, -1))} onNext={() => setMonth((m) => addMonths(m, 1))} nextDisabled={month >= today.slice(0, 7)} />
          : <Stepper label={period.label} onPrev={() => setFyOffset((o) => o - 1)} onNext={() => setFyOffset((o) => o + 1)} nextDisabled={fyOffset >= 0} />}
        <ExportButtons className="ml-auto" onCsv={exportCsv} />
      </div>
      <Card className="space-y-5">
        <Section title="Income (fees received)" lines={pl.income} total={pl.incomeTotal} totalLabel="Total income" empty="No fees received in this period." />
        <Section title="Expenses" lines={pl.expenses} total={pl.expenseTotal} totalLabel="Total expenses" empty="No expenses recorded in this period." />
        <ResultRow label={pl.net >= 0 ? 'Net profit' : 'Net loss'} value={pl.net} hint={pl.net > 0 && pl.incomeTotal ? `${margin}% of income kept as profit` : undefined} />
      </Card>
      {(pl.incomeTotal > 0 || pl.expenseTotal > 0) && (
        <div className="grid gap-4 lg:grid-cols-2 print:hidden">
          <ChartCard title="Where income came from" subtitle={period.label}>
            <Donut data={pl.income.map((l) => ({ name: l.label, value: l.amount }))} totalLabel="income" />
          </ChartCard>
          <ChartCard title="Where money went" subtitle={period.label}>
            <Donut data={pl.expenses.map((l) => ({ name: l.label, value: l.amount }))} totalLabel="expenses" />
          </ChartCard>
        </div>
      )}
      <p className="text-xs text-muted">Counted when money is received or spent. Advance fees are included when they are paid.</p>
    </div>
  );
}

function CashFlow({ data }: { data: CoreData }) {
  const money = useMoney();
  const today = todayIso();
  const [fyOffset, setFyOffset] = useState(0);
  const fy = fyPeriod(today, fyStart(data), fyOffset);
  const months = fy.months.filter((m) => m <= today.slice(0, 7));
  const rows = cashFlow(data.tables, months);
  const totals = rows.reduce((s, r) => ({ inflow: s.inflow + r.inflow, outflow: s.outflow + r.outflow }), { inflow: 0, outflow: 0 });

  function exportCsv() {
    downloadCsv(`cash-flow-${fy.label.replace(/\s/g, '-')}.csv`, [
      ['Month', 'Money in', 'Money out', 'Net', 'Running total'],
      ...rows.map((r) => [monthLabel(r.month), r.inflow, r.outflow, r.net, r.cumulative]),
      ['Total', totals.inflow, totals.outflow, totals.inflow - totals.outflow, ''],
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Stepper label={fy.label} onPrev={() => setFyOffset((o) => o - 1)} onNext={() => setFyOffset((o) => o + 1)} nextDisabled={fyOffset >= 0} />
        <ExportButtons className="ml-auto" onCsv={exportCsv} />
      </div>
      <Card className="print:hidden">
        <InOutChart data={rows.map((r) => ({ label: monthLabel(r.month).slice(0, 3), inflow: r.inflow, outflow: r.outflow, net: r.net }))} />
      </Card>
      <Card className="!p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-2 py-2 text-right font-medium">In</th>
                <th className="px-2 py-2 text-right font-medium">Out</th>
                <th className="px-4 py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.month}>
                  <td className="whitespace-nowrap px-4 py-2">{monthLabel(r.month)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(r.inflow)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(r.outflow)}</td>
                  <td className={clsx('px-4 py-2 text-right font-medium tabular-nums', r.net < 0 && 'text-danger')}>{money(r.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(totals.inflow)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(totals.outflow)}</td>
                <td className={clsx('px-4 py-2 text-right tabular-nums', totals.inflow < totals.outflow && 'text-danger')}>{money(totals.inflow - totals.outflow)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Balance({ data }: { data: CoreData }) {
  const today = todayIso();
  const [managing, setManaging] = useState(false);
  const bs = useMemo(() => balanceSheet(data.tables, data.settings, today), [data, today]);

  function exportCsv() {
    downloadCsv(`balance-sheet-${today}.csv`, [
      ['Balance sheet as of', today], [],
      ['Assets', 'Amount'], ...bs.assets.map((l) => [l.label, l.amount]), ['Total assets', bs.totalAssets], [],
      ['Liabilities', 'Amount'], ...bs.liabilities.map((l) => [l.label, l.amount]), ['Total liabilities', bs.totalLiabilities], [],
      ["Owner's equity", bs.equity],
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted">As of {formatDate(today)}{bs.since && ` · cash counted from ${formatDate(bs.since)}`}</p>
        <div className="ml-auto flex flex-wrap gap-2 print:hidden">
          <Button variant="ghost" onClick={() => setManaging(true)}><Settings2 className="size-4" aria-hidden /> Assets & loans</Button>
          <ExportButtons onCsv={exportCsv} />
        </div>
      </div>
      <Card className="space-y-5">
        <Section title="What the academy owns" lines={bs.assets} total={bs.totalAssets} totalLabel="Total assets" empty="" />
        <Section title="What it owes" lines={bs.liabilities} total={bs.totalLiabilities} totalLabel="Total liabilities" empty="" />
        <ResultRow label="Owner's equity" value={bs.equity} hint="Assets minus liabilities." />
      </Card>
      {!data.tables.BalanceItems.some((b) => !isDeleted(b)) && (
        <p className="text-xs text-muted">Add your opening bank balance, equipment, deposits and loans under "Assets & loans" for a complete picture.</p>
      )}
      {managing && <BalanceItemsSheet onClose={() => setManaging(false)} />}
    </div>
  );
}
