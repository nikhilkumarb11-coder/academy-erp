import { ChevronLeft, ChevronRight, Plus, Repeat, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ExportButton } from '../../components/ExportButton';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { useCoreData } from '../../data/useCoreData';
import { addMonths, formatDate, monthLabel, todayIso } from '../../lib/dates';
import { bool, isDeleted, num } from '../../lib/values';
import { useMoney } from '../fees/feeShared';
import { CategoriesSheet, ExpenseSheet, RecurringSheet, useExpenseCategories, type ExpenseDraft } from './ExpenseSheets';

type Open = { kind: 'expense'; draft: ExpenseDraft } | { kind: 'categories' } | { kind: 'recurring' } | null;

export function ExpensesPage() {
  const { data, isPending } = useCoreData();
  const money = useMoney();
  const categories = useExpenseCategories();
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [open, setOpen] = useState<Open>(null);

  const view = useMemo(() => {
    if (!data) return null;
    const t = data.tables;
    const rows = t.Expenses.filter((e) => !isDeleted(e) && e.date.slice(0, 7) === month)
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    const total = rows.reduce((s, e) => s + num(e.amount), 0);
    const prevMonth = addMonths(month, -1);
    const prevTotal = t.Expenses.filter((e) => !isDeleted(e) && e.date.slice(0, 7) === prevMonth).reduce((s, e) => s + num(e.amount), 0);
    const byCategory = new Map<string, number>();
    rows.forEach((e) => byCategory.set(e.category_id, (byCategory.get(e.category_id) ?? 0) + num(e.amount)));
    const split = [...byCategory.entries()].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount);
    const recorded = new Set(t.Expenses.map((e) => e.ref_id).filter(Boolean));
    const due = month > thisMonth ? [] : t.RecurringExpenses
      .filter((r) => !isDeleted(r) && bool(r.active) && !bool(r.auto_create) && !recorded.has(`${r.id}:${month}`))
      .sort((a, b) => num(a.day_of_month) - num(b.day_of_month));
    return { rows, total, prevTotal, split, due, recurringCount: t.RecurringExpenses.filter((r) => !isDeleted(r)).length };
  }, [data, month, thisMonth]);

  if (isPending || !view) return <Spinner />;
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Other';
  const max = Math.max(1, ...view.split.map((s) => s.amount));

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Where the money goes"
        actions={<><ExportButton list="expenses" /><Button onClick={() => setOpen({ kind: 'expense', draft: {} })}><Plus className="size-4" aria-hidden /> Record expense</Button></>}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-xl border border-line bg-surface">
          <button type="button" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))} className="grid size-11 place-items-center text-muted hover:text-primary"><ChevronLeft className="size-5" aria-hidden /></button>
          <span className="min-w-32 text-center font-medium">{monthLabel(month)}</span>
          <button type="button" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth((m) => addMonths(m, 1))} className="grid size-11 place-items-center text-muted hover:text-primary disabled:opacity-30"><ChevronRight className="size-5" aria-hidden /></button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setOpen({ kind: 'recurring' })}><Repeat className="size-4" aria-hidden /> Recurring{view.recurringCount ? ` (${view.recurringCount})` : ''}</Button>
          <Button variant="ghost" onClick={() => setOpen({ kind: 'categories' })}><Tags className="size-4" aria-hidden /> Categories</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-4">
          <Card>
            <p className="text-sm text-muted">Spent in {monthLabel(month)}</p>
            <p className="text-3xl font-semibold text-primary">{money(view.total)}</p>
            <p className="mt-1 text-xs text-muted">{monthLabel(addMonths(month, -1))}: {money(view.prevTotal)}</p>
            {view.split.length > 0 && (
              <ul className="mt-4 space-y-2.5">
                {view.split.map((s) => (
                  <li key={s.id} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="break-words">{catName(s.id)}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-primary-soft">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${(s.amount / max) * 100}%` }} />
                    </span>
                    <span className="text-right font-medium tabular-nums">{money(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {view.due.length > 0 && (
            <Card>
              <h2 className="mb-2 font-semibold">Due this month</h2>
              <ul className="divide-y divide-line">
                {view.due.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">{r.payee}</p>
                      <p className="text-xs text-muted">{catName(r.category_id)} · day {num(r.day_of_month)} · {money(num(r.amount))}</p>
                    </div>
                    <Button variant="secondary" className="min-h-9" onClick={() => setOpen({ kind: 'expense', draft: { from: r, month } })}>Record</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="!p-0">
          {view.rows.length === 0 ? (
            <EmptyState title={`No expenses in ${monthLabel(month)}`}
              action={<Button variant="secondary" onClick={() => setOpen({ kind: 'expense', draft: {} })}><Plus className="size-4" aria-hidden /> Record expense</Button>} />
          ) : (
            <ul className="divide-y divide-line">
              {view.rows.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setOpen({ kind: 'expense', draft: { expense: e } })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">{e.payee || catName(e.category_id)}</p>
                      <p className="break-words text-xs text-muted">
                        {formatDate(e.date)} · {catName(e.category_id)} · {e.mode}
                        {e.source === 'Recurring' && <Repeat className="ml-1 inline size-3" aria-label="recurring" />}
                        {e.notes && ` · ${e.notes}`}
                      </p>
                    </div>
                    <span className="font-medium tabular-nums">{money(num(e.amount))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {open?.kind === 'expense' && <ExpenseSheet draft={open.draft} onClose={() => setOpen(null)} />}
      {open?.kind === 'categories' && <CategoriesSheet onClose={() => setOpen(null)} />}
      {open?.kind === 'recurring' && <RecurringSheet onClose={() => setOpen(null)} />}
    </>
  );
}
