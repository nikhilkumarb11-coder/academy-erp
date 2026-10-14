import clsx from 'clsx';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Bars, ChartCard, Donut, InOutChart, RankBars, useChartColors } from '../../components/charts';
import { Card } from '../../components/ui';
import type { CoreData } from '../../data/types';
import { addDaysIso, addMonths, todayIso } from '../../lib/dates';
import { cashFlow, fyPeriod, profitAndLoss } from '../../lib/finance';
import { ageBucket, AGE_BUCKETS, collected, dueNet, isOpenDue } from '../../lib/ledger';
import { bool, isDeleted, num } from '../../lib/values';
import { useLabels } from '../../tenant/TenantContext';
import { useMoney } from '../fees/feeShared';

const shortMonth = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleString('en-IN', { month: 'short' });

function Kpi({ label, value, hint, tone, to }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad'; to?: string }) {
  const body = (
    <Card className="h-full p-3 sm:p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx('mt-1 break-words text-lg font-semibold tabular-nums sm:text-xl', tone === 'good' && 'text-success', tone === 'bad' && 'text-danger')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

/** The academy at a glance in charts: money in and out, where fees come from, what is owed, enrolments. */
export function ReportsOverview({ data }: { data: CoreData }) {
  const money = useMoney();
  const labels = useLabels();
  const colors = useChartColors();
  const today = todayIso();
  const thisMonth = today.slice(0, 7);

  const view = useMemo(() => {
    const t = data.tables;
    const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, i - 11));
    const allFlow = cashFlow(t, months).map((r) => ({ label: shortMonth(r.month), inflow: r.inflow, outflow: r.outflow, net: r.inflow - r.outflow }));
    const current = allFlow[allFlow.length - 1];
    // Months before the first recorded money only add an empty stretch; keep at least six.
    const firstActive = allFlow.findIndex((r) => r.inflow || r.outflow);
    const flow = allFlow.slice(Math.min(firstActive < 0 ? 6 : firstActive, 6));

    const billed = t.FeeDues.filter((d) => !isDeleted(d) && d.status !== 'Waived' && d.due_date.slice(0, 7) === thisMonth);
    const billedTotal = billed.reduce((s, d) => s + dueNet(d), 0);
    const billedPaid = billed.reduce((s, d) => s + Math.max(0, dueNet(d) - num(d.balance)), 0);
    const weekAhead = addDaysIso(today, 7);
    const upcoming = t.FeeDues.filter((d) => isOpenDue(d) && d.due_date >= today && d.due_date <= weekAhead).reduce((s, d) => s + num(d.balance), 0);

    const since = `${months[0]}-01`;
    const modes = new Map<string, number>();
    t.Payments.filter((p) => p.status === 'Recorded' && p.paid_at >= since).forEach((p) => modes.set(p.mode, (modes.get(p.mode) ?? 0) + num(p.amount)));

    const aging = new Map<string, number>([['Not yet due', 0], ...AGE_BUCKETS.map((b): [string, number] => [b, 0])]);
    t.FeeDues.filter(isOpenDue).forEach((d) => {
      const bucket = ageBucket(d.due_date, today) ?? 'Not yet due';
      aging.set(bucket, (aging.get(bucket) ?? 0) + num(d.balance));
    });

    const fy = fyPeriod(today, num(data.settings.fy_start_month, 4) || 4);
    const income = profitAndLoss(t, fy).income.filter((l) => l.amount > 0).slice(0, 8);

    const activeIds = new Set(t.Students.filter((s) => s.status === 'Active').map((s) => s.id));
    const enrolments = t.Courses.filter((c) => bool(c.active))
      .map((c) => ({ label: c.name, value: t.Enrollments.filter((e) => e.status === 'Active' && e.course_id === c.id && activeIds.has(e.student_id)).length }))
      .sort((a, b) => b.value - a.value);
    const joins = months.slice(-6).map((m) => ({ label: shortMonth(m), key: m, value: t.Students.filter((s) => (s.join_date || s.created_at).slice(0, 7) === m).length }));

    return {
      flow,
      current,
      today: collected(t.Payments, today, today),
      rate: billedTotal > 0 ? Math.round((billedPaid / billedTotal) * 100) : null,
      upcoming,
      modes: [...modes.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      aging: [...aging.entries()].map(([label, value]) => ({ label: label.replace(' days', 'd'), key: label, value })),
      fyLabel: fy.label,
      income,
      enrolments,
      joins,
    };
  }, [data, thisMonth, today]);

  const { current } = view;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Kpi label="Collected this month" value={money(current.inflow)} hint={`Today ${money(view.today)}`} to="/payments" />
        <Kpi label="Expenses this month" value={money(current.outflow)} to="/expenses" />
        <Kpi label={current.net >= 0 ? 'Profit this month' : 'Loss this month'} value={money(current.net)} tone={current.net >= 0 ? 'good' : 'bad'} />
        <Kpi label="This month's fees collected" value={view.rate === null ? '—' : `${view.rate}%`} hint={view.upcoming ? `${money(view.upcoming)} due in 7 days` : undefined} to="/fees" />
      </div>

      <ChartCard title="Money in and out" subtitle="Fees received vs expenses each month, with profit">
        <InOutChart data={view.flow} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="How families pay" subtitle="Last 12 months">
          <Donut data={view.modes} totalLabel="received" />
        </ChartCard>
        <ChartCard title="Outstanding by age" subtitle="How long unpaid dues have been overdue" action={<Link to="/fees" className="text-sm font-medium text-primary">Dues</Link>}>
          <Bars data={view.aging} color={colors.danger} />
        </ChartCard>
        <ChartCard title={`Income by ${labels.course.toLowerCase()}`} subtitle={view.fyLabel}>
          <RankBars data={view.income.map((l) => ({ label: l.label, value: l.amount }))} money color={colors.primary} />
        </ChartCard>
        <ChartCard title={`Active enrolments by ${labels.course.toLowerCase()}`} action={<Link to="/courses" className="text-sm font-medium text-primary">{labels.courses}</Link>}>
          <RankBars data={view.enrolments} />
        </ChartCard>
        <ChartCard title="New admissions" subtitle="Last 6 months" className="lg:col-span-2">
          <Bars data={view.joins} money={false} height={180} color={colors.accent} />
        </ChartCard>
      </div>
    </div>
  );
}
