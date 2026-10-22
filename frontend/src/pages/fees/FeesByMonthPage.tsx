import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Wallet } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { FeeSearch } from '../../components/FeeSearch';
import { Button, Card, EmptyState, Spinner, StatusBadge } from '../../components/ui';
import { useCoreData } from '../../data/useCoreData';
import { addMonths, monthLabel, todayIso } from '../../lib/dates';
import { duesInMonth, type MonthDueRow } from '../../lib/ledger';
import { phoneDigits } from '../../lib/phone';
import { bool, isDeleted } from '../../lib/values';
import { useLabels } from '../../tenant/TenantContext';
import { Stat, useMoney } from './feeShared';

type StatusFilter = 'pending' | 'paid' | 'all';

/** Old bookmark `/fees/by-month` → Families/By month tabs on Fees. */
export function FeesByMonthPage() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('tab', 'month');
  return <Navigate to={`/fees?${next.toString()}`} replace />;
}

export function FeesByMonthPanel() {
  const labels = useLabels();
  const money = useMoney();
  const navigate = useNavigate();
  const { data, isPending } = useCoreData();
  const [params, setParams] = useSearchParams();
  const thisMonth = todayIso().slice(0, 7);
  const month = params.get('month') ?? thisMonth;
  const courseId = params.get('course') ?? '';
  const status = (params.get('status') as StatusFilter) || 'pending';
  const query = params.get('q') ?? '';
  const deferredQuery = useDeferredValue(query);

  const setParam = (key: string, value: string, fallback = '') =>
    setParams((p) => {
      if (value === fallback) p.delete(key);
      else p.set(key, value);
      return p;
    }, { replace: true });

  const courses = useMemo(() => {
    if (!data) return [];
    return data.tables.Courses.filter((c) => bool(c.active) && !isDeleted(c)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const allRows = useMemo(() => (data ? duesInMonth(data.tables, month, courseId) : []), [data, month, courseId]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = deferredQuery.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const parents = new Map(data.tables.Parents.map((p) => [p.id, p]));
    return allRows.filter((r) => {
      if (status === 'pending' && r.balance <= 0) return false;
      if (status === 'paid' && r.balance > 0) return false;
      if (!q) return true;
      if (r.studentName.toLowerCase().includes(q) || r.guardian.toLowerCase().includes(q) || r.courseName.toLowerCase().includes(q)) return true;
      if (r.due.period_label.toLowerCase().includes(q)) return true;
      const phone = parents.get(r.parentId)?.phone ?? '';
      return qDigits.length >= 3 && phoneDigits(phone).includes(qDigits);
    });
  }, [data, allRows, status, deferredQuery]);

  if (isPending || !data) return <Spinner />;

  const billed = allRows.reduce((s, r) => s + r.amountDue, 0);
  const collected = allRows.reduce((s, r) => s + r.paid, 0);
  const outstanding = allRows.reduce((s, r) => s + r.balance, 0);
  const pendingRows = allRows.filter((r) => r.balance > 0);
  const paidRows = allRows.filter((r) => r.balance <= 0);

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: 'pending', label: `Still owed (${pendingRows.length})` },
    { key: 'paid', label: `Paid (${paidRows.length})` },
    { key: 'all', label: `All (${allRows.length})` },
  ];

  return (
    <>
      <p className="mb-3 text-sm text-muted">Who was billed in {monthLabel(month)} — paid and still owed.</p>

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
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="Billed" value={money(billed)} />
        <Stat label="Collected" value={money(collected)} tone="success" />
        <Stat label="Still owed" value={money(outstanding)} tone={outstanding > 0 ? 'danger' : undefined} />
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Payment status">
        {statusChips.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={status === c.key} onClick={() => setParam('status', c.key, 'pending')}
            className={clsx('min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium', status === c.key ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        <button type="button" aria-pressed={!courseId} onClick={() => setParam('course', '')}
          className={clsx('min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium', !courseId ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>
          All {labels.courses.toLowerCase()}
        </button>
        {courses.map((c) => (
          <button key={c.id} type="button" aria-pressed={courseId === c.id} onClick={() => setParam('course', c.id)}
            className={clsx('min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium', courseId === c.id ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>
            {c.name}
          </button>
        ))}
      </div>

      <FeeSearch
        className="mb-4"
        tables={data.tables}
        value={query}
        courseId={courseId}
        courses={courses}
        onQuery={(q) => setParam('q', q)}
        onCourse={(id) => setParam('course', id)}
      />

      {allRows.length === 0 ? (
        <Card>
          <EmptyState title={`No dues for ${monthLabel(month)}`}>
            Generate dues for this month from the Families tab, or pick another month.
          </EmptyState>
        </Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState title="No matches">Try another status, course or search.</EmptyState></Card>
      ) : status === 'all' ? (
        <div className="space-y-6">
          <DueSection title="Still to collect" rows={rows.filter((r) => r.balance > 0)} money={money} empty="Everyone in this filter has paid." onCollect={(id) => navigate(`/fees/${id}?pay=1`)} />
          <DueSection title="Fully paid" rows={rows.filter((r) => r.balance <= 0)} money={money} empty="No paid dues in this filter." />
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => <DueCard key={r.due.id} row={r} money={money} onCollect={r.balance > 0 ? () => navigate(`/fees/${r.parentId}?pay=1`) : undefined} />)}
        </ul>
      )}
    </>
  );
}

function DueSection({ title, rows, money, empty, onCollect }: {
  title: string;
  rows: MonthDueRow[];
  money: (n: number) => string;
  empty: string;
  onCollect?: (parentId: string) => void;
}) {
  const subtotal = rows.reduce((s, r) => s + r.balance, 0);
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {rows.length > 0 && subtotal > 0 && <p className="text-sm font-medium tabular-nums text-danger">{money(subtotal)}</p>}
        {rows.length > 0 && subtotal <= 0 && <p className="text-sm text-muted">{rows.length}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => <DueCard key={r.due.id} row={r} money={money} onCollect={onCollect ? () => onCollect(r.parentId) : undefined} />)}
        </ul>
      )}
    </section>
  );
}

function DueCard({ row: r, money, onCollect }: { row: MonthDueRow; money: (n: number) => string; onCollect?: () => void }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link to={`/fees/${r.parentId}`} className="font-medium hover:text-primary">{r.studentName}</Link>
          <p className="text-xs text-muted">{r.guardian} · {r.courseName}</p>
          <p className="mt-0.5 text-xs text-muted">{r.due.period_label}</p>
        </div>
        <div className="text-right">
          <p className={clsx('font-semibold tabular-nums', r.balance > 0 ? 'text-danger' : 'text-success')}>
            {r.balance > 0 ? money(r.balance) : money(r.amountDue)}
          </p>
          <StatusBadge status={r.due.status} />
        </div>
      </div>
      {onCollect && (
        <div className="mt-3">
          <Button className="min-h-10 w-full sm:w-auto" onClick={onCollect}><Wallet className="size-4" aria-hidden /> Collect</Button>
        </div>
      )}
    </li>
  );
}
