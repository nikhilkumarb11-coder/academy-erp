import clsx from 'clsx';
import { CheckCircle2, ExternalLink, MessageCircle, Share2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorField, fieldError } from '../../api/fieldErrors';
import { errorMessage } from '../../api/errors';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Alert, Button, Field, SelectField, TextAreaField } from '../../components/ui';
import { tempId } from '../../data/pending';
import type { FeeDue, Payment, PaymentAllocation, PaymentMode } from '../../data/types';
import { useCoreData, useCoreTables } from '../../data/useCoreData';
import { useInstantWrite, useWrite, type WriteResult } from '../../data/useWrite';
import { addMonths, formatDate, monthLabel, todayIso } from '../../lib/dates';
import { byDueOrder, creditOf, dueNet, dueTitle, isOpenDue, previewAllocation } from '../../lib/ledger';
import { bool, num } from '../../lib/values';
import { useMoney, useReceiptActions } from './feeShared';

const MODES: PaymentMode[] = ['Cash', 'UPI', 'Bank'];

function Footer({ formId, saving, label, danger }: { formId: string; saving: boolean; label: string; danger?: boolean }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" form={formId} loading={saving} variant={danger ? 'danger' : 'primary'}>{label}</Button>
    </div>
  );
}

function ErrorBanner({ error, inline }: { error: unknown; inline: string[] }) {
  if (!error) return null;
  const f = errorField(error);
  if (f && inline.includes(f)) return null;
  return <Alert>{errorMessage(error)}</Alert>;
}

const digits = (v: string) => v.replace(/[^\d]/g, '');

// ---------- Record payment ----------

interface RecordResult extends WriteResult {
  payment_id: string;
  receipt_no: string;
}

/** A payment whose save failed, reopened with the same values and client_ref so a retry cannot record it twice. */
export interface PaymentDraft {
  amount: string;
  mode: PaymentMode;
  paidAt: string;
  notes: string;
  clientRef: string;
  error: string;
}

interface RecordPaymentProps {
  parentId: string;
  draft?: PaymentDraft;
  onClose: () => void;
  /** Called at once with a temporary id; the payment shows while it saves. */
  onRecorded: (paymentId: string) => void;
  /** Called when the server confirms, with the temporary and the real id. */
  onSaved: (tempPaymentId: string, paymentId: string) => void;
  onFailed: (draft: PaymentDraft) => void;
}

