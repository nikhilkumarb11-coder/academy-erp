import { Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/errors';
import { errorField, fieldError } from '../../api/fieldErrors';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Alert, Button, EmptyState, Field, SelectField, TextAreaField, Toggle } from '../../components/ui';
import { EXPENSE_MODES, type Expense, type ExpenseCategory, type ExpenseMode, type RecurringExpense } from '../../data/types';
import { useCoreTables } from '../../data/useCoreData';
import { useWrite } from '../../data/useWrite';
import { todayIso } from '../../lib/dates';
import { bool, isDeleted, num } from '../../lib/values';
import { bySortOrder } from '../courses/catalogHooks';
import { useMoney } from '../fees/feeShared';

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const digitsOnly = (s: string) => s.replace(/[^\d.]/g, '');

export function useExpenseCategories(): ExpenseCategory[] {
  const t = useCoreTables();
  return (t?.ExpenseCategories ?? []).filter((c) => !isDeleted(c)).sort(bySortOrder);
}

function DeleteFooter({ formId, saving, onDelete, deleting }: { formId: string; saving: boolean; onDelete?: () => void; deleting?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      {onDelete ? (
        <Button type="button" variant="ghost" className="text-danger" loading={deleting} onClick={onDelete}><Trash2 className="size-4" aria-hidden /> Delete</Button>
      ) : <span />}
      <Button type="submit" form={formId} loading={saving}>Save</Button>
    </div>
  );
}

export interface ExpenseDraft {
  expense?: Expense;
  /** Prefill from a recurring template that is not auto-created. */
  from?: RecurringExpense;
  month?: string;
}

export function ExpenseSheet({ draft, onClose }: { draft: ExpenseDraft; onClose: () => void }) {
  const categories = useExpenseCategories();
  const toast = useToast();
  const save = useWrite('expenses.save');
  const remove = useWrite('expenses.delete');
  const { expense, from } = draft;
  const today = todayIso();
  const defaultDate = from && draft.month ? `${draft.month}-${String(num(from.day_of_month, 1)).padStart(2, '0')}` : today;
  const [v, setV] = useState({
    date: expense?.date ?? (defaultDate > today ? today : defaultDate),
    category_id: expense?.category_id ?? from?.category_id ?? categories[0]?.id ?? '',
    amount: str(expense?.amount ?? from?.amount),
    mode: (expense?.mode ?? 'Cash') as ExpenseMode,
    payee: expense?.payee ?? from?.payee ?? '',
    notes: expense?.notes ?? from?.notes ?? '',
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));
  const err = save.error ?? remove.error;
  const inline = ['date', 'category_id', 'amount', 'mode', 'payee', 'notes'];

  function submit(e: FormEvent) {
    e.preventDefault();
    const refId = from && draft.month ? `${from.id}:${draft.month}` : undefined;
    save.mutate({ row: { id: expense?.id, ...v, ref_id: refId } }, {
      onSuccess: () => { toast(expense ? 'Expense updated' : 'Expense recorded'); onClose(); },
    });
  }

  function del() {
    if (!expense || !window.confirm('Delete this expense?')) return;
    remove.mutate({ id: expense.id }, { onSuccess: () => { toast('Expense deleted'); onClose(); } });
  }

  return (
    <Sheet open title={expense ? 'Edit expense' : 'Record expense'} onClose={onClose}
      footer={<DeleteFooter formId="expense-form" saving={save.isPending} deleting={remove.isPending} onDelete={expense ? del : undefined} />}>
      <form id="expense-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" inputMode="decimal" value={v.amount} onChange={(e) => set('amount', digitsOnly(e.target.value))} autoFocus={!expense} error={fieldError(err, 'amount')} />
        <Field label="Date" type="date" value={v.date} max={today} onChange={(e) => set('date', e.target.value)} error={fieldError(err, 'date')} />
        <SelectField label="Category" value={v.category_id} onChange={(e) => set('category_id', e.target.value)} error={fieldError(err, 'category_id')}>
          {!v.category_id && <option value="">Choose…</option>}
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <SelectField label="Paid by" value={v.mode} onChange={(e) => set('mode', e.target.value as ExpenseMode)} error={fieldError(err, 'mode')}>
          {EXPENSE_MODES.map((m) => <option key={m}>{m}</option>)}
        </SelectField>
        <Field label="Paid to (optional)" className="sm:col-span-2" placeholder="e.g. Landlord, coach name, shop" value={v.payee} onChange={(e) => set('payee', e.target.value)} error={fieldError(err, 'payee')} />
        <TextAreaField label="Notes (optional)" className="sm:col-span-2" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} error={fieldError(err, 'notes')} />
        {expense?.source === 'Recurring' && <p className="text-xs text-muted sm:col-span-2"><Repeat className="mr-1 inline size-3.5" aria-hidden />Added from a recurring expense.</p>}
        {err && !inline.includes(errorField(err) ?? '') && <div className="sm:col-span-2"><Alert>{errorMessage(err)}</Alert></div>}
      </form>
    </Sheet>
  );
}

