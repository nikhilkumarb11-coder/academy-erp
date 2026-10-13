import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createBackend, loadPreset } from './harness.mjs';

/** Rays preset, fees set on three courses, one family: Aarav (Karate monthly + Abacus annual), Diya (Drawing monthly). */
async function family({ start = '2026-10-13', today = '2026-10-13' } = {}) {
  const be = createBackend();
  be.state.today = today;
  const token = await be.login();
  await be.ok('system.seed', { preset: loadPreset('multi-activity') }, token);
  let boot = await be.ok('system.bootstrap', {}, token);
  const course = (name) => boot.Courses.find((c) => c.name === name);
  const plan = (name) => boot.FeePlans.find((p) => p.name.startsWith(name));
  for (const [name, fee] of [['Karate', 1000], ['Abacus', 1000], ['Drawing', 800]]) {
    await be.ok('catalog.save', { tab: 'Courses', row: { id: course(name).id, monthly_fee: fee } }, token);
  }
  const res = await be.ok('admissions.create', {
    parent: { guardian_name: 'Ravi Kumar', phone: '98765 43210' },
    students: [
      {
        name: 'Aarav',
        extra: { syllabus: 'CBSE' },
        enrollments: [
          { course_id: course('Karate').id, fee_plan_id: plan('Monthly').id, start_date: start },
          { course_id: course('Abacus').id, fee_plan_id: plan('Annual').id, start_date: start },
        ],
      },
      { name: 'Diya', enrollments: [{ course_id: course('Drawing').id, fee_plan_id: plan('Monthly').id, start_date: start }] },
    ],
  }, token);
  boot = await be.ok('system.bootstrap', {}, token);
  const dues = () => be.sheetRows('FeeDues').filter((d) => d.deleted !== true);
  const dueFor = (courseName, periodPrefix) => {
    const enr = be.sheetRows('Enrollments').find((e) => e.course_id === course(courseName).id);
    return dues().find((d) => d.enrollment_id === enr.id && (!periodPrefix || String(d.period_key).includes(periodPrefix)));
  };
  /** Moves the backend clock and logs in again (tokens expire after session_hours). */
  const at = async (date) => { be.state.today = date; ctx.token = await be.login(); };
  const ctx = { be, token, at, res, course, plan, dues, dueFor, parentId: res.parent_id, aarav: res.student_ids[0], diya: res.student_ids[1] };
  return ctx;
}

