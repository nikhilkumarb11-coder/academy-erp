import clsx from 'clsx';
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Card, EmptyState, PageHeader, SelectField, Spinner, StatusBadge } from '../../components/ui';
import { useCoreData } from '../../data/useCoreData';
import { addMonths, monthLabel, todayIso } from '../../lib/dates';
import { duesInMonth } from '../../lib/ledger';
import { phoneDigits } from '../../lib/phone';
import { bool, isDeleted } from '../../lib/values';
import { useLabels } from '../../tenant/TenantContext';
import { useMoney } from './feeShared';

export function FeesByMonthPage() {
  const labels = useLabels();
  const money = useMoney();
  const { data, isPending } = useCoreData();
  const [params, setParams] = useSearchParams();
  const thisMonth = todayIso().slice(0, 7);
  const month = params.get('month') ?? thisMonth;
  const courseId = params.get('course') ?? '';
  const query = params.get('q') ?? '';
  const deferredQuery = useDeferredValue(query);

  const setParam = (key: string, value: string, fallback = '') =>
    setParams((p) => {
      if (value === fallback) p.delete(key);
      else p.set(key, value);
      return p;
    }, { replace: true });

  const rows = useMemo(() => {
    if (!data) return [];
    const all = duesInMonth(data.tables, month, courseId);
    const q = deferredQuery.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    if (!q) return all;
    const parents = new Map(data.tables.Parents.map((p) => [p.id, p]));
    return all.filter((r) => {
      if (r.studentName.toLowerCase().includes(q) || r.guardian.toLowerCase().includes(q) || r.courseName.toLowerCase().includes(q)) return true;
      if (r.due.period_label.toLowerCase().includes(q)) return true;
      const phone = parents.get(r.parentId)?.phone ?? '';
      return qDigits.length >= 3 && phoneDigits(phone).includes(qDigits);
    });
  }, [data, month, courseId, deferredQuery]);

  if (isPending || !data) return <Spinner />;
  const courses = data.tables.Courses.filter((c) => bool(c.active) && !isDeleted(c)).sort((a, b) => a.name.localeCompare(b.name));
  const totals = rows.reduce((s, r) => ({ due: s.due + r.amountDue, paid: s.paid + r.paid, balance: s.balance + r.balance }), { due: 0, paid: 0, balance: 0 });
  const paidCount = rows.filter((r) => r.balance <= 0).length;
  const openCount = rows.length - paidCount;

  return (
    <>
      <Link to="/fees" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary">
        <ArrowLeft className="size-4" aria-hidden /> Fees & dues
      </Link>
      <PageHeader title="Fees by month" subtitle="Every due for the month — paid and pending" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-xl border border-line bg-surface">
          <button type="button" aria-label="Previous month" className="grid size-11 place-items-center text-muted hover:text-primary" onClick={() => setParam('month', addMonths(month, -1), thisMonth)}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <span className="min-w-28 text-center font-medium">{monthLabel(month)}</span>
          <button type="button" aria-label="Next month" disabled={month >= thisMonth} className="grid size-11 place-items-center text-muted hover:text-primary disabled:opacity-30" onClick={() => setParam('month', addMonths(month, 1), thisMonth)}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
        <SelectField label={labels.course} className="min-w-44 [&>span]:sr-only" value={courseId} onChange={(e) => setParam('course', e.target.value)}>
          <option value="">All {labels.courses.toLowerCase()}</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <Card className="p-3 sm:p-4">
          <p className="text-[11px] text-muted sm:text-xs">Billed</p>
          <p className="mt-1 whitespace-nowrap text-base font-semibold tabular-nums sm:text-xl">{money(totals.due)}</p>
        </Card>
        <Card className="p-3 sm:p-4">
          <p className="text-[11px] text-muted sm:text-xs">Collected</p>
          <p className="mt-1 whitespace-nowrap text-base font-semibold tabular-nums text-success sm:text-xl">{money(totals.paid)}</p>
        </Card>
        <Card className="p-3 sm:p-4">
          <p className="text-[11px] text-muted sm:text-xs">Outstanding</p>
          <p className={clsx('mt-1 whitespace-nowrap text-base font-semibold tabular-nums sm:text-xl', totals.balance > 0 && 'text-danger')}>{money(totals.balance)}</p>
        </Card>
      </div>
      <p className="mb-3 text-sm text-muted">{rows.length} due{rows.length === 1 ? '' : 's'} · {paidCount} paid · {openCount} open</p>

      <label className="relative mb-4 block">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder={`${labels.student}, ${labels.guardian.toLowerCase()}, phone or ${labels.course.toLowerCase()}`}
          className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </label>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={`No dues for ${monthLabel(month)}`}>
            Generate dues for this month from Fees & dues, or pick another month.
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0 sm:p-0">
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
                    <Link to={`/fees/${r.parentId}`} className="font-medium hover:text-primary">{r.studentName}</Link>
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
          </table>
        </Card>
      )}
    </>
  );
}
