import clsx from 'clsx';
import { CalendarPlus, MessageCircle, Search, Wallet } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ExportButton } from '../../components/ExportButton';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { useCoreData } from '../../data/useCoreData';
import { todayIso } from '../../lib/dates';
import { AGE_BUCKETS, collected, familySummaries, type AgeBucket } from '../../lib/ledger';
import { phoneDigits } from '../../lib/phone';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { GenerateDuesSheet, PaymentDoneSheet, RecordPaymentSheet } from './FeeSheets';
import { useLogMessages } from '../../data/useMessages';
import { familyReminder, useMoney } from './feeShared';

type View = 'due' | 'overdue' | AgeBucket | 'credit';

export function FeesPage() {
  const labels = useLabels();
  const tenant = useTenant();
  const money = useMoney();
  const { data, isPending } = useCoreData();
  const logMessages = useLogMessages();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') ?? 'due') as View;
  const query = params.get('q') ?? '';
  const deferredQuery = useDeferredValue(query);
  const [generating, setGenerating] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [donePayment, setDonePayment] = useState<string | null>(null);
  const today = todayIso();

  const setParam = (key: string, value: string, fallback = '') =>
    setParams((p) => {
      if (value === fallback) p.delete(key);
      else p.set(key, value);
      return p;
    }, { replace: true });

  const families = useMemo(() => (data ? familySummaries(data.tables, today) : []), [data, today]);
  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return families.filter((f) => {
      if (view === 'due' && f.outstanding <= 0) return false;
      if (view === 'overdue' && f.overdue <= 0) return false;
      if (view === 'credit' && f.credit <= 0) return false;
      if (AGE_BUCKETS.includes(view as AgeBucket) && f.bucket !== view) return false;
      if (!q) return true;
      if (f.guardian.toLowerCase().includes(q) || f.children.some((c) => c.toLowerCase().includes(q))) return true;
      return qDigits.length >= 3 && phoneDigits(f.phone).includes(qDigits);
    });
  }, [families, view, deferredQuery]);

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
      <PageHeader
        title="Fees & dues"
        subtitle="Who owes what, oldest first"
        actions={
          <>
            <ExportButton list="dues" />
            <Button variant="secondary" onClick={() => setGenerating(true)}><CalendarPlus className="size-4" aria-hidden /> Generate dues</Button>
            <Link to="/payments" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-primary hover:bg-primary-soft">Payments</Link>
          </>
        }
      />

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

      <label className="relative mb-4 block">
        <span className="sr-only">Search families</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder={`${labels.guardian}, ${labels.student.toLowerCase()} or phone`}
          className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </label>

      {rows.length === 0 ? (
        <Card>
          {t.FeeDues.length === 0 ? (
            <EmptyState title="No dues yet" action={<Button onClick={() => setGenerating(true)}>Generate this month's dues</Button>}>
              Dues are created on the 1st of each month for every active enrolment with a fee. Set course fees in Courses & fees first.
            </EmptyState>
          ) : (
            <EmptyState title={view === 'due' && !query ? 'Everyone is paid up' : 'No families match'}>
              {view === 'due' && !query ? 'Nothing is outstanding right now.' : 'Try another filter or search.'}
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
                    <p className="truncate font-medium hover:text-primary">{f.guardian}</p>
                    <p className="truncate text-xs text-muted">{f.children.join(', ')}</p>
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
                    <Button className="min-h-10 flex-1" onClick={() => setPaying(f.parentId)}><Wallet className="size-4" aria-hidden /> Collect</Button>
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
      {paying && <RecordPaymentSheet parentId={paying} onClose={() => setPaying(null)} onRecorded={(id) => { setPaying(null); setDonePayment(id); }} />}
      {donePayment && <PaymentDoneSheet paymentId={donePayment} onClose={() => setDonePayment(null)} />}
    </>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <Card className="p-3 sm:p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx('mt-1 truncate text-lg font-semibold tabular-nums sm:text-xl', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success')}>{value}</p>
    </Card>
  );
}
