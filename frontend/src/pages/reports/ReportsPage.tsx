import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Download, Printer, Settings2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ChartCard, Donut, InOutChart } from '../../components/charts';
import { Button, Card, PageHeader, SelectField, Spinner, StatusBadge } from '../../components/ui';
import type { CoreData, Settings } from '../../data/types';
import { brandColor, receiptLogoUrl } from '../../lib/receipt';
import { useCoreData } from '../../data/useCoreData';
import { addMonths, formatDate, monthLabel, todayIso } from '../../lib/dates';
import { duesInMonth } from '../../lib/ledger';
import { balanceSheet, cashFlow, downloadCsv, fyPeriod, monthPeriod, profitAndLoss, type Line } from '../../lib/finance';
import { bool, isDeleted, num } from '../../lib/values';
import { useLabels } from '../../tenant/TenantContext';
import { useMoney } from '../fees/feeShared';
import { BalanceItemsSheet } from './BalanceItemsSheet';
import { ReportsOverview } from './ReportsOverview';

type Tab = 'overview' | 'pl' | 'cash' | 'balance' | 'fees';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'fees', label: 'Fee status' },
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
    <div className="report-print">
      <div className="print:hidden">
        <PageHeader title="Reports" subtitle="Income, expenses and what the academy owns" />
      </div>
      <Letterhead settings={data.settings} title={TABS.find((t) => t.key === tab)?.label ?? 'Report'} />
      <div className="mb-4 flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-1 sm:inline-flex print:hidden" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => setParams((p) => { if (t.key === 'overview') p.delete('tab'); else p.set('tab', t.key); return p; }, { replace: true })}
            className={clsx('min-h-9 shrink-0 rounded-lg px-3 text-sm font-medium sm:px-4', tab === t.key ? 'bg-primary text-white' : 'text-muted')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && (
        <>
          <ExportButtons className="mb-3 justify-end" />
          <ReportsOverview data={data} />
        </>
      )}
      {tab === 'fees' && <FeeStatus data={data} />}
      {tab === 'pl' && <ProfitLoss data={data} />}
      {tab === 'cash' && <CashFlow data={data} />}
      {tab === 'balance' && <Balance data={data} />}
    </div>
  );
}

function FeeStatus({ data }: { data: CoreData }) {
  const money = useMoney();
  const labels = useLabels();
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [courseId, setCourseId] = useState('');
  const courses = data.tables.Courses.filter((c) => bool(c.active) && !isDeleted(c)).sort((a, b) => a.name.localeCompare(b.name));
  const rows = useMemo(() => duesInMonth(data.tables, month, courseId), [data, month, courseId]);
  const totals = rows.reduce((s, r) => ({ due: s.due + r.amountDue, paid: s.paid + r.paid, balance: s.balance + r.balance }), { due: 0, paid: 0, balance: 0 });
  const paid = rows.filter((r) => r.balance <= 0).length;
  const open = rows.length - paid;

  function exportCsv() {
    downloadCsv(`fee-status-${month}.csv`, [
      ['Student', 'Parent', 'Course', 'Period', 'Due', 'Paid', 'Balance', 'Status'],
      ...rows.map((r) => [r.studentName, r.guardian, r.courseName, r.due.period_label, r.amountDue, r.paid, r.balance, r.due.status]),
      ['Total', '', '', '', totals.due, totals.paid, totals.balance, ''],
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Stepper label={monthLabel(month)} onPrev={() => setMonth((m) => addMonths(m, -1))} onNext={() => setMonth((m) => addMonths(m, 1))} nextDisabled={month >= thisMonth} />
        <SelectField label={labels.course} className="min-w-44 [&>span]:sr-only" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">All {labels.courses.toLowerCase()}</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <ExportButtons className="ml-auto" onCsv={exportCsv} />
      </div>
      <p className="hidden text-sm text-muted print:block">{monthLabel(month)}{courseId ? ` · ${courses.find((c) => c.id === courseId)?.name}` : ''}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card className="p-3"><p className="text-xs text-muted">Dues</p><p className="mt-1 font-semibold tabular-nums">{rows.length}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">Paid</p><p className="mt-1 font-semibold tabular-nums text-success">{paid}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">Open</p><p className="mt-1 font-semibold tabular-nums">{open}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted">Outstanding</p><p className={clsx('mt-1 whitespace-nowrap font-semibold tabular-nums', totals.balance > 0 && 'text-danger')}>{money(totals.balance)}</p></Card>
      </div>
      {rows.length === 0 ? (
        <Card><p className="text-sm text-muted">No dues for {monthLabel(month)}. Generate dues from Fees & dues first.</p></Card>
      ) : (
        <Card className="overflow-x-auto p-0 sm:p-0 print:break-inside-avoid">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium sm:px-4">{labels.student}</th>
                <th className="px-3 py-2.5 font-medium">{labels.course}</th>
                <th className="px-3 py-2.5 text-right font-medium">Due</th>
                <th className="px-3 py-2.5 text-right font-medium">Paid</th>
                <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.due.id}>
                  <td className="px-3 py-2.5 sm:px-4">
                    <p className="font-medium">{r.studentName}</p>
                    <p className="text-xs text-muted">{r.guardian}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p>{r.courseName}</p>
                    <p className="text-xs text-muted">{r.due.period_label}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(r.amountDue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(r.paid)}</td>
                  <td className={clsx('px-3 py-2.5 text-right font-medium tabular-nums', r.balance > 0 && 'text-danger')}>{money(r.balance)}</td>
                  <td className="px-3 py-2.5 sm:px-4"><StatusBadge status={r.due.status} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="px-3 py-2.5 sm:px-4" colSpan={2}>Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.due)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.paid)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.balance)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  );
}