/** Add, rename and delete expense categories. */
export function CategoriesSheet({ onClose }: { onClose: () => void }) {
  const categories = useExpenseCategories();
  const toast = useToast();
  const save = useWrite('catalog.save');
  const remove = useWrite('catalog.delete');
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const onError = (err: unknown) => toast(errorMessage(err), 'error');

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate({ tab: 'ExpenseCategories', row: { name: name.trim() } }, { onSuccess: () => setName(''), onError });
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    if (!renaming?.name.trim()) return;
    save.mutate({ tab: 'ExpenseCategories', row: { id: renaming.id, name: renaming.name.trim() } }, { onSuccess: () => setRenaming(null), onError });
  }

  return (
    <Sheet open title="Expense categories" onClose={onClose} footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Done</Button></div>}>
      <form onSubmit={add} className="mb-4 flex items-end gap-2">
        <Field label="New category" className="flex-1" placeholder="e.g. Equipment" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <Button type="submit" loading={save.isPending && !renaming} disabled={!name.trim()}><Plus className="size-4" aria-hidden /> Add</Button>
      </form>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
            {renaming?.id === c.id ? (
              <form onSubmit={rename} className="flex flex-1 items-center gap-2">
                <input aria-label="Category name" autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} maxLength={60}
                  className="min-h-10 flex-1 rounded-lg border border-line px-2 outline-none focus:border-primary" />
                <Button type="submit" className="min-h-10" loading={save.isPending}>Save</Button>
              </form>
            ) : (
              <>
                <span className="flex-1 break-words">{c.name}</span>
                <button type="button" aria-label={`Rename ${c.name}`} onClick={() => setRenaming({ id: c.id, name: c.name })}
                  className="grid size-10 place-items-center rounded-xl text-muted hover:bg-primary-soft hover:text-primary"><Pencil className="size-4" aria-hidden /></button>
                <button type="button" aria-label={`Delete ${c.name}`} disabled={remove.isPending}
                  onClick={() => window.confirm(`Delete "${c.name}"?`) && remove.mutate({ tab: 'ExpenseCategories', id: c.id }, { onError })}
                  className="grid size-10 place-items-center rounded-xl text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="size-4" aria-hidden /></button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Monthly fixed costs: rent, salaries, internet. Auto ones are added on their day; others show up as "due" to record. */
export function RecurringSheet({ onClose }: { onClose: () => void }) {
  const t = useCoreTables();
  const money = useMoney();
  const categories = useExpenseCategories();
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);
  const rows = (t?.RecurringExpenses ?? []).filter((r) => !isDeleted(r)).sort((a, b) => num(a.day_of_month) - num(b.day_of_month));
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';

  if (editing) return <RecurringForm row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />;

  return (
    <Sheet open title="Recurring expenses" onClose={onClose}
      footer={<div className="flex justify-between gap-2"><Button variant="secondary" onClick={onClose}>Done</Button><Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add</Button></div>}>
      {rows.length === 0 ? (
        <EmptyState title="No recurring expenses">Add rent, salaries or bills that repeat every month, so they are never missed.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setEditing(r)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{r.payee} <span className="font-normal text-muted">· {catName(r.category_id)}</span></p>
                  <p className="text-xs text-muted">
                    Day {num(r.day_of_month)} of every month · {bool(r.auto_create) ? 'added automatically' : 'record by hand'}
                    {!bool(r.active) && ' · paused'}
                  </p>
                </div>
                <span className="font-medium tabular-nums">{money(num(r.amount))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function RecurringForm({ row, onClose }: { row: RecurringExpense | null; onClose: () => void }) {
  const categories = useExpenseCategories();
  const toast = useToast();
  const save = useWrite('catalog.save');
  const remove = useWrite('catalog.delete');
  const [v, setV] = useState({
    category_id: row?.category_id ?? categories[0]?.id ?? '',
    amount: str(row?.amount),
    payee: row?.payee ?? '',
    day_of_month: str(row?.day_of_month ?? 1),
    auto_create: row ? bool(row.auto_create) : true,
    active: row ? bool(row.active) : true,
    notes: row?.notes ?? '',
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));
  const err = save.error ?? remove.error;

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ tab: 'RecurringExpenses', row: { id: row?.id, ...v } }, { onSuccess: () => { toast('Recurring expense saved'); onClose(); } });
  }

  function del() {
    if (!row || !window.confirm(`Stop and delete the recurring expense for ${row.payee}? Expenses already recorded stay.`)) return;
    remove.mutate({ tab: 'RecurringExpenses', id: row.id }, { onSuccess: () => { toast('Recurring expense deleted'); onClose(); } });
  }

  return (
    <Sheet open title={row ? 'Edit recurring expense' : 'New recurring expense'} onClose={onClose}
      footer={<DeleteFooter formId="recurring-form" saving={save.isPending} deleting={remove.isPending} onDelete={row ? del : undefined} />}>
      <form id="recurring-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid to" placeholder="e.g. Landlord" value={v.payee} onChange={(e) => set('payee', e.target.value)} error={fieldError(err, 'payee')} />
        <Field label="Amount" inputMode="decimal" value={v.amount} onChange={(e) => set('amount', digitsOnly(e.target.value))} error={fieldError(err, 'amount')} />
        <SelectField label="Category" value={v.category_id} onChange={(e) => set('category_id', e.target.value)} error={fieldError(err, 'category_id')}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <SelectField label="Day of the month" value={v.day_of_month} onChange={(e) => set('day_of_month', e.target.value)} error={fieldError(err, 'day_of_month')}>
          {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </SelectField>
        <div className="sm:col-span-2">
          <Toggle checked={v.auto_create} onChange={(x) => set('auto_create', x)} label="Add it automatically every month" />
          <p className="text-xs text-muted">{v.auto_create ? 'Recorded as paid by bank on that day. Edit it if the amount changes.' : 'It shows up under "Due this month" for you to record.'}</p>
        </div>
        {row && <Toggle checked={v.active} onChange={(x) => set('active', x)} label="Active" />}
        <TextAreaField label="Notes (optional)" className="sm:col-span-2" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} error={fieldError(err, 'notes')} />
        {err && !['payee', 'amount', 'category_id', 'day_of_month', 'notes'].includes(errorField(err) ?? '') && <div className="sm:col-span-2"><Alert>{errorMessage(err)}</Alert></div>}
      </form>
    </Sheet>
  );
}
