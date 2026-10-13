import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/errors';
import { errorField, fieldError } from '../../api/fieldErrors';
import { useAuth } from '../../auth/AuthContext';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Alert, Button, EmptyState, Field, SelectField } from '../../components/ui';
import type { BalanceItem, CoreData, Settings } from '../../data/types';
import { coreKey, useCoreData } from '../../data/useCoreData';
import { useWrite } from '../../data/useWrite';
import { formatDate, todayIso } from '../../lib/dates';
import { isDeleted, num } from '../../lib/values';
import { useTenant } from '../../tenant/TenantContext';
import { useMoney } from '../fees/feeShared';

/** Manual balance-sheet lines (bank balance, equipment, deposits, loans) and the date cash is counted from. */
export function BalanceItemsSheet({ onClose }: { onClose: () => void }) {
  const { data } = useCoreData();
  const money = useMoney();
  const [editing, setEditing] = useState<BalanceItem | 'new' | null>(null);
  const items = (data?.tables.BalanceItems ?? []).filter((b) => !isDeleted(b)).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  if (editing) return <ItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />;

  return (
    <Sheet open title="Assets & loans" onClose={onClose}
      footer={<div className="flex justify-between gap-2"><Button variant="secondary" onClick={onClose}>Done</Button><Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add</Button></div>}>
      <StartDate settings={data?.settings ?? {}} />
      {items.length === 0 ? (
        <EmptyState title="Nothing added yet">Add the bank balance on the start date, equipment, rent deposit, or any loan.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {items.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => setEditing(b)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{b.name}</p>
                  <p className="text-xs text-muted">{b.type === 'Asset' ? 'Owns' : 'Owes'}{b.as_of_date && ` · as of ${formatDate(b.as_of_date)}`}</p>
                </div>
                <span className="font-medium tabular-nums">{money(num(b.amount))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function StartDate({ settings }: { settings: Settings }) {
  const tenant = useTenant();
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(settings.opening_balances_date ?? '');
  const save = useMutation({
    mutationFn: (date: string) => api<Settings>('settings.update', { opening_balances_date: date }),
    onSuccess: (next) => {
      queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? { ...old, settings: next } : old));
      toast('Start date saved');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(value); }} className="mb-4 flex items-end gap-2">
      <Field label="Count fees and expenses from" type="date" className="flex-1" max={todayIso()} value={value} onChange={(e) => setValue(e.target.value)}
        hint="Usually the day your opening bank balance is from. Blank = all time." />
      <Button type="submit" variant="secondary" className="mb-5" loading={save.isPending} disabled={value === (settings.opening_balances_date ?? '')}>Save</Button>
    </form>
  );
}

function ItemForm({ item, onClose }: { item: BalanceItem | null; onClose: () => void }) {
  const toast = useToast();
  const save = useWrite('catalog.save');
  const remove = useWrite('catalog.delete');
  const [v, setV] = useState({
    type: item?.type ?? 'Asset',
    name: item?.name ?? '',
    amount: item ? String(num(item.amount)) : '',
    as_of_date: item?.as_of_date ?? todayIso(),
    notes: item?.notes ?? '',
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));
  const err = save.error ?? remove.error;

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ tab: 'BalanceItems', row: { id: item?.id, ...v } }, { onSuccess: () => { toast('Saved'); onClose(); } });
  }

  function del() {
    if (!item || !window.confirm(`Delete "${item.name}"?`)) return;
    remove.mutate({ tab: 'BalanceItems', id: item.id }, { onSuccess: () => { toast('Deleted'); onClose(); } });
  }

  return (
    <Sheet open title={item ? item.name : 'Add asset or loan'} onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          {item ? <Button type="button" variant="ghost" className="text-danger" loading={remove.isPending} onClick={del}><Trash2 className="size-4" aria-hidden /> Delete</Button> : <span />}
          <Button type="submit" form="balance-form" loading={save.isPending}>Save</Button>
        </div>
      }>
      <form id="balance-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Type" value={v.type} onChange={(e) => set('type', e.target.value as BalanceItem['type'])} error={fieldError(err, 'type')}>
          <option value="Asset">Asset (the academy owns it)</option>
          <option value="Liability">Liability (the academy owes it)</option>
        </SelectField>
        <Field label="Name" placeholder={v.type === 'Asset' ? 'e.g. Bank balance, Mats and equipment' : 'e.g. Equipment loan'} value={v.name} onChange={(e) => set('name', e.target.value)} error={fieldError(err, 'name')} />
        <Field label="Amount" inputMode="decimal" value={v.amount} onChange={(e) => set('amount', e.target.value.replace(/[^\d.]/g, ''))} error={fieldError(err, 'amount')} />
        <Field label="As of" type="date" value={v.as_of_date} onChange={(e) => set('as_of_date', e.target.value)} error={fieldError(err, 'as_of_date')} />
        <Field label="Notes (optional)" className="sm:col-span-2" value={v.notes} onChange={(e) => set('notes', e.target.value)} error={fieldError(err, 'notes')} />
        {err && !['type', 'name', 'amount', 'as_of_date', 'notes'].includes(errorField(err) ?? '') && <div className="sm:col-span-2"><Alert>{errorMessage(err)}</Alert></div>}
      </form>
    </Sheet>
  );
}