describe('dues engine', () => {
  let f;
  beforeEach(async () => { f = await family(); });

  it('bills the current month at admission; annual = monthly × 10 × 85%', async () => {
    assert.equal(f.res.changes.FeeDues.length, 3);
    const annual = f.dueFor('Abacus');
    assert.equal(annual.amount_due, 8500);
    assert.equal(annual.period_label, 'Oct 2026 – Jul 2027');
    assert.equal(annual.period_start, '2026-10-13');
    assert.equal(annual.period_end, '2027-07-31');
    assert.equal(annual.due_date, '2026-10-13', 'mid-month joiners are due on their start date');
    assert.equal(f.dueFor('Karate').amount_due, 1000);
    assert.equal(f.dueFor('Drawing').status, 'Pending');
  });

  it('is idempotent and never re-bills inside an annual period', async () => {
    await f.at('2026-11-01');
    const nov = await f.be.ok('dues.generate', { month: '2026-11' }, f.token);
    assert.equal(nov.created, 2, 'Karate and Drawing monthly; Abacus is covered by the annual due');
    assert.equal(nov.total, 1800);
    const again = await f.be.ok('dues.generate', { month: '2026-11' }, f.token);
    assert.equal(again.created, 0);
    const nextAnnual = await f.be.ok('dues.generate', { month: '2027-08' }, f.token);
    const abacus = nextAnnual.changes.FeeDues.find((d) => d.period_key === 'A-2027-08');
    assert.equal(abacus.amount_due, 8500);
    assert.equal(abacus.due_date, '2027-08-05');
  });

  it('skips courses with no fee, and enrollments that are on hold or have not started', async () => {
    await f.be.ok('catalog.save', { tab: 'Courses', row: { id: f.course('Drawing').id, monthly_fee: '' } }, f.token);
    await f.be.ok('students.setStatus', { id: f.aarav, status: 'On hold', reason: 'Exams' }, f.token);
    const dec = await f.be.ok('dues.generate', { month: '2026-12' }, f.token);
    assert.equal(dec.created, 0);
    assert.deepEqual(dec.skipped.map((s) => s.reason), ['No monthly fee set']);

    const preview = await f.be.ok('dues.generate', { month: '2026-09', dryRun: true }, f.token);
    assert.equal(preview.created, 0, 'nothing before the start month');
  });

  it('bills the current month when a student comes back from hold', async () => {
    await f.at('2026-11-20');
    await f.be.ok('students.setStatus', { id: f.aarav, status: 'On hold', reason: 'Travel' }, f.token);
    const back = await f.be.ok('students.setStatus', { id: f.aarav, status: 'Active' }, f.token);
    const keys = back.changes.FeeDues.map((d) => d.period_key).sort();
    assert.deepEqual(keys, ['M-2026-11'], 'Karate for November; Abacus annual still covers it');
  });

  it('starts billing in the start month when admitted in advance', async () => {
    const g = await family({ start: '2026-12-01', today: '2026-10-20' });
    assert.equal((g.res.changes.FeeDues || []).length, 0);
    await g.at('2026-12-01');
    const dec = await g.be.ok('dues.generate', { month: '2026-12' }, g.token);
    assert.equal(dec.created, 3);
  });

  it('adjusts, prorates, waives and removes dues with notes', async () => {
    const karate = f.dueFor('Karate');
    const noNote = await f.be.call('dues.adjust', { id: karate.id, discount: 100 }, f.token);
    assert.equal(noNote.error.details.field, 'note');

    const pro = await f.be.ok('dues.adjust', { id: karate.id, amount_due: 600, note: 'Joined on 13th' }, f.token);
    assert.equal(pro.changes.FeeDues[0].prorated, true);
    assert.equal(pro.changes.FeeDues[0].balance, 600);

    const disc = await f.be.ok('dues.adjust', { id: karate.id, discount: 100, note: 'Sibling' }, f.token);
    assert.equal(disc.changes.FeeDues[0].balance, 500);

    const waived = await f.be.ok('dues.adjust', { id: f.dueFor('Drawing').id, waive: true, note: 'Scholarship' }, f.token);
    assert.equal(waived.changes.FeeDues[0].status, 'Waived');
    assert.equal(waived.changes.FeeDues[0].balance, 0);

    const removed = await f.be.ok('dues.remove', { id: f.dueFor('Abacus').id, note: 'Wrong plan' }, f.token);
    assert.equal(removed.changes.FeeDues[0].deleted, true);
    const regen = await f.be.ok('dues.generate', { month: '2026-10' }, f.token);
    assert.equal(regen.created, 1, 'a removed due can be generated again');
  });

  it('adds one-time charges, including at admission', async () => {
    const charge = await f.be.ok('dues.addCharge', { student_id: f.diya, label: 'Uniform', amount: 750 }, f.token);
    assert.equal(charge.changes.FeeDues[0].kind, 'OneTime');
    assert.equal(charge.changes.FeeDues[0].period_label, 'Uniform');

    const items = (await f.be.ok('system.bootstrap', {}, f.token)).ChargeItems;
    const admissionFee = items.find((i) => i.applies_to === 'Admission');
    const res = await f.be.ok('admissions.create', {
      parent: { id: f.parentId },
      students: [{ name: 'Kabir', charges: [{ charge_item_id: admissionFee.id, amount: 500 }] }],
    }, f.token);
    assert.equal(res.changes.FeeDues[0].amount_due, 500);
    assert.equal(res.changes.FeeDues[0].student_id, res.student_ids[0]);

    const bad = await f.be.call('admissions.create', { parent: { id: f.parentId }, students: [{ name: 'X', charges: [{ label: 'Kit', amount: 0 }] }] }, f.token);
    assert.equal(bad.error.details.field, 'students.0.charges.0.amount');
  });
});

