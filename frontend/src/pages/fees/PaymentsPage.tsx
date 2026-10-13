import clsx from 'clsx';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ExportButton } from '../../components/ExportButton';
import { Card, EmptyState, PageHeader, SelectField, Spinner, StatusBadge } from '../../components/ui';
import type { PaymentMode } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { addMonths, formatDate, monthLabel, todayIso } from '../../lib/dates';
import { num } from '../../lib/values';
import { Stat } from './FeesPage';
import { paymentLines, useMoney } from './feeShared';

const MODES: PaymentMode[] = ['Cash', 'UPI', 'Bank', 'Gateway'];

export function PaymentsPage() {
  const money = useMoney();
  const { data, isPending } = useCoreData();
  const [params, setParams] = useSearchParams();
  const thisMonth = todayIso().slice(0, 7);
  const month = params.get('month') ?? thisMonth;
  const mode = params.get('mode') ?? '';

  const rows = useMemo(() => {
    const t = data?.tables;
    if (!t) return [];
    const parents = new Map(t.Parents.map((p) => [p.id, p]));
    return t.Payments
      .filter((p) => String(p.paid_at).startsWith(month))
      .sort((a, b) => b.paid_at.localeCompare(a.paid_at) || b.receipt_no.localeCompare(a.receipt_no))
      .map((p) => ({ payment: p, parent: parents.get(p.parent_id), lines: paymentLines(t, p) }));
  }, [data, month]);

  if (isPending || !data) return <Spinner />;
  const recorded = rows.filter((r) => r.payment.status === 'Recorded');
  const total = recorded.reduce((s, r) => s + num(r.payment.amount), 0);
  const byMode = MODES.map((m) => ({ mode: m, amount: recorded.filter((r) => r.payment.mode === m).reduce((s, r) => s + num(r.payment.amount), 0) })).filter((x) => x.amount > 0);
  const shown = mode ? rows.filter((r) => r.payment.mode === mode) : rows;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, -i));

  const set = (key: string, value: string, fallback: string) =>
    setParams((p) => {
      if (value === fallback) p.delete(key);
      else p.set(key, value);
      return p;
    }, { replace: true });

  return (
    <>
      <PageHeader title="Payments" subtitle={`${recorded.length} receipts in ${monthLabel(month)}`} actions={<ExportButton list="payments" />} />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <SelectField label="Month" className="[&>span]:sr-only" value={month} onChange={(e) => set('month', e.target.value, thisMonth)}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </SelectField>
        <SelectField label="Mode" className="[&>span]:sr-only" value={mode} onChange={(e) => set('mode', e.target.value, '')}>
          <option value="">All modes</option>
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </SelectField>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Stat label="Total collected" value={money(total)} tone="success" />
        {byMode.map((x) => <Stat key={x.mode} label={x.mode} value={money(x.amount)} />)}
      </div>

      {shown.length === 0 ? (
        <Card><EmptyState title="No payments">Nothing recorded {mode && `by ${mode} `}in {monthLabel(month)}.</EmptyState></Card>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {shown.map(({ payment: p, parent, lines }) => (
              <li key={p.id}>
                <Link to={`/receipts/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-primary-soft/60">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{parent?.guardian_name ?? '—'}</p>
                    <p className="truncate text-xs text-muted">
                      {p.receipt_no} · {formatDate(p.paid_at)} · {p.mode}
                      {lines.length > 0 && ` · ${[...new Set(lines.map((l) => l.student))].join(', ')}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={clsx('font-medium tabular-nums', p.status === 'Cancelled' && 'text-muted line-through')}>{money(num(p.amount))}</p>
                    {p.status === 'Cancelled' && <StatusBadge status="Cancelled" />}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