export function RecordPaymentSheet({ parentId, draft, onClose, onRecorded, onSaved, onFailed }: RecordPaymentProps) {
  const t = useCoreTables();
  const money = useMoney();
  const recordNow = useInstantWrite<Record<string, unknown>, RecordResult>('payments.record');
  const [clientRef] = useState(() => draft?.clientRef ?? crypto.randomUUID());

  const openDues = useMemo(() => (t?.FeeDues ?? []).filter((d) => d.parent_id === parentId && isOpenDue(d)).sort(byDueOrder), [t, parentId]);
  const outstanding = openDues.reduce((s, d) => s + num(d.balance), 0);
  const [amount, setAmount] = useState(draft?.amount ?? (outstanding ? String(outstanding) : ''));
  const [mode, setMode] = useState<PaymentMode>(draft?.mode ?? 'Cash');
  const [paidAt, setPaidAt] = useState(draft?.paidAt ?? todayIso());
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [choose, setChoose] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<{ field: string; text: string } | null>(null);

  if (!t) return null;
  const value = num(amount);
  const preview = choose
    ? openDues.filter((d) => num(picked[d.id]) > 0).map((d) => ({ due: d, amount: num(picked[d.id]) }))
    : previewAllocation(openDues, value);
  const allocated = preview.reduce((s, p) => s + p.amount, 0);
  const extra = Math.max(0, value - allocated);
  const errorFor = (field: string) => (problem?.field === field ? problem.text : undefined);

  function submit(e: FormEvent) {
    e.preventDefault();
    // Checked here because the sheet closes before the server answers.
    const found = !(value >= 1) ? { field: 'amount', text: 'Enter the amount received' }
      : !paidAt || paidAt > todayIso() ? { field: 'paid_at', text: 'Payment date cannot be in the future' }
      : choose && !preview.length ? { field: 'amount', text: 'Choose at least one due, or switch to Automatic' }
      : null;
    setProblem(found);
    if (found) return;

    const now = new Date().toISOString();
    const stamp = { created_at: now, updated_at: now };
    const paymentId = tempId();
    const payment: Payment = {
      id: paymentId, parent_id: parentId, amount: value, mode, paid_at: paidAt, gateway_payment_id: '', link_id: '',
      receipt_no: '', status: 'Recorded', cancel_reason: '', notes, client_ref: clientRef, ...stamp,
    };
    const dues: FeeDue[] = preview.map(({ due, amount: paid }) => {
      const balance = num(due.balance) - paid;
      return { ...due, amount_paid: num(due.amount_paid) + paid, balance, status: balance <= 0 ? 'Paid' : 'Partial', updated_at: now };
    });
    const allocations: PaymentAllocation[] = preview.map((p) => ({ id: tempId(), payment_id: paymentId, due_id: p.due.id, student_id: p.due.student_id, amount: p.amount, ...stamp }));
    if (extra > 0) allocations.push({ id: tempId(), payment_id: paymentId, due_id: '', student_id: '', amount: extra, ...stamp });

    recordNow(
      {
        parent_id: parentId,
        amount: value,
        mode,
        paid_at: paidAt,
        notes,
        client_ref: clientRef,
        allocations: choose ? preview.map((p) => ({ due_id: p.due.id, amount: p.amount })) : undefined,
      },
      {
        show: { Payments: [payment], FeeDues: dues, PaymentAllocations: allocations },
        previous: { FeeDues: preview.map((p) => p.due) },
        failure: 'Payment not saved',
        onSuccess: (res) => onSaved(paymentId, res.payment_id),
        onError: (err) => onFailed({ amount, mode, paidAt, notes, clientRef, error: errorMessage(err) }),
      },
    );
    onRecorded(paymentId);
  }

  function togglePick(d: FeeDue) {
    setPicked((p) => {
      const next = { ...p };
      if (next[d.id] !== undefined) delete next[d.id];
      else next[d.id] = String(num(d.balance));
      const sum = Object.values(next).reduce((s, v) => s + num(v), 0);
      setAmount(sum ? String(sum) : '');
      return next;
    });
  }

  return (
    <Sheet open title="Record payment" onClose={onClose} footer={<Footer formId="pay-form" saving={false} label={value ? `Record ${money(value)}` : 'Record payment'} />}>
      <form id="pay-form" onSubmit={submit} className="space-y-4">
        {draft?.error && <Alert>Not saved: {draft.error}. Check and record again.</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} error={errorFor('amount')} hint={outstanding ? `Outstanding ${money(outstanding)}` : 'No dues: this becomes an advance'} autoFocus />
          <Field label="Date" type="date" value={paidAt} max={todayIso()} onChange={(e) => setPaidAt(e.target.value)} error={errorFor('paid_at')} />
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Mode</legend>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                className={clsx('min-h-11 rounded-xl border text-sm font-medium', mode === m ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>
                {m}
              </button>
            ))}
          </div>
        </fieldset>

        {openDues.length > 0 && (
          <div className="rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <p className="text-sm font-medium">{choose ? 'Pay these dues' : 'Pays the oldest dues first'}</p>
              <button type="button" className="text-sm font-medium text-primary" onClick={() => { setChoose((c) => !c); setPicked({}); }}>
                {choose ? 'Automatic' : 'Choose dues'}
              </button>
            </div>
            <ul className="divide-y divide-line text-sm">
              {openDues.map((d) => {
                const { title, period } = dueTitle(t, d);
                const student = t.Students.find((s) => s.id === d.student_id)?.name;
                const share = preview.find((p) => p.due.id === d.id);
                return (
                  <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                    {choose && <input type="checkbox" className="size-5 accent-[var(--tenant-primary)]" checked={picked[d.id] !== undefined} onChange={() => togglePick(d)} aria-label={`Pay ${title} ${period}`} />}
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">{student} · {title}</p>
                      <p className="text-xs text-muted">{[period, `due ${formatDate(d.due_date)}`].filter(Boolean).join(' · ')}</p>
                    </div>
                    {choose && picked[d.id] !== undefined ? (
                      <input
                        inputMode="numeric"
                        className="w-24 rounded-lg border border-line px-2 py-1.5 text-right"
                        value={picked[d.id]}
                        aria-label="Amount for this due"
                        onChange={(e) => {
                          const v = digits(e.target.value);
                          setPicked((p) => {
                            const next = { ...p, [d.id]: v };
                            setAmount(String(Object.values(next).reduce((s, x) => s + num(x), 0)));
                            return next;
                          });
                        }}
                      />
                    ) : (
                      <span className={clsx('text-right tabular-nums', share ? 'font-medium text-success' : 'text-muted')}>
                        {share ? money(share.amount) : money(num(d.balance))}
                        {share && share.amount < num(d.balance) && <span className="block text-xs text-muted">of {money(num(d.balance))}</span>}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {extra > 0 && <Alert tone="info">{money(extra)} more than the dues{choose ? ' chosen' : ''}: it is kept as an advance and used for the next dues automatically.</Alert>}

        <TextAreaField label="Note (optional)" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. UPI ref 4521" />
      </form>
    </Sheet>
  );
}

/** Record payment → done sheet, including the id swap when the save is confirmed and reopening on failure. */
export function usePaymentFlow() {
  const [paying, setPaying] = useState<{ parentId: string; draft?: PaymentDraft } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pay = useCallback((parentId: string) => setPaying({ parentId }), []);

  const sheets = (
    <>
      {paying && (
        <RecordPaymentSheet
          key={paying.draft?.clientRef ?? paying.parentId}
          parentId={paying.parentId}
          draft={paying.draft}
          onClose={() => setPaying(null)}
          onRecorded={(id) => { setPaying(null); setDone(id); }}
          onSaved={(temp, id) => setDone((current) => (current === temp ? id : current))}
          onFailed={(draft) => { setDone(null); setPaying({ parentId: paying.parentId, draft }); }}
        />
      )}
      {done && <PaymentDoneSheet paymentId={done} onClose={() => setDone(null)} />}
    </>
  );
  return { pay, sheets };
}

/** Shown after a payment: receipt number and the ways to send it. */
export function PaymentDoneSheet({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const t = useCoreTables();
  const money = useMoney();
  const receipt = useReceiptActions();
  const [busy, setBusy] = useState<string | null>(null);
  const payment = t?.Payments.find((p) => p.id === paymentId);
  const { warmUp } = receipt;
  useEffect(() => {
    if (payment && !payment._pending) warmUp(payment);
  }, [payment, warmUp]);
  if (!payment) return null;
  const saving = !!payment._pending;
  const parent = t?.Parents.find((p) => p.id === payment.parent_id);
  const run = (key: string, fn: (p: Payment) => Promise<void>) => async () => {
    setBusy(key);
    await fn(payment);
    setBusy(null);
  };

  return (
    <Sheet open title="Payment recorded" onClose={onClose} footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Done</Button></div>}>
      <div className="flex flex-col items-center gap-1 py-2 text-center">
        <CheckCircle2 className="size-12 text-success" aria-hidden />
        <p className="text-2xl font-semibold">{money(num(payment.amount))}</p>
        <p className="text-sm text-muted">{parent?.guardian_name} · {payment.mode} · {formatDate(payment.paid_at)}</p>
        <p className="mt-1 rounded-full bg-primary-soft px-3 py-1 text-sm font-medium text-primary">{saving ? 'Saving… receipt number in a moment' : `Receipt ${payment.receipt_no}`}</p>
      </div>
      <div className="mt-4 grid gap-2">
        <Button onClick={run('share', receipt.share)} disabled={saving} loading={busy === 'share'}><Share2 className="size-4" aria-hidden /> Share receipt</Button>
        <Button variant="secondary" onClick={run('wa', receipt.sendWhatsApp)} disabled={saving} loading={busy === 'wa'}><MessageCircle className="size-4" aria-hidden /> Send link on WhatsApp</Button>
        <Button variant="ghost" onClick={run('open', receipt.open)} disabled={saving} loading={busy === 'open'}><ExternalLink className="size-4" aria-hidden /> View receipt</Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted">Share sends the receipt as a PDF file. It is prepared after the payment saves and can take a few seconds.</p>
    </Sheet>
  );
}

// ---------- Adjust a due ----------

type AdjustMode = 'discount' | 'prorate' | 'extra' | 'waive' | 'remove';

export function AdjustDueSheet({ due, onClose }: { due: FeeDue; onClose: () => void }) {
  const t = useCoreTables();
  const money = useMoney();
  const toast = useToast();
  const adjust = useWrite('dues.adjust');
  const remove = useWrite('dues.remove');
  const paid = num(due.amount_paid);
  const [mode, setMode] = useState<AdjustMode>('discount');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  if (!t) return null;
  const { title, period } = dueTitle(t, due);

  const suggestion = (() => {
    if (due.kind !== 'Recurring') return null;
    const start = String(due.period_start);
    const day = Number(start.slice(8, 10));
    if (day <= 1) return null;
    const [y, m] = start.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const months = Math.max(1, Math.round((Date.parse(`${String(due.period_end).slice(0, 7)}-01`) - Date.parse(`${start.slice(0, 7)}-01`)) / (30.44 * 86_400_000)) + 1);
    const perMonth = num(due.amount_due) / months;
    return Math.round(perMonth * ((days - day + 1) / days) + perMonth * (months - 1));
  })();

  const options: { key: AdjustMode; label: string; show: boolean }[] = [
    { key: 'discount', label: 'Discount', show: true },
    { key: 'prorate', label: 'Change amount', show: true },
    { key: 'extra', label: 'Add extra', show: true },
    { key: 'waive', label: 'Waive', show: isOpenDue(due) },
    { key: 'remove', label: 'Remove', show: paid === 0 },
  ];

  function submit(e: FormEvent) {
    e.preventDefault();
    const done = (msg: string) => () => { toast(msg); onClose(); };
    if (mode === 'remove') return remove.mutate({ id: due.id, note }, { onSuccess: done('Due removed') });
    const payload: Record<string, unknown> = { id: due.id, note };
    if (mode === 'discount') payload.discount = num(due.discount) + num(value);
    if (mode === 'prorate') payload.amount_due = num(value);
    if (mode === 'extra') payload.adjustment = num(due.adjustment) + num(value);
    if (mode === 'waive') payload.waive = true;
    adjust.mutate(payload, { onSuccess: done(mode === 'waive' ? 'Due waived' : 'Due updated') });
  }

  const err = adjust.error ?? remove.error;
  return (
    <Sheet open title={`${title}${period ? ` · ${period}` : ''}`} onClose={onClose}
      footer={<Footer formId="adjust-form" saving={adjust.isPending || remove.isPending} label={mode === 'remove' ? 'Remove due' : mode === 'waive' ? 'Waive balance' : 'Save'} danger={mode === 'remove'} />}>
      <form id="adjust-form" onSubmit={submit} className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-canvas p-3 text-sm">
          <dt className="text-muted">Amount</dt><dd className="text-right">{money(num(due.amount_due))}{bool(due.prorated) && ' (changed)'}</dd>
          {num(due.discount) > 0 && <><dt className="text-muted">Discount</dt><dd className="text-right">−{money(num(due.discount))}</dd></>}
          {num(due.adjustment) !== 0 && <><dt className="text-muted">Extra</dt><dd className="text-right">{money(num(due.adjustment))}</dd></>}
          <dt className="text-muted">Paid</dt><dd className="text-right">{money(paid)}</dd>
          <dt className="font-medium">Balance</dt><dd className="text-right font-medium">{money(num(due.balance))}</dd>
        </dl>
        <div className="flex flex-wrap gap-2" role="tablist">
          {options.filter((o) => o.show).map((o) => (
            <button key={o.key} type="button" role="tab" aria-selected={mode === o.key} onClick={() => { setMode(o.key); setValue(''); }}
              className={clsx('min-h-10 rounded-full border px-3.5 text-sm font-medium', mode === o.key ? 'border-primary bg-primary text-white' : 'border-line')}>
              {o.label}
            </button>
          ))}
        </div>
        {mode === 'discount' && <Field label="Discount amount" inputMode="numeric" value={value} onChange={(e) => setValue(digits(e.target.value))} error={fieldError(err, 'discount')} />}
        {mode === 'prorate' && (
          <Field label="New amount" inputMode="numeric" value={value} onChange={(e) => setValue(digits(e.target.value))} error={fieldError(err, 'amount_due')}
            hint={suggestion !== null ? `Joined mid-period: about ${money(suggestion)} for the days attended` : 'For example a part-month fee'} />
        )}
        {mode === 'prorate' && suggestion !== null && !value && (
          <Button type="button" variant="ghost" className="-mt-2 min-h-9 px-0" onClick={() => setValue(String(suggestion))}>Use {money(suggestion)}</Button>
        )}
        {mode === 'extra' && <Field label="Extra amount (use − to reduce)" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, ''))} error={fieldError(err, 'adjustment')} />}
        {mode === 'waive' && <Alert tone="warning">The remaining {money(num(due.balance))} will not be collected.</Alert>}
        {mode === 'remove' && <Alert tone="warning">Use this for a due created by mistake (for example the wrong fee plan). It can be generated again.</Alert>}
        <Field label={mode === 'remove' ? 'Reason' : 'Note'} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'discount' ? 'e.g. Sibling discount' : mode === 'prorate' ? 'e.g. Joined on 15th' : 'Why?'} error={fieldError(err, 'note')} />
        {dueNet(due) !== num(due.amount_due) && due.notes && <p className="whitespace-pre-line text-xs text-muted">{due.notes}</p>}
        <ErrorBanner error={err} inline={['note', 'discount', 'amount_due', 'adjustment']} />
      </form>
    </Sheet>
  );
}

// ---------- One-time charge ----------

export function AddChargeSheet({ parentId, studentId, onClose }: { parentId: string; studentId?: string; onClose: () => void }) {
  const t = useCoreTables();
  const toast = useToast();
  const add = useWrite('dues.addCharge');
  const children = (t?.Students ?? []).filter((s) => s.parent_id === parentId);
  const items = (t?.ChargeItems ?? []).filter((c) => bool(c.active));
  const [v, setV] = useState({ student_id: studentId ?? children[0]?.id ?? '', charge_item_id: items[0]?.id ?? '', label: '', amount: items[0]?.default_amount ? String(items[0].default_amount) : '', due_date: todayIso(), note: '' });

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate({ ...v, charge_item_id: v.charge_item_id === 'custom' ? '' : v.charge_item_id }, { onSuccess: () => { toast('Charge added'); onClose(); } });
  }

  return (
    <Sheet open title="Add a charge" onClose={onClose} footer={<Footer formId="charge-form" saving={add.isPending} label="Add charge" />}>
      <form id="charge-form" onSubmit={submit} className="space-y-4">
        {children.length > 1 && (
          <SelectField label="For" value={v.student_id} onChange={(e) => setV({ ...v, student_id: e.target.value })}>
            {children.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
        )}
        <SelectField label="Charge" value={v.charge_item_id} onChange={(e) => {
          const item = items.find((i) => i.id === e.target.value);
          setV({ ...v, charge_item_id: e.target.value, amount: item?.default_amount ? String(item.default_amount) : v.amount });
        }}>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          <option value="custom">Something else…</option>
        </SelectField>
        {v.charge_item_id === 'custom' && <Field label="Name" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} error={fieldError(add.error, 'label')} placeholder="e.g. Exam fee" />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" inputMode="numeric" value={v.amount} onChange={(e) => setV({ ...v, amount: digits(e.target.value) })} error={fieldError(add.error, 'amount')} />
          <Field label="Due on" type="date" value={v.due_date} onChange={(e) => setV({ ...v, due_date: e.target.value })} error={fieldError(add.error, 'due_date')} />
        </div>
        <Field label="Note (optional)" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        <ErrorBanner error={add.error} inline={['label', 'amount', 'due_date']} />
      </form>
    </Sheet>
  );
}

// ---------- Generate dues ----------

interface GenerateResult extends WriteResult {
  month: string;
  created: number;
  total: number;
  skipped: { enrollment_id: string; student: string; course: string; reason: string }[];
}

export function GenerateDuesSheet({ onClose }: { onClose: () => void }) {
  const money = useMoney();
  const toast = useToast();
  const generate = useWrite<Record<string, unknown>, GenerateResult>('dues.generate');
  const preview = useWrite<Record<string, unknown>, GenerateResult>('dues.generate');
  const thisMonth = todayIso().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const p = preview.data;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!p || p.month !== month) {
      preview.mutate({ month, dryRun: true });
      return;
    }
    generate.mutate({ month }, {
      onSuccess: (res) => { toast(res.created ? `${res.created} dues created for ${monthLabel(month)}` : `Nothing new to bill for ${monthLabel(month)}`); onClose(); },
    });
  }

  const ready = p && p.month === month;
  return (
    <Sheet open title="Generate dues" onClose={onClose} footer={<Footer formId="gen-form" saving={generate.isPending || preview.isPending} label={ready ? `Create ${p.created} dues` : 'Preview'} />}>
      <form id="gen-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">Dues are created automatically on the 1st of every month. Use this to bill a month now or catch up a missed one. It never bills the same period twice.</p>
        <SelectField label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
          {[-3, -2, -1, 0, 1].map((n) => {
            const m = addMonths(thisMonth, n);
            return <option key={m} value={m}>{monthLabel(m)}{n === 0 ? ' (this month)' : ''}</option>;
          })}
        </SelectField>
        {ready && (
          <div className="space-y-2">
            <Alert tone={p.created ? 'info' : 'success'}>
              {p.created ? <>{p.created} new dues totalling <strong>{money(p.total)}</strong>.</> : 'Every active enrolment is already billed for this month.'}
            </Alert>
            {p.skipped.length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
                <p className="mb-1 font-medium text-warning">Skipped {p.skipped.length}</p>
                <ul className="space-y-0.5 text-muted">
                  {p.skipped.slice(0, 8).map((s) => <li key={s.enrollment_id}>{s.student} · {s.course}: {s.reason}</li>)}
                  {p.skipped.length > 8 && <li>…and {p.skipped.length - 8} more</li>}
                </ul>
              </div>
            )}
          </div>
        )}
        <ErrorBanner error={generate.error ?? preview.error} inline={[]} />
      </form>
    </Sheet>
  );
}

// ---------- Cancel payment ----------

export function CancelPaymentSheet({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const money = useMoney();
  const toast = useToast();
  const { data } = useCoreData();
  const cancel = useWrite('payments.cancel');
  const [reason, setReason] = useState('');
  const credit = data ? creditOf(data.tables, payment.parent_id) : 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    cancel.mutate({ id: payment.id, reason }, { onSuccess: () => { toast(`Receipt ${payment.receipt_no} cancelled`); onClose(); } });
  }

  return (
    <Sheet open title={`Cancel ${payment.receipt_no}`} onClose={onClose} footer={<Footer formId="cancel-form" saving={cancel.isPending} label="Cancel payment" danger />}>
      <form id="cancel-form" onSubmit={submit} className="space-y-4">
        <Alert tone="warning">
          {money(num(payment.amount))} received on {formatDate(payment.paid_at)} will be reversed. The dues it paid reopen{credit > 0 ? ' and its unused advance is removed' : ''}. The receipt is kept and marked cancelled.
        </Alert>
        <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice, cheque bounced" error={fieldError(cancel.error, 'reason')} />
        <ErrorBanner error={cancel.error} inline={['reason']} />
      </form>
    </Sheet>
  );
}
