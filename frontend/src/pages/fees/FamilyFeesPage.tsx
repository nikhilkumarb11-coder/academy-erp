import clsx from 'clsx';
import { ArrowLeft, ChevronRight, ExternalLink, Loader2, MessageCircle, Phone, Plus, Share2, Wallet, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Button, Card, EmptyState, Spinner, StatusBadge } from '../../components/ui';
import type { FeeDue, Payment } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { formatDate, todayIso } from '../../lib/dates';
import { byDueOrder, creditOf, dueTitle, isOpenDue } from '../../lib/ledger';
import { formatPhone } from '../../lib/phone';
import { isDeleted, num } from '../../lib/values';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { AddChargeSheet, AdjustDueSheet, CancelPaymentSheet, usePaymentFlow } from './FeeSheets';
import { useLogMessages } from '../../data/useMessages';
import { familyReminder, paymentLines, useMoney, useReceiptActions } from './feeShared';

export function FamilyFeesPage() {
  const { parentId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const labels = useLabels();
  const tenant = useTenant();
  const money = useMoney();
  const receipt = useReceiptActions();
  const logMessages = useLogMessages();
  const { data, isPending } = useCoreData();
  const payment = usePaymentFlow();
  const [adjusting, setAdjusting] = useState<FeeDue | null>(null);
  const [charging, setCharging] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Payment | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayIso();

  const view = useMemo(() => {
    const t = data?.tables;
    const parent = t?.Parents.find((p) => p.id === parentId);
    if (!t || !parent) return null;
    const children = t.Students.filter((s) => s.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name));
    const dues = t.FeeDues.filter((d) => d.parent_id === parentId && !isDeleted(d)).sort(byDueOrder);
    const payments = t.Payments.filter((p) => p.parent_id === parentId).sort((a, b) => b.paid_at.localeCompare(a.paid_at) || b.receipt_no.localeCompare(a.receipt_no));
    return {
      t,
      parent,
      children,
      open: dues.filter(isOpenDue),
      settled: dues.filter((d) => !isOpenDue(d)).reverse(),
      payments,
      credit: creditOf(t, parentId),
    };
  }, [data, parentId]);

  // A new admission is still saving: its dues come from the server, so payment waits for them.
  const familySaving = !!view && (!!view.parent._pending || view.children.some((c) => c._pending));
  const found = !!view;
  const { pay } = payment;
  useEffect(() => {
    if (params.get('pay') !== '1' || !found || familySaving) return;
    pay(parentId);
    setParams((p) => { p.delete('pay'); return p; }, { replace: true });
  }, [params, setParams, found, familySaving, pay, parentId]);

  if (isPending || !data) return <Spinner />;
  if (!view) {
    return (
      <Card>
        <EmptyState title="Family not found" action={<Link to="/fees" className="text-sm font-medium text-primary">Back to fees</Link>} />
      </Card>
    );
  }

  const { t, parent, children, open, settled, payments, credit } = view;
  const outstanding = open.reduce((s, d) => s + num(d.balance), 0);
  const remind = outstanding > 0 ? familyReminder(t, data.settings, tenant.name, parentId) : null;
  const act = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key);
    await fn();
    setBusy(null);
  };

  const dueRow = (d: FeeDue) => {
    const { title, period } = dueTitle(t, d);
    const overdue = isOpenDue(d) && d.due_date < today;
    return (
      <li key={d.id}>
        <button type="button" onClick={() => setAdjusting(d)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary-soft/60">
          <div className="min-w-0 flex-1">
            <p className="break-words font-medium">{title}{period && <span className="font-normal text-muted"> · {period}</span>}</p>
            <p className="text-xs text-muted">
              Due {formatDate(d.due_date)}
              {num(d.amount_paid) > 0 && isOpenDue(d) && ` · ${money(num(d.amount_paid))} paid`}
              {num(d.discount) > 0 && ` · ${money(num(d.discount))} off`}
            </p>
          </div>
          <div className="text-right">
            <p className="font-medium tabular-nums">{money(isOpenDue(d) ? num(d.balance) : num(d.amount_paid))}</p>
            <StatusBadge status={overdue ? 'Overdue' : d.status} />
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
        </button>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-3xl pb-24 lg:pb-0">
      <Link to="/fees" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary"><ArrowLeft className="size-4" aria-hidden /> Fees & dues</Link>

      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold">{parent.guardian_name}</h1>
            <p className="text-sm text-muted">
              {children.map((c, i) => (
                <span key={c.id}>{i > 0 && ', '}<Link to={`/students/${c.id}`} className="hover:text-primary">{c.name}</Link></span>
              ))}
            </p>
            <a href={`tel:${parent.phone}`} className="mt-1 inline-flex items-center gap-1 text-sm text-primary"><Phone className="size-3.5" aria-hidden /> {formatPhone(parent.phone, tenant.locale.countryCode)}</a>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">Outstanding</p>
            <p className={clsx('text-2xl font-semibold tabular-nums', outstanding > 0 ? 'text-ink' : 'text-success')}>{money(outstanding)}</p>
            {credit > 0 && <p className="text-xs font-medium text-success">{money(credit)} advance</p>}
          </div>
        </div>
        {familySaving && <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Saving the admission. Fees appear in a moment.</p>}
        <div className="mt-4 hidden gap-2 sm:flex">
          <Button disabled={familySaving} onClick={() => payment.pay(parentId)}><Wallet className="size-4" aria-hidden /> Record payment</Button>
          {remind && <a href={remind.url} target="_blank" rel="noreferrer" onClick={() => logMessages([{ type: 'FeeReminder', parent_id: parentId, preview: remind.text }])} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium text-primary hover:bg-primary-soft"><MessageCircle className="size-4" aria-hidden /> Send reminder</a>}
          <Button variant="ghost" onClick={() => setCharging(children[0]?.id ?? '')}><Plus className="size-4" aria-hidden /> Add charge</Button>
        </div>
      </Card>

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Open dues</h2>
        {open.length === 0 ? (
          <Card><p className="text-sm text-muted">{settled.length ? 'All dues are paid.' : 'No dues yet.'}{credit > 0 && ` ${money(credit)} advance will pay the next dues automatically.`}</p></Card>
        ) : (
          <div className="space-y-3">
            {children.map((c) => {
              const mine = open.filter((d) => d.student_id === c.id);
              if (!mine.length) return null;
              return (
                <Card key={c.id} className="p-0 sm:p-0">
                  <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-muted tabular-nums">{money(mine.reduce((s, d) => s + num(d.balance), 0))}</p>
                  </div>
                  <ul className="divide-y divide-line">{mine.map(dueRow)}</ul>
                </Card>
              );
            })}
          </div>
        )}
        {settled.length > 0 && (
          <div className="mt-3">
            <button type="button" className="text-sm font-medium text-primary" onClick={() => setShowSettled((s) => !s)}>
              {showSettled ? 'Hide' : 'Show'} paid & waived ({settled.length})
            </button>
            {showSettled && <Card className="mt-2 p-0 sm:p-0"><ul className="divide-y divide-line">{settled.map(dueRow)}</ul></Card>}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Payments</h2>
        {payments.length === 0 ? (
          <Card><p className="text-sm text-muted">No payments yet.</p></Card>
        ) : (
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-line">
              {payments.map((p) => {
                const lines = paymentLines(t, p);
                const cancelled = p.status === 'Cancelled';
                return (
                  <li key={p.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={clsx('font-medium tabular-nums', cancelled && 'text-muted line-through')}>{money(num(p.amount))} <span className="text-sm font-normal text-muted">· {p.mode}</span></p>
                        <p className="text-xs text-muted">{p._pending ? 'Saving…' : p.receipt_no} · {formatDate(p.paid_at)}</p>
                        <p className="mt-0.5 break-words text-xs text-muted">
                          {lines.map((l) => [l.title, l.period].filter(Boolean).join(' ')).join(', ') || (cancelled ? '' : 'Advance')}
                        </p>
                        {cancelled && p.cancel_reason && <p className="text-xs text-danger">Cancelled: {p.cancel_reason}</p>}
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className={clsx('mt-2 flex flex-wrap gap-1', p._pending && 'hidden')}>
                      {!cancelled && (
                        <Button variant="ghost" className="min-h-9 px-2.5" loading={busy === `share:${p.id}`} onClick={act(`share:${p.id}`, () => receipt.share(p))}>
                          <Share2 className="size-4" aria-hidden /> Share
                        </Button>
                      )}
                      <Button variant="ghost" className="min-h-9 px-2.5" loading={busy === `open:${p.id}`} onClick={act(`open:${p.id}`, () => receipt.open(p))}>
                        <ExternalLink className="size-4" aria-hidden /> Receipt
                      </Button>
                      {!cancelled && (
                        <Button variant="ghost" className="min-h-9 px-2.5 text-danger hover:bg-danger/5" onClick={() => setCancelling(p)}>
                          <XCircle className="size-4" aria-hidden /> Cancel
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex gap-2 border-t border-line bg-surface p-3 sm:hidden">
        <Button className="flex-1" disabled={familySaving} onClick={() => payment.pay(parentId)}><Wallet className="size-4" aria-hidden /> Record payment</Button>
        {remind && <a href={remind.url} target="_blank" rel="noreferrer" onClick={() => logMessages([{ type: 'FeeReminder', parent_id: parentId, preview: remind.text }])} aria-label="Send reminder on WhatsApp" className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-primary"><MessageCircle className="size-5" aria-hidden /></a>}
        <Button variant="secondary" aria-label={`Add a charge for ${labels.student.toLowerCase()}`} onClick={() => setCharging(children[0]?.id ?? '')}><Plus className="size-5" aria-hidden /></Button>
      </div>

      {payment.sheets}
      {adjusting && <AdjustDueSheet due={adjusting} onClose={() => setAdjusting(null)} />}
      {charging !== null && <AddChargeSheet parentId={parentId} studentId={charging || undefined} onClose={() => setCharging(null)} />}
      {cancelling && <CancelPaymentSheet payment={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}