describe('payments', () => {
  let f;
  beforeEach(async () => { f = await family(); });

  it('pays the oldest dues first, numbers receipts per financial year, and keeps the rest as credit', async () => {
    const pay = await f.be.ok('payments.record', { parent_id: f.parentId, amount: 1500, mode: 'Cash' }, f.token);
    assert.equal(pay.receipt_no, 'RCPT/2026-27/0001');
    const statuses = pay.changes.FeeDues.map((d) => [d.period_key, d.status, d.balance]);
    assert.equal(statuses.length, 2);
    assert.ok(statuses.some(([, s]) => s === 'Paid'));
    assert.ok(statuses.some(([, s, b]) => s === 'Partial' && b > 0));

    const rest = f.dues().reduce((s, d) => s + d.balance, 0);
    const second = await f.be.ok('payments.record', { parent_id: f.parentId, amount: rest + 2000, mode: 'UPI' }, f.token);
    assert.equal(second.receipt_no, 'RCPT/2026-27/0002');
    const credit = second.changes.PaymentAllocations.find((a) => !a.due_id);
    assert.equal(credit.amount, 2000);
    assert.ok(f.dues().every((d) => d.status === 'Paid'));

    await f.at('2026-11-01');
    const nov = await f.be.ok('dues.generate', { month: '2026-11' }, f.token);
    assert.equal(nov.created, 2);
    const novDues = f.dues().filter((d) => d.period_key === 'M-2026-11');
    assert.deepEqual(novDues.map((d) => d.status), ['Paid', 'Paid'], 'the advance pays the new dues');
    const left = f.be.sheetRows('PaymentAllocations').find((a) => a.id === credit.id);
    assert.equal(left.amount, 200);
  });

  it('honours chosen allocations and validates them', async () => {
    const drawing = f.dueFor('Drawing');
    const pay = await f.be.ok('payments.record', {
      parent_id: f.parentId, amount: 800, mode: 'Bank', allocations: [{ due_id: drawing.id, amount: 800 }],
    }, f.token);
    assert.deepEqual(pay.changes.FeeDues.map((d) => d.id), [drawing.id]);

    const tooMuch = await f.be.call('payments.record', {
      parent_id: f.parentId, amount: 100, mode: 'Cash', allocations: [{ due_id: f.dueFor('Karate').id, amount: 500 }],
    }, f.token);
    assert.equal(tooMuch.error.details.field, 'amount');
    const future = await f.be.call('payments.record', { parent_id: f.parentId, amount: 10, mode: 'Cash', paid_at: '2027-01-01' }, f.token);
    assert.equal(future.error.details.field, 'paid_at');
    const gateway = await f.be.call('payments.record', { parent_id: f.parentId, amount: 10, mode: 'Gateway' }, f.token);
    assert.equal(gateway.error.details.field, 'mode');
  });

  it('records a retried payment only once', async () => {
    const body = { parent_id: f.parentId, amount: 1000, mode: 'Cash', client_ref: 'tap-123' };
    const first = await f.be.ok('payments.record', body, f.token);
    const retry = await f.be.ok('payments.record', body, f.token);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.payment_id, first.payment_id);
    assert.equal(f.be.sheetRows('Payments').length, 1);
  });

  it('cancelling reopens the dues, voids the credit and stamps the receipt', async () => {
    const total = f.dues().reduce((s, d) => s + d.balance, 0);
    const pay = await f.be.ok('payments.record', { parent_id: f.parentId, amount: total + 500, mode: 'Cash' }, f.token);
    const receipt = await f.be.ok('receipts.get', { payment_id: pay.payment_id }, f.token);
    assert.match(receipt.url, /drive\.example/);

    const noReason = await f.be.call('payments.cancel', { id: pay.payment_id }, f.token);
    assert.equal(noReason.error.details.field, 'reason');
    const cancel = await f.be.ok('payments.cancel', { id: pay.payment_id, reason: 'Cheque bounced' }, f.token);
    assert.equal(cancel.changes.Payments[0].status, 'Cancelled');
    assert.equal(cancel.changes.Receipts[0].status, 'Cancelled');
    assert.ok(f.dues().every((d) => d.status === 'Pending' && d.balance === d.amount_due));

    // The 500 credit belonged to the cancelled payment, so new dues stay unpaid.
    const nov = await f.be.ok('dues.generate', { month: '2026-11' }, f.token);
    assert.ok(nov.changes.FeeDues.every((d) => d.status === 'Pending'));

    const again = await f.be.call('payments.cancel', { id: pay.payment_id, reason: 'x' }, f.token);
    assert.equal(again.error.code, 'CONFLICT');
    const stamped = await f.be.ok('receipts.get', { payment_id: pay.payment_id, withFile: true }, f.token);
    assert.notEqual(stamped.url, receipt.url);
    assert.match(Buffer.from(stamped.file.base64, 'base64').toString(), /CANCELLED/);
  });

  it('creates the receipt PDF once, shared by link, with every line', async () => {
    const pay = await f.be.ok('payments.record', { parent_id: f.parentId, amount: 2000, mode: 'UPI' }, f.token);
    const first = await f.be.ok('receipts.get', { payment_id: pay.payment_id, withFile: true }, f.token);
    const second = await f.be.ok('receipts.get', { payment_id: pay.payment_id }, f.token);
    assert.equal(first.url, second.url);
    assert.equal(Object.keys(f.be.state.drive.files).length, 1);
    assert.equal(Object.values(f.be.state.drive.files)[0].sharing, 'ANYONE_WITH_LINK:VIEW');
    assert.ok(f.be.state.props.RECEIPTS_FOLDER_ID);
    assert.equal(first.file.name, 'RCPT-2026-27-0001.pdf');
    const html = Buffer.from(first.file.base64, 'base64').toString();
    assert.match(html, /RCPT\/2026-27\/0001/);
    assert.match(html, /Ravi Kumar/);
    assert.match(html, /Aarav/);
  });

  it('brands the receipt with the logo, tagline, colours and contact footer', async () => {
    await f.be.ok('settings.update', {
      academy_name: 'Rays Academy',
      academy_tagline: 'Building strong foundations',
      contact_person: 'Prathima',
      academy_phone: '8499987370',
      academy_address: '11-13-981, Green Hills Colony',
      logo_url: 'https://example.github.io/branding/rays/logo.png',
      brand_primary: '#1B3358',
      brand_accent: 'not-a-colour',
    }, f.token);
    const pay = await f.be.ok('payments.record', { parent_id: f.parentId, amount: 500, mode: 'Cash' }, f.token);
    const { file } = await f.be.ok('receipts.get', { payment_id: pay.payment_id, withFile: true }, f.token);
    const html = Buffer.from(file.base64, 'base64').toString();
    assert.match(html, /RAYS ACADEMY/);
    assert.match(html, /<img src="https:\/\/example\.github\.io\/branding\/rays\/logo\.png"/);
    assert.match(html, /Building strong foundations/);
    assert.match(html, /Contact:<\/b> Prathima · 8499987370/);
    assert.match(html, /Address:<\/b> 11-13-981, Green Hills Colony/);
    assert.match(html, /#1B3358/);
    assert.doesNotMatch(html, /not-a-colour/);
  });
});

