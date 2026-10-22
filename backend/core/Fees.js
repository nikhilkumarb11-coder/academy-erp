/**
 * Dues engine (PRD §6.3, addendum G8). Callers must hold Db.withLock.
 *
 * A recurring due covers one fee-plan period of an enrollment: months_covered months starting at the
 * enrollment's start month (period k starts at start + k × months_covered). Generating dues for a month
 * creates the period containing that month unless an existing due of the enrollment already covers it,
 * so running it twice, or after an annual payment, never bills twice (PRD rule 4).
 *
 * Money lives in three places: FeeDues (what is owed), Payments (what came in) and PaymentAllocations
 * (which payment paid which due). An allocation with a blank due_id is unspent credit (an advance);
 * credit is applied to the parent's oldest open dues whenever new dues appear.
 */
const Fees = (() => {
  const FREQ_LETTER = { Monthly: 'M', Quarterly: 'Q', HalfYearly: 'H', Annual: 'A' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- month helpers ('yyyy-MM') ----------

  function monthOf(date) {
    return String(date || '').slice(0, 7);
  }

  function addMonths(month, n) {
    const [y, m] = month.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  }

  function monthDiff(from, to) {
    const [y1, m1] = from.split('-').map(Number);
    const [y2, m2] = to.split('-').map(Number);
    return (y2 - y1) * 12 + (m2 - m1);
  }

  function daysIn(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function monthLabel(month) {
    const [y, m] = month.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }

  function isMonth(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
  }

  // ---------- amounts ----------

  const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
  const round = (v) => Math.round(v);

  function monthlyFee(enrollment, course) {
    if (enrollment.monthly_fee_override !== '' && enrollment.monthly_fee_override !== undefined && enrollment.monthly_fee_override !== null) {
      return num(enrollment.monthly_fee_override);
    }
    if (!course || course.monthly_fee === '' || course.monthly_fee === undefined || course.monthly_fee === null) return null;
    return num(course.monthly_fee);
  }

  function planAmount(fee, plan) {
    const months = Math.max(1, num(plan.months_covered) || 1);
    const discount = Math.min(100, Math.max(0, num(plan.discount_pct)));
    return round(fee * months * (1 - discount / 100));
  }

  function net(due) {
    return round(num(due.amount_due) - num(due.discount) + num(due.adjustment));
  }

  /** Balance and status from amounts; Waived sticks while nothing is left to pay. */
  function settle(due) {
    const balance = round(net(due) - num(due.amount_paid));
    let status;
    if (balance <= 0) status = due.status === 'Waived' ? 'Waived' : 'Paid';
    else status = num(due.amount_paid) > 0 ? 'Partial' : 'Pending';
    return { balance: Math.max(0, balance), status };
  }

  function isOpen(due) {
    return num(due.balance) > 0 && due.status !== 'Waived' && due.status !== 'Paid';
  }

  function byDueOrder(a, b) {
    return String(a.due_date).localeCompare(String(b.due_date)) || String(a.created_at).localeCompare(String(b.created_at));
  }

  // ---------- change sets ----------

  /** Merges rows into { Tab: [rows] }, keeping the latest version of each id. */
  function addChanges(changes, tab, rows) {
    if (!rows || !rows.length) return changes;
    const list = changes[tab] || (changes[tab] = []);
    rows.forEach((r) => {
      const i = list.findIndex((x) => x.id === r.id);
      if (i >= 0) list[i] = r;
      else list.push(r);
    });
    return changes;
  }

  function mergeChanges(target, source) {
    Object.keys(source || {}).forEach((tab) => addChanges(target, tab, source[tab]));
    return target;
  }

  // ---------- generation ----------

  function dueDay() {
    return Math.min(28, Math.max(1, Number(Db.getMap('Settings').due_day) || 5));
  }

  /** First month that may be billed: the calendar month after the join month (never the joining month). */
  function firstBillMonth(enrollment) {
    const startMonth = monthOf(enrollment.start_date);
    return isMonth(startMonth) ? addMonths(startMonth, 1) : '';
  }

  /**
   * The period of `enrollment` that contains `month`, or null when the enrollment does not run that month.
   * Billing never starts in the joining month — the first due is always the following month.
   * `existing` are the enrollment's recurring dues; a period already partly billed (e.g. after a plan change)
   * restarts at `month` instead of overlapping.
   */
  function periodFor(enrollment, plan, month, existing) {
    const billFrom = firstBillMonth(enrollment);
    if (!isMonth(billFrom) || month < billFrom) return null;
    if (enrollment.end_date && monthOf(enrollment.end_date) < month) return null;
    if (existing.some((d) => monthOf(d.period_start) <= month && month <= monthOf(d.period_end))) return null;

    const n = Math.max(1, num(plan.months_covered) || 1);
    let first = addMonths(billFrom, Math.floor(monthDiff(billFrom, month) / n) * n);
    let last = addMonths(first, n - 1);
    if (existing.some((d) => monthOf(d.period_start) <= last && first <= monthOf(d.period_end))) {
      first = month;
      last = addMonths(month, n - 1);
    }
    return {
      first,
      last,
      key: `${FREQ_LETTER[plan.frequency] || 'P'}-${first}`,
      label: n === 1 ? monthLabel(first) : `${monthLabel(first)} – ${monthLabel(last)}`,
      start: `${first}-01`,
      end: `${last}-${String(daysIn(last)).padStart(2, '0')}`,
      isFirst: first === billFrom,
    };
  }

  /**
   * Creates the dues for `month`. Options: enrollmentIds (limit to these), dryRun (compute only).
   * Returns { created, skipped: [{ enrollment_id, student, course, reason }], changes }.
   */
  function generate(month, opts) {
    const options = opts || {};
    if (!isMonth(month)) throw new AppError('VALIDATION', 'Month must look like 2026-06', { field: 'month' });

    const only = options.enrollmentIds ? new Set(options.enrollmentIds) : null;
    const students = new Map(Db.all('Students').map((s) => [s.id, s]));
    const courses = new Map(Db.all('Courses').map((c) => [c.id, c]));
    const plans = new Map(Db.all('FeePlans', { includeDeleted: true }).map((p) => [p.id, p]));
    const duesByEnrollment = {};
    Db.all('FeeDues').forEach((d) => {
      if (d.kind !== 'Recurring' || !d.enrollment_id) return;
      (duesByEnrollment[d.enrollment_id] = duesByEnrollment[d.enrollment_id] || []).push(d);
    });
    const day = String(dueDay()).padStart(2, '0');

    const rows = [];
    const skipped = [];
    Db.all('Enrollments').forEach((e) => {
      if (only && !only.has(e.id)) return;
      const student = students.get(e.student_id);
      if (!student || e.status !== 'Active' || student.status !== 'Active') return;
      const course = courses.get(e.course_id);
      const plan = plans.get(e.fee_plan_id);
      const label = { enrollment_id: e.id, student: student.name, course: course ? course.name : '' };
      if (!plan) return skipped.push(Object.assign(label, { reason: 'No fee plan' }));

      const period = periodFor(e, plan, month, duesByEnrollment[e.id] || []);
      if (!period) return;
      const fee = monthlyFee(e, course);
      if (fee === null) return skipped.push(Object.assign(label, { reason: 'No monthly fee set' }));

      const amount = planAmount(fee, plan);
      rows.push({
        kind: 'Recurring',
        enrollment_id: e.id,
        student_id: student.id,
        parent_id: student.parent_id,
        charge_item_id: '',
        period_key: period.key,
        period_label: period.label,
        period_start: period.start,
        period_end: period.end,
        amount_due: amount,
        discount: 0,
        adjustment: 0,
        amount_paid: 0,
        balance: amount,
        prorated: false,
        due_date: `${period.first}-${day}`,
        status: amount > 0 ? 'Pending' : 'Paid',
        notes: e.discount_note || '',
      });
    });

    const changes = {};
    if (options.dryRun) return { created: rows, skipped, changes };

    const created = Db.insert('FeeDues', rows, 'DUE');
    addChanges(changes, 'FeeDues', created);
    const parents = {};
    created.forEach((d) => { parents[d.parent_id] = true; });
    Object.keys(parents).forEach((pid) => mergeChanges(changes, applyCredit(pid)));
    return { created, skipped, changes };
  }

  // ---------- credit ----------

  function recordedPaymentIds(parentId) {
    return new Set(Db.where('Payments', (p) => p.parent_id === parentId && p.status === 'Recorded').map((p) => p.id));
  }

  function creditOf(parentId) {
    const ok = recordedPaymentIds(parentId);
    return Db.all('PaymentAllocations')
      .filter((a) => !a.due_id && ok.has(a.payment_id))
      .reduce((sum, a) => sum + num(a.amount), 0);
  }

  /** Spends the parent's unspent credit on their oldest open dues. Returns changes. */
  function applyCredit(parentId) {
    const changes = {};
    const ok = recordedPaymentIds(parentId);
    const credits = Db.all('PaymentAllocations')
      .filter((a) => !a.due_id && num(a.amount) > 0 && ok.has(a.payment_id))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (!credits.length) return changes;

    const open = Db.where('FeeDues', (d) => d.parent_id === parentId && isOpen(d)).sort(byDueOrder);
    const newAllocations = [];
    const creditPatches = [];
    const duePatches = [];
    let ci = 0;
    let left = credits.length ? num(credits[0].amount) : 0;
    open.forEach((due) => {
      let need = num(due.balance);
      let paid = num(due.amount_paid);
      while (need > 0 && ci < credits.length) {
        const take = Math.min(need, left);
        if (take > 0) {
          newAllocations.push({ payment_id: credits[ci].payment_id, due_id: due.id, student_id: due.student_id, amount: take });
          need -= take;
          left -= take;
          paid += take;
        }
        if (left <= 0) {
          creditPatches.push({ id: credits[ci].id, amount: 0 });
          ci += 1;
          left = ci < credits.length ? num(credits[ci].amount) : 0;
        }
      }
      if (paid !== num(due.amount_paid)) duePatches.push(Object.assign({ id: due.id, amount_paid: paid }, settle(Object.assign({}, due, { amount_paid: paid }))));
    });
    if (ci < credits.length && left !== num(credits[ci].amount)) creditPatches.push({ id: credits[ci].id, amount: left });
    if (!newAllocations.length) return changes;

    addChanges(changes, 'PaymentAllocations', Db.insert('PaymentAllocations', newAllocations, 'ALC'));
    addChanges(changes, 'PaymentAllocations', Db.update('PaymentAllocations', creditPatches));
    addChanges(changes, 'FeeDues', Db.update('FeeDues', duePatches));
    return changes;
  }

  return {
    monthOf, addMonths, monthDiff, monthLabel, isMonth, daysIn,
    num, monthlyFee, planAmount, net, settle, isOpen, byDueOrder,
    addChanges, mergeChanges, periodFor, generate, creditOf, applyCredit,
  };
})();
