/**
 * Expenses (PRD §6.8). Categories, recurring templates and balance items are saved through catalog.save.
 * Recurring templates with auto_create add one expense per month on their day; ref_id "<template>:<yyyy-MM>"
 * keeps that idempotent, and a deleted auto-entry is not recreated.
 */
const ExpensesApi = (() => {
  function fields(m) {
    const category = Db.find('ExpenseCategories', m.category_id);
    if (!category || Db.isDeleted(category)) Validate.fail('category_id', 'Choose a category');
    return {
      date: Validate.date(m.date, 'date', { required: true, label: 'Date' }),
      category_id: category.id,
      amount: Validate.number(m.amount, 'amount', { required: true, min: 1, max: 100000000, label: 'Amount' }),
      mode: Validate.oneOf(m.mode || 'Cash', 'mode', STATUS.expenseMode, { label: 'Paid by' }),
      payee: Validate.text(m.payee, 'payee', { max: 80, label: 'Paid to' }),
      notes: Validate.text(m.notes, 'notes', { max: 300, label: 'Notes' }),
    };
  }

  /** expenses.save { row: { id?, date, category_id, amount, mode, payee, notes, ref_id? } } */
  function save(payload, ctx) {
    const input = payload.row || {};
    return Db.withLock(() => {
      let existing = null;
      if (input.id) {
        existing = Db.find('Expenses', input.id);
        if (!existing || Db.isDeleted(existing)) throw new AppError('NOT_FOUND', 'Expense not found');
      }
      const clean = fields(Object.assign({ date: Util.today() }, existing || {}, input));
      let saved;
      if (existing) {
        saved = Db.update('Expenses', [Object.assign({ id: existing.id }, clean)])[0];
      } else {
        const refId = Validate.text(input.ref_id, 'ref_id', { max: 60 });
        if (refId && Db.all('Expenses', { includeDeleted: true }).some((e) => e.ref_id === refId)) {
          throw new AppError('CONFLICT', 'This recurring expense is already recorded for the month');
        }
        saved = Db.insert('Expenses', [Object.assign(clean, { source: refId ? 'Recurring' : 'Manual', ref_id: refId })], 'EXP')[0];
      }
      Audit.log(existing ? 'expense.update' : 'expense.create', 'Expenses', saved.id, `${clean.date} ${clean.amount} ${clean.payee}`, ctx);
      return { changes: { Expenses: [saved] } };
    });
  }

  function remove(payload, ctx) {
    Util.requireFields(payload, ['id']);
    return Db.withLock(() => {
      const row = Db.find('Expenses', payload.id);
      if (!row || Db.isDeleted(row)) throw new AppError('NOT_FOUND', 'Expense not found');
      const saved = Db.softDelete('Expenses', [row.id]);
      Audit.log('expense.delete', 'Expenses', row.id, `${row.date} ${row.amount} ${row.payee}`, ctx);
      return { changes: { Expenses: saved } };
    });
  }

  const pad = (n) => String(n).padStart(2, '0');

  /** Creates this month's auto expenses whose day has come. Returns the inserted rows. */
  function runRecurring(today) {
    const month = today.slice(0, 7);
    const day = Number(today.slice(8, 10));
    const taken = new Set(Db.all('Expenses', { includeDeleted: true }).map((e) => e.ref_id).filter(Boolean));
    const rows = Db.all('RecurringExpenses')
      .filter((r) => Validate.bool(r.active) && Validate.bool(r.auto_create) && Number(r.day_of_month) <= day && !taken.has(`${r.id}:${month}`))
      .filter((r) => { const c = Db.find('ExpenseCategories', r.category_id); return c && !Db.isDeleted(c); })
      .map((r) => ({
        date: `${month}-${pad(r.day_of_month)}`,
        category_id: r.category_id,
        amount: Number(r.amount),
        mode: 'Bank',
        payee: r.payee,
        notes: r.notes || 'Recurring',
        source: 'Recurring',
        ref_id: `${r.id}:${month}`,
      }));
    return Db.insert('Expenses', rows, 'EXP');
  }

  /** Runs the recurring job at most once a day, from login/sync, so it works even without the trigger. */
  function runRecurringIfDue() {
    const today = Util.today();
    if (Db.getMap('_meta').recurring_run_on === today) return;
    Db.withLock(() => {
      if (Db.getMap('_meta').recurring_run_on === today) return;
      const created = runRecurring(today);
      Db.setMapValues('_meta', { recurring_run_on: today });
      if (created.length) Audit.log('expense.recurring', 'Expenses', '', `${created.length} auto expense(s)`, { device: 'system' });
    });
  }

  return { save, remove, runRecurring, runRecurringIfDue };
})();

/** Time-driven trigger (daily). */
function createRecurringExpenses() {
  ExpensesApi.runRecurringIfDue();
}