describe('attendance', () => {
  let f;
  beforeEach(async () => { f = await family(); });

  it('upserts marks for a course and day, and reports a month', async () => {
    const course_id = f.course('Karate').id;
    const first = await f.be.ok('attendance.save', {
      course_id, date: '2026-10-13', marks: [{ student_id: f.aarav, status: 'Present' }, { student_id: f.diya, status: 'Absent' }],
    }, f.token);
    assert.equal(first.marks.length, 2);
    const edit = await f.be.ok('attendance.save', { course_id, date: '2026-10-13', marks: [{ student_id: f.diya, status: 'Leave', remarks: 'Fever' }] }, f.token);
    assert.equal(edit.marks.find((m) => m.student_id === f.diya).status, 'Leave');
    assert.equal(f.be.sheetRows('Attendance').length, 2, 'edited in place');
    assert.ok(f.be.sheetRows('AuditLog').some((r) => r.action === 'attendance.edit'));

    const day = await f.be.ok('attendance.day', { course_id, date: '2026-10-13' }, f.token);
    assert.equal(day.marks.length, 2);
    const report = await f.be.ok('attendance.report', { month: '2026-10', student_id: f.aarav }, f.token);
    assert.equal(report.rows.length, 1);

    const future = await f.be.call('attendance.save', { course_id, date: '2026-10-14', marks: [{ student_id: f.aarav, status: 'Present' }] }, f.token);
    assert.equal(future.error.details.field, 'date');
    const bad = await f.be.call('attendance.save', { course_id, date: '2026-10-13', marks: [{ student_id: f.aarav, status: 'Late' }] }, f.token);
    assert.equal(bad.error.details.field, 'marks.0.status');
  });

  it('marks holidays once per date and course', async () => {
    const all = await f.be.ok('holidays.save', { date: '2026-10-20', reason: 'Dussehra' }, f.token);
    assert.equal(all.changes.Holidays[0].course_id, '');
    const dup = await f.be.call('holidays.save', { date: '2026-10-20', reason: 'Again' }, f.token);
    assert.equal(dup.error.code, 'CONFLICT');
    await f.be.ok('holidays.save', { date: '2026-10-20', course_id: f.course('Karate').id, reason: 'Karate only' }, f.token);
    const del = await f.be.ok('holidays.delete', { id: all.changes.Holidays[0].id }, f.token);
    assert.equal(del.changes.Holidays[0].deleted, true);
  });
});

describe('deploy upkeep', () => {
  it('installs the monthly dues trigger and self-migrates after a schema change', async () => {
    const be = createBackend();
    assert.deepEqual(be.state.triggers.map((t) => t.handler), ['generateMonthlyDues']);
    const token = await be.login();
    const meta = () => Object.fromEntries(be.sheetRows('_meta').map((r) => [r.key, r.value]));
    assert.ok(meta().schema_signature);

    // Simulate a sheet set up by an older release: drop the newest Payments column.
    const sheet = be.state.spreadsheet.getSheetByName('Payments');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    sheet.cells.delete(`1,${headers.indexOf('client_ref') + 1}`);
    const metaSheet = be.state.spreadsheet.getSheetByName('_meta');
    const metaKeys = metaSheet.getRange(1, 1, metaSheet.getLastRow(), 1).getValues().map((r) => r[0]);
    metaSheet.cells.set(`${metaKeys.indexOf('schema_signature') + 1},2`, 'old');

    await be.ok('system.bootstrap', {}, token);
    assert.ok(be.sheetRows('Payments').length === 0);
    const after = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    assert.ok(after.includes('client_ref'));
    assert.notEqual(meta().schema_signature, 'old');
  });
});
