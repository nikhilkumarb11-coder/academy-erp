/**
 * Dues, manual payments and receipts (PRD §6.3, §6.5). The engine lives in core/Fees.js.
 * Writes return { changes: { <Tab>: [rows] } } like every other write action.
 */
const FeesApi = (() => {
  const MAX_AMOUNT = 10000000;

  function settings() {
    return Db.getMap('Settings');
  }

  function requireParent(id) {
    const parent = Db.find('Parents', id);
    if (!parent || Db.isDeleted(parent)) throw new AppError('NOT_FOUND', 'Parent not found');
    return parent;
  }

  function requireDue(id) {
    const due = Db.find('FeeDues', id);
    if (!due || Db.isDeleted(due)) throw new AppError('NOT_FOUND', 'Due not found');
    return due;
  }

  function appendNote(existing, note) {
    const line = `${Util.today()}: ${note}`;
    return existing ? `${existing}\n${line}` : line;
  }

  // ---------- dues ----------

  /** dues.generate { month: 'yyyy-MM', dryRun? } — idempotent. */
  function generate(payload, ctx) {
    const month = String(payload.month || Util.today().slice(0, 7));
    return Db.withLock(() => {
      const result = Fees.generate(month, { dryRun: !!payload.dryRun });
      if (!payload.dryRun) {
        Audit.log('dues.generate', 'FeeDues', month, `${result.created.length} created, ${result.skipped.length} skipped`, ctx);
      }
      return {
        changes: result.changes,
        month,
        created: result.created.length,
        total: result.created.reduce((s, d) => s + Fees.num(d.amount_due), 0),
        skipped: result.skipped,
      };
    });
  }

  /** dues.addCharge { student_id, charge_item_id?, label?, amount, due_date?, note? } — one-time charge. */
  function addCharge(payload, ctx) {
    Util.requireFields(payload, ['student_id']);
    return Db.withLock(() => {
      const student = Db.find('Students', payload.student_id);
      if (!student || Db.isDeleted(student)) throw new AppError('NOT_FOUND', 'Student not found');
      const due = buildCharge(student, payload, '');
      const saved = Db.insert('FeeDues', [due], 'DUE')[0];
      const changes = Fees.addChanges({}, 'FeeDues', [saved]);
      Fees.mergeChanges(changes, Fees.applyCredit(student.parent_id));
      Audit.log('dues.addCharge', 'FeeDues', saved.id, `${student.name}: ${saved.period_label} ${saved.amount_due}`, ctx);
      return { changes };
    });
  }

  /** Validated one-time due row for a student. `prefix` scopes field errors (e.g. "students.0.charges.1"). */
  function buildCharge(student, input, prefix) {
    const at = (f) => (prefix ? `${prefix}.${f}` : f);
    let item = null;
    if (input.charge_item_id) {
      item = Db.find('ChargeItems', input.charge_item_id);
      if (!item || Db.isDeleted(item)) Validate.fail(at('charge_item_id'), 'Choose a valid charge');
    }
    const label = Validate.text(input.label || (item && item.name), at('label'), { required: true, max: 60, label: 'Charge name' });
    const amount = Validate.number(input.amount !== undefined && input.amount !== '' ? input.amount : item && item.default_amount, at('amount'), {
      required: true, min: 1, max: MAX_AMOUNT, label: 'Amount',
    });
    const dueDate = Validate.date(input.due_date || Util.today(), at('due_date'), { required: true, label: 'Due date' });
    return {
      kind: 'OneTime',
      enrollment_id: '',
      student_id: student.id,
      parent_id: student.parent_id,
      charge_item_id: item ? item.id : '',
      period_key: `C-${dueDate}`,
      period_label: label,
      period_start: dueDate,
      period_end: dueDate,
      amount_due: amount,
      discount: 0,
      adjustment: 0,
      amount_paid: 0,
      balance: amount,
      prorated: false,
      due_date: dueDate,
      status: 'Pending',
      notes: input.note ? appendNote('', Validate.text(input.note, at('note'), { max: 200, label: 'Note' })) : '',
    };
  }

  /**
   * dues.adjust { id, note, amount_due?, discount?, adjustment?, waive? }
   * amount_due marks the due as prorated (manual first-month amount, PRD rule 5).
   */
  function adjust(payload, ctx) {
    Util.requireFields(payload, ['id']);
    const note = Validate.text(payload.note, 'note', { required: true, max: 200, label: 'Note' });
    return Db.withLock(() => {
      const due = requireDue(payload.id);
      const next = Object.assign({}, due);
      if (payload.amount_due !== undefined && payload.amount_due !== '') {
        next.amount_due = Validate.number(payload.amount_due, 'amount_due', { required: true, min: 0, max: MAX_AMOUNT, label: 'Amount' });
        next.prorated = true;
      }
      if (payload.discount !== undefined && payload.discount !== '') {
        next.discount = Validate.number(payload.discount, 'discount', { min: 0, max: MAX_AMOUNT, label: 'Discount' });
      }
      if (payload.adjustment !== undefined && payload.adjustment !== '') {
        next.adjustment = Validate.number(payload.adjustment, 'adjustment', { min: -MAX_AMOUNT, max: MAX_AMOUNT, label: 'Adjustment' });
      }
      next.status = due.status === 'Waived' ? 'Pending' : due.status;
      if (payload.waive) {
        next.discount = Fees.num(next.discount) + Math.max(0, Fees.net(next) - Fees.num(next.amount_paid));
        next.status = 'Waived';
      }
      if (Fees.net(next) < 0) Validate.fail('discount', 'The discount is larger than the amount');
      if (Fees.net(next) < Fees.num(due.amount_paid)) {
        Validate.fail('amount_due', `${Fees.num(due.amount_paid)} is already paid against this due. Cancel that payment first.`);
      }

      const patch = {
        id: due.id,
        amount_due: next.amount_due,
        prorated: next.prorated,
        discount: next.discount,
        adjustment: next.adjustment,
        notes: appendNote(due.notes, note),
      };
      Object.assign(patch, Fees.settle(Object.assign({}, next)));
      const saved = Db.update('FeeDues', [patch]);
      const changes = Fees.addChanges({}, 'FeeDues', saved);
      Fees.mergeChanges(changes, Fees.applyCredit(due.parent_id));
      Audit.log(payload.waive ? 'dues.waive' : 'dues.adjust', 'FeeDues', due.id, note, ctx);
      return { changes };
    });
  }

  /** dues.remove { id, note } — for dues created by mistake; refused once anything is paid. */
  function remove(payload, ctx) {
    Util.requireFields(payload, ['id']);
    const note = Validate.text(payload.note, 'note', { required: true, max: 200, label: 'Reason' });
    return Db.withLock(() => {
      const due = requireDue(payload.id);
      if (Fees.num(due.amount_paid) > 0) throw new AppError('CONFLICT', 'This due has payments against it. Cancel them first, or waive the due instead.');
      const saved = Db.update('FeeDues', [{ id: due.id, deleted: true, notes: appendNote(due.notes, `Removed: ${note}`) }]);
      Audit.log('dues.remove', 'FeeDues', due.id, note, ctx);
      return { changes: { FeeDues: saved } };
    });
  }

  // ---------- payments ----------

  function financialYear(date) {
    const fyStart = Number(settings().fy_start_month) || 4;
    const [y, m] = date.split('-').map(Number);
    if (fyStart === 1) return String(y);
    const start = m >= fyStart ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  }

  /** <prefix>/<FY>/<sequence>, restarting each financial year (addendum G6). Inside withLock. */
  function nextReceiptNo(paidAt) {
    const fy = financialYear(paidAt);
    const seq = Db.nextCounter(`receipt:${fy}`);
    const prefix = String(settings().receipt_prefix || 'RCPT').trim() || 'RCPT';
    return `${prefix}/${fy}/${String(seq).padStart(4, '0')}`;
  }

  /**
   * payments.record { parent_id, amount, mode, paid_at?, allocations?: [{ due_id, amount }], notes?, client_ref? }
   * Without allocations the amount pays the oldest open dues first; anything left becomes credit.
   * client_ref makes retries safe: the same ref returns the payment already recorded.
   */
  function record(payload, ctx) {
    Util.requireFields(payload, ['parent_id']);
    const amount = Validate.number(payload.amount, 'amount', { required: true, min: 1, max: MAX_AMOUNT, label: 'Amount' });
    const mode = Validate.oneOf(payload.mode, 'mode', STATUS.manualPaymentMode, { label: 'Payment mode' });
    const paidAt = Validate.date(payload.paid_at || Util.today(), 'paid_at', { required: true, label: 'Payment date' });
    if (paidAt > Util.today()) Validate.fail('paid_at', 'Payment date cannot be in the future');
    const notes = Validate.text(payload.notes, 'notes', { max: 300, label: 'Notes' });
    const clientRef = Validate.text(payload.client_ref, 'client_ref', { max: 64, label: 'Reference' });

    return Db.withLock(() => {
      if (clientRef) {
        const dup = Db.where('Payments', (p) => p.client_ref === clientRef)[0];
        if (dup) return { changes: {}, payment_id: dup.id, receipt_no: dup.receipt_no, duplicate: true };
      }
      const parent = requireParent(payload.parent_id);
      const open = Db.where('FeeDues', (d) => d.parent_id === parent.id && Fees.isOpen(d)).sort(Fees.byDueOrder);
      const openById = new Map(open.map((d) => [d.id, d]));

      let plan;
      if (Array.isArray(payload.allocations) && payload.allocations.length) {
        plan = payload.allocations.map((a, i) => {
          const due = openById.get(a.due_id);
          if (!due) Validate.fail(`allocations.${i}.due_id`, 'That due is not open for this family');
          const value = Validate.number(a.amount, `allocations.${i}.amount`, { required: true, min: 1, max: Fees.num(due.balance), label: 'Amount' });
          return { due, amount: value };
        });
        const total = plan.reduce((s, p) => s + p.amount, 0);
        if (total > amount) Validate.fail('amount', `The amounts for dues (${total}) add up to more than the payment`);
      } else {
        let left = amount;
        plan = [];
        open.forEach((due) => {
          if (left <= 0) return;
          const take = Math.min(left, Fees.num(due.balance));
          plan.push({ due, amount: take });
          left -= take;
        });
      }

      const payment = Db.insert('Payments', [{
        parent_id: parent.id,
        amount,
        mode,
        paid_at: paidAt,
        gateway_payment_id: '',
        link_id: '',
        receipt_no: nextReceiptNo(paidAt),
        status: 'Recorded',
        cancel_reason: '',
        notes,
        client_ref: clientRef,
      }], 'PAY')[0];

      const allocated = plan.reduce((s, p) => s + p.amount, 0);
      const allocations = plan.map((p) => ({ payment_id: payment.id, due_id: p.due.id, student_id: p.due.student_id, amount: p.amount }));
      if (amount > allocated) allocations.push({ payment_id: payment.id, due_id: '', student_id: '', amount: amount - allocated });

      const changes = {};
      Fees.addChanges(changes, 'Payments', [payment]);
      Fees.addChanges(changes, 'PaymentAllocations', Db.insert('PaymentAllocations', allocations, 'ALC'));
      Fees.addChanges(changes, 'FeeDues', Db.update('FeeDues', plan.map((p) => {
        const paid = Fees.num(p.due.amount_paid) + p.amount;
        return Object.assign({ id: p.due.id, amount_paid: paid }, Fees.settle(Object.assign({}, p.due, { amount_paid: paid })));
      })));
      Fees.mergeChanges(changes, Fees.applyCredit(parent.id));

      Audit.log('payments.record', 'Payments', payment.id, `${payment.receipt_no} ${parent.guardian_name} ${amount} ${mode}`, ctx);
      return { changes, payment_id: payment.id, receipt_no: payment.receipt_no };
    });
  }

  /** payments.cancel { id, reason } — reverses allocations so the dues reopen; the receipt is kept and marked cancelled (G1). */
  function cancel(payload, ctx) {
    Util.requireFields(payload, ['id']);
    const reason = Validate.text(payload.reason, 'reason', { required: true, max: 200, label: 'Reason' });
    return Db.withLock(() => {
      const payment = Db.find('Payments', payload.id);
      if (!payment) throw new AppError('NOT_FOUND', 'Payment not found');
      if (payment.status !== 'Recorded') throw new AppError('CONFLICT', 'This payment is already cancelled');

      const reverse = {};
      Db.where('PaymentAllocations', (a) => a.payment_id === payment.id && a.due_id).forEach((a) => {
        reverse[a.due_id] = (reverse[a.due_id] || 0) + Fees.num(a.amount);
      });
      const duePatches = Object.keys(reverse).map((dueId) => {
        const due = Db.find('FeeDues', dueId);
        const paid = Math.max(0, Fees.num(due.amount_paid) - reverse[dueId]);
        const status = due.status === 'Waived' ? 'Pending' : due.status;
        return Object.assign({ id: due.id, amount_paid: paid }, Fees.settle(Object.assign({}, due, { amount_paid: paid, status })));
      });

      const changes = {};
      Fees.addChanges(changes, 'Payments', Db.update('Payments', [{ id: payment.id, status: 'Cancelled', cancel_reason: reason }]));
      Fees.addChanges(changes, 'FeeDues', Db.update('FeeDues', duePatches));
      const receipts = Db.where('Receipts', (r) => r.payment_id === payment.id && r.status !== 'Cancelled');
      // Clearing the link makes receipts.get render a copy stamped CANCELLED; the old file stays in Drive.
      Fees.addChanges(changes, 'Receipts', Db.update('Receipts', receipts.map((r) => ({ id: r.id, status: 'Cancelled', drive_url: '' }))));
      Audit.log('payments.cancel', 'Payments', payment.id, `${payment.receipt_no}: ${reason}`, ctx);
      return { changes };
    });
  }

  // ---------- receipts ----------

  /**
   * receipts.get { payment_id, withFile? } — creates the PDF in Drive on first request (and again after a
   * cancellation, stamped CANCELLED). Returns { receipt_no, url, file?: { name, mimeType, base64 } }.
   */
  function getReceipt(payload, ctx) {
    Util.requireFields(payload, ['payment_id']);
    const payment = Db.find('Payments', payload.payment_id);
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found');
    const wanted = payment.status === 'Cancelled' ? 'Cancelled' : 'Active';
    let receipt = Db.where('Receipts', (r) => r.payment_id === payment.id && r.drive_file_id).pop();
    let changes = {};
    let blob = null;

    if (!receipt || receipt.status !== wanted || !receipt.drive_url) {
      blob = ReceiptPdf.render(payment);
      const file = ReceiptPdf.save(blob);
      changes = Db.withLock(() => {
        const row = { receipt_no: payment.receipt_no, payment_id: payment.id, drive_file_id: file.id, drive_url: file.url, status: wanted };
        const saved = receipt ? Db.update('Receipts', [Object.assign({ id: receipt.id }, row)]) : Db.insert('Receipts', [row], 'RCT');
        Audit.log('receipts.create', 'Receipts', saved[0].id, payment.receipt_no, ctx);
        receipt = saved[0];
        return { Receipts: saved };
      });
    }

    const out = { changes, receipt_no: payment.receipt_no, url: receipt.drive_url };
    if (payload.withFile) {
      const pdf = blob || ReceiptPdf.load(receipt.drive_file_id);
      out.file = { name: `${payment.receipt_no.replace(/\//g, '-')}.pdf`, mimeType: 'application/pdf', base64: Utilities.base64Encode(pdf.getBytes()) };
    }
    return out;
  }

  return { generate, addCharge, buildCharge, adjust, remove, record, cancel, getReceipt, financialYear };
})();

/** Time-driven trigger (Setup.installTriggers): bills the new month for every active enrollment. */
function generateMonthlyDues() {
  const month = Util.today().slice(0, 7);
  Db.withLock(() => {
    const result = Fees.generate(month, {});
    Audit.log('dues.generate', 'FeeDues', month, `Automatic: ${result.created.length} created, ${result.skipped.length} skipped`, { device: 'trigger' });
  });
}