/** The receipt's letterhead (lib/receipt.ts), shown only when the report is printed or saved as PDF. */
function Letterhead({ settings, title }: { settings: Settings; title: string }) {
  const name = settings.academy_name || 'Academy';
  const primary = brandColor(settings.brand_primary, '#0B1F3A');
  const accent = brandColor(settings.brand_accent, '#C9A227');
  const logo = receiptLogoUrl(settings);
  return (
    <header className="mb-5 hidden font-[Arial,Helvetica,sans-serif] print:block">
      <div className="flex items-center gap-3">
        {logo
          ? <img src={logo} width={72} height={72} alt="" className="size-[72px] object-contain" />
          : <div className="grid size-16 shrink-0 place-items-center rounded-xl text-[34px] font-bold" style={{ background: primary, color: accent }}>{name.charAt(0)}</div>}
        <div className="flex-1">
          <div className="font-[Georgia,'Times_New_Roman',serif] text-[26px] font-bold tracking-[1px]" style={{ color: primary }}>{name.toUpperCase()}</div>
          {settings.academy_tagline && <div className="mt-0.5 font-[Georgia,'Times_New_Roman',serif] text-xs italic" style={{ color: primary }}>{settings.academy_tagline}</div>}
        </div>
        <div className="text-right text-[11px] leading-normal text-[#4b5563]">
          {settings.academy_phone && <div>{settings.academy_phone}</div>}
          {settings.academy_email && <div>{settings.academy_email}</div>}
          {settings.gstin && <div>GSTIN: {settings.gstin}</div>}
        </div>
      </div>
      <div className="mt-2.5 h-[3px]" style={{ background: accent }} />
      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-[15px] font-bold tracking-[3px]" style={{ color: primary }}>{title.toUpperCase()}</h1>
        <p className="text-[11px] text-[#6b7280]">Generated on {formatDate(todayIso())}</p>
      </div>
    </header>
  );
}

const fyStart = (data: CoreData) => num(data.settings.fy_start_month, 4) || 4;

/**
 * Charts size themselves to their box in JavaScript, which the print engine never runs. So the report is first
 * laid out at the printed page width (`html.printing` in index.css), the charts redraw, and then the dialog opens.
 */
function printReport() {
  const root = document.documentElement;
  root.classList.add('printing');
  const done = () => { root.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 400);
}

/** "PDF" opens the print dialog; the app chrome is hidden in print, so "Save as PDF" gives a clean report. */
function ExportButtons({ onCsv, className }: { onCsv?: () => void; className?: string }) {
  return (
    <div className={clsx('flex gap-2 print:hidden', className)}>
      {onCsv && <Button variant="ghost" onClick={onCsv}><Download className="size-4" aria-hidden /> CSV</Button>}
      <Button variant="ghost" onClick={printReport}><Printer className="size-4" aria-hidden /> PDF</Button>
    </div>
  );
}

function Stepper({ label, onPrev, onNext, nextDisabled }: { label: string; onPrev: () => void; onNext: () => void; nextDisabled: boolean }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-line bg-surface print:border-0">
      <button type="button" aria-label="Previous" onClick={onPrev} className="grid size-11 place-items-center text-muted hover:text-primary print:hidden"><ChevronLeft className="size-5" aria-hidden /></button>
      <span className="min-w-28 text-center font-medium print:min-w-0 print:text-left">{label}</span>
      <button type="button" aria-label="Next" disabled={nextDisabled} onClick={onNext} className="grid size-11 place-items-center text-muted hover:text-primary disabled:opacity-30 print:hidden"><ChevronRight className="size-5" aria-hidden /></button>
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
        <div className="inline-flex rounded-xl border border-line bg-surface p-1 print:hidden">
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
        <div className="print-stack grid gap-4 lg:grid-cols-2">
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
      <Card className="print:break-inside-avoid">
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
