import clsx from 'clsx';
import { CalendarPlus, MessageCircle, Wallet } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ExportButton } from '../../components/ExportButton';
import { FeeSearch } from '../../components/FeeSearch';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { useCoreData } from '../../data/useCoreData';
import { useLogMessages } from '../../data/useMessages';
import { todayIso } from '../../lib/dates';
import { AGE_BUCKETS, collected, familySummaries, type AgeBucket } from '../../lib/ledger';
import { phoneDigits } from '../../lib/phone';
import { bool, isDeleted } from '../../lib/values';
import { useTenant } from '../../tenant/TenantContext';
import { FeesByMonthPanel } from './FeesByMonthPage';
import { GenerateDuesSheet, usePaymentFlow } from './FeeSheets';
import { familyReminder, Stat, useMoney } from './feeShared';

export { Stat } from './feeShared';

type View = 'due' | 'overdue' | AgeBucket | 'credit';

export function FeesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'month' ? 'month' : 'families';

  return (
    <>
      <PageHeader
        title="Fees & dues"
        subtitle={tab === 'month' ? 'Billed this month — paid and still owed' : 'Who owes what, oldest first'}
        actions={
          <>
            <ExportButton list="dues" />
            <Link to="/payments" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-primary hover:bg-primary-soft">Payments</Link>
          </>
        }
      />

      <div className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1" role="tablist">
        {([
          { key: 'families', label: 'Families' },
          { key: 'month', label: 'By month' },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams((p) => {
              if (t.key === 'families') p.delete('tab');
              else p.set('tab', 'month');
              return p;
            }, { replace: true })}
            className={clsx('min-h-9 rounded-lg px-4 text-sm font-medium', tab === t.key ? 'bg-primary text-white' : 'text-muted')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'month' ? <FeesByMonthPanel /> : <FamiliesPanel />}
    </>
  );
}

function FamiliesPanel() {
  const tenant = useTenant();
  const money = useMoney();
  const { data, isPending } = useCoreData();
  const logMessages = useLogMessages();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') ?? 'due') as View;
  const query = params.get('q') ?? '';
  const courseId = params.get('course') ?? '';
  const deferredQuery = useDeferredValue(query);
  const [generating, setGenerating] = useState(false);
  const payment = usePaymentFlow();
  const today = todayIso();

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

  const families = useMemo(() => (data ? familySummaries(data.tables, today) : []), [data, today]);
  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return families.filter((f) => {
      if (view === 'due' && f.outstanding <= 0) return false;
      if (view === 'overdue' && f.overdue <= 0) return false;
      if (view === 'credit' && f.credit <= 0) return false;
      if (AGE_BUCKETS.includes(view as AgeBucket) && f.bucket !== view) return false;
      if (courseId && !f.courseIds.includes(courseId)) return false;
      if (!q) return true;
      if (f.guardian.toLowerCase().includes(q) || f.children.some((c) => c.toLowerCase().includes(q))) return true;
      if (f.courses.some((c) => c.toLowerCase().includes(q))) return true;
      return qDigits.length >= 3 && phoneDigits(f.phone).includes(qDigits);
    });
  }, [families, view, deferredQuery, courseId]);

  if (isPending || !data) return <Spinner />;
  const t = data.tables;
  const outstanding = families.reduce((s, f) => s + f.outstanding, 0);
  const overdue = families.reduce((s, f) => s + f.overdue, 0);
  const monthStart = `${today.slice(0, 7)}-01`;
  const thisMonth = collected(t.Payments, monthStart, today);
  const bucketCount = (b: AgeBucket) => families.filter((f) => f.bucket === b).length;

  const chips: { key: View; label: string }[] = [
    { key: 'due', label: `All due (${families.filter((f) => f.outstanding > 0).length})` },
    { key: 'overdue', label: 'Overdue' },
    ...AGE_BUCKETS.filter((b) => bucketCount(b) > 0).map((b) => ({ key: b as View, label: `${b} (${bucketCount(b)})` })),
    ...(families.some((f) => f.credit > 0) ? [{ key: 'credit' as View, label: 'Advance paid' }] : []),
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setGenerating(true)}><CalendarPlus className="size-4" aria-hidden /> Generate dues</Button>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="Outstanding" value={money(outstanding)} />
        <Stat label="Overdue" value={money(overdue)} tone={overdue > 0 ? 'danger' : undefined} />
        <Stat label="Collected this month" value={money(thisMonth)} tone="success" />
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter families">
        {chips.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={view === c.key} onClick={() => setParam('view', c.key, 'due')}
            className={clsx('min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium', view === c.key ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>
            {c.label}
          </button>
        ))}
      </div>

      <FeeSearch
        className="mb-4"
        tables={t}
        value={query}
        courseId={courseId}
        courses={courses}
        onQuery={(q) => setParam('q', q)}
        onCourse={(id) => setParam('course', id)}
      />

      {rows.length === 0 ? (
        <Card>
          {t.FeeDues.length === 0 ? (
            <EmptyState title="No dues yet" action={<Button onClick={() => setGenerating(true)}>Generate this month's dues</Button>}>
              Dues are created on the 1st of each month for every active enrolment with a fee. Set course fees in Courses & fees first.
            </EmptyState>
          ) : (
            <EmptyState title={view === 'due' && !query && !courseId ? 'Everyone is paid up' : 'No families match'}>
              {view === 'due' && !query && !courseId ? 'Nothing is outstanding right now.' : 'Try another filter or search.'}
            </EmptyState>
          )}
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((f) => {
            const remind = f.outstanding > 0 ? familyReminder(t, data.settings, tenant.name, f.parentId) : null;
            return (
              <li key={f.parentId} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/fees/${f.parentId}`} className="min-w-0 flex-1">
                    <p className="break-words font-medium hover:text-primary">{f.children.join(', ') || f.guardian}</p>
                    <p className="break-words text-xs text-muted">{f.guardian}</p>
                    {f.courses.length > 0 && <p className="mt-0.5 break-words text-xs text-muted">{f.courses.join(' · ')}</p>}
                  </Link>
                  <div className="text-right">
                    {f.outstanding > 0 ? (
                      <p className="font-semibold tabular-nums">{money(f.outstanding)}</p>
                    ) : (
                      <p className="font-semibold text-success tabular-nums">+{money(f.credit)}</p>
                    )}
                    <p className={clsx('text-xs', f.bucket ? 'text-danger' : 'text-muted')}>
                      {f.bucket ? `Overdue ${f.bucket}` : f.outstanding > 0 ? 'Not yet due' : 'Advance'}
                    </p>
                  </div>
                </div>
                {f.outstanding > 0 && (
                  <div className="mt-3 flex gap-2">
                    <Button className="min-h-10 flex-1" onClick={() => payment.pay(f.parentId)}><Wallet className="size-4" aria-hidden /> Collect</Button>
                    {remind && (
                      <a href={remind.url} target="_blank" rel="noreferrer"
                        onClick={() => logMessages([{ type: 'FeeReminder', parent_id: f.parentId, preview: remind.text }])}
                        className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-medium text-primary hover:bg-primary-soft">
                        <MessageCircle className="size-4" aria-hidden /> Remind
                      </a>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {generating && <GenerateDuesSheet onClose={() => setGenerating(false)} />}
      {payment.sheets}
    </>
  );
}
