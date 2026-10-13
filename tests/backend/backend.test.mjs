import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createBackend, loadPreset } from './harness.mjs';

const PASSWORD = 'correct-horse-1';

async function seeded() {
  const be = createBackend({ password: PASSWORD });
  const token = await be.login();
  await be.ok('system.seed', { preset: loadPreset('multi-activity') }, token);
  const boot = await be.ok('system.bootstrap', {}, token);
  const course = (name) => boot.Courses.find((c) => c.name === name);
  const plan = (name) => boot.FeePlans.find((p) => p.name.startsWith(name));
  return { be, token, boot, course, plan };
}

describe('setup and migrations', () => {
  it('creates every tab, removes Sheet1, and records schema version', async () => {
    const be = createBackend();
    const names = be.state.spreadsheet.getSheets().map((s) => s.getName());
    assert.equal(names.length, 29);
    assert.ok(!names.includes('Sheet1'));
    const meta = Object.fromEntries(be.sheetRows('_meta').map((r) => [r.key, r.value]));
    assert.equal(meta.schema_version, '1');
    assert.equal(be.state.props.INITIAL_PASSWORD, undefined, 'initial password is deleted after hashing');
    assert.ok(be.state.props.PASSWORD_HASH && be.state.props.TOKEN_SECRET);
  });

  it('is idempotent: a second migrate changes nothing', async () => {
    const be = createBackend();
    // JSON round-trip: objects from the VM realm have different prototypes.
    const report = JSON.parse(JSON.stringify(be.execution().Migrate.run()));
    assert.deepEqual(report.tabsCreated, []);
    assert.deepEqual(report.columnsAdded, {});
    assert.deepEqual(report.settingsAdded, []);
  });

  it('does not stack duplicate header protections', async () => {
    const be = createBackend();
    be.execution().Migrate.run();
    const students = be.state.spreadsheet.getSheetByName('Students');
    assert.equal(students.protections.length, 1);
  });
});

describe('auth', () => {
  it('rejects a wrong password and accepts the right one', async () => {
    const be = createBackend({ password: PASSWORD });
    const bad = await be.call('auth.login', { password: 'nope' });
    assert.equal(bad.error.code, 'AUTH');
    const token = await be.login();
    const boot = await be.call('system.bootstrap', {}, token);
    assert.equal(boot.ok, true);
  });

  it('locks out after 5 failed attempts', async () => {
    const be = createBackend({ password: PASSWORD });
    for (let i = 0; i < 5; i++) await be.call('auth.login', { password: 'nope' });
    const res = await be.call('auth.login', { password: PASSWORD });
    assert.equal(res.error.code, 'LOCKED');
  });

  it('rejects missing and tampered tokens', async () => {
    const be = createBackend({ password: PASSWORD });
    const token = await be.login();
    assert.equal((await be.call('system.bootstrap', {}, null)).error.code, 'AUTH');
    const [body, sig] = token.split('.');
    const tampered = `${body.slice(0, -2)}xx.${sig}`;
    assert.equal((await be.call('system.bootstrap', {}, tampered)).error.code, 'AUTH');
    assert.equal((await be.call('system.bootstrap', {}, 'garbage')).error.code, 'AUTH');
  });

  it('password change revokes old sessions', async () => {
    const be = createBackend({ password: PASSWORD });
    const oldToken = await be.login();
    const fresh = await be.ok('auth.changePassword', { current: PASSWORD, next: 'new-password-2' }, oldToken);
    assert.equal((await be.call('system.bootstrap', {}, oldToken)).error.code, 'AUTH');
    assert.equal((await be.call('system.bootstrap', {}, fresh.token)).ok, true);
    assert.equal((await be.call('auth.login', { password: PASSWORD })).error.code, 'AUTH');
  });
});

describe('seed', () => {
  it('loads the preset once and refuses a second time', async () => {
    const { be, token, boot } = await seeded();
    assert.equal(boot.Courses.length, 10);
    assert.equal(boot.Categories.length, 5);
    assert.equal(boot.FeePlans.length, 2);
    assert.equal(boot.CustomFields[0].options, 'SSC|CBSE|ICSE|Other');
    const again = await be.call('system.seed', { preset: loadPreset('multi-activity') }, token);
    assert.equal(again.error.code, 'CONFLICT');
  });
});

describe('catalog', () => {
  let ctx;
  beforeEach(async () => { ctx = await seeded(); });

  it('creates and edits a course; fee stays numeric', async () => {
    const { be, token, boot } = ctx;
    const cat = boot.Categories[0];
    const created = await be.ok('catalog.save', { tab: 'Courses', row: { category_id: cat.id, name: 'Bharatanatyam', monthly_fee: '1200' } }, token);
    const course = created.changes.Courses[0];
    assert.equal(course.monthly_fee, 1200);
    assert.equal(course.active, true);
    assert.ok(course.sort_order > 10);

    const edited = await be.ok('catalog.save', { tab: 'Courses', row: { id: course.id, monthly_fee: 1500 } }, token);
    assert.equal(edited.changes.Courses[0].monthly_fee, 1500);
    assert.equal(edited.changes.Courses[0].name, 'Bharatanatyam');
  });

  it('rejects duplicate names, bad numbers and unknown categories', async () => {
    const { be, token, boot } = ctx;
    const cat = boot.Categories[0].id;
    assert.equal((await be.call('catalog.save', { tab: 'Courses', row: { category_id: cat, name: 'karate' } }, token)).error.code, 'CONFLICT');
    const bad = await be.call('catalog.save', { tab: 'Courses', row: { category_id: cat, name: 'X', monthly_fee: 'abc' } }, token);
    assert.equal(bad.error.code, 'VALIDATION');
    assert.equal(bad.error.details.field, 'monthly_fee');
    assert.equal((await be.call('catalog.save', { tab: 'Courses', row: { category_id: 'nope', name: 'Y' } }, token)).error.code, 'VALIDATION');
    assert.equal((await be.call('catalog.save', { tab: 'Nope', row: {} }, token)).error.code, 'VALIDATION');
  });

  it('refuses to delete a category that still has courses', async () => {
    const { be, token, boot } = ctx;
    const res = await be.call('catalog.delete', { tab: 'Categories', id: boot.Categories[0].id }, token);
    assert.equal(res.error.code, 'CONFLICT');
  });

  it('soft-deletes an unused batch and sync reports it as deleted', async () => {
    const { be, token, course } = ctx;
    const before = (await be.ok('system.ping', {}, token)).serverTime;
    const b = (await be.ok('catalog.save', { tab: 'Batches', row: { course_id: course('Karate').id, name: 'Mon/Wed 5pm' } }, token)).changes.Batches[0];
    const del = await be.ok('catalog.delete', { tab: 'Batches', id: b.id }, token);
    assert.equal(del.changes.Batches[0].deleted, true);
    const delta = await be.ok('system.sync', { since: before }, token);
    assert.ok(delta.Batches.some((x) => x.id === b.id && (x.deleted === true || x.deleted === 'TRUE')));
    const boot = await be.ok('system.bootstrap', {}, token);
    assert.ok(!boot.Batches.some((x) => x.id === b.id));
  });

  it('validates fee plans and keeps at least one active', async () => {
    const { be, token, boot } = ctx;
    const bad = await be.call('catalog.save', { tab: 'FeePlans', row: { name: 'Q', frequency: 'Weekly', months_covered: 3 } }, token);
    assert.equal(bad.error.code, 'VALIDATION');
    const q = await be.ok('catalog.save', { tab: 'FeePlans', row: { name: 'Quarterly', frequency: 'Quarterly', months_covered: 3, discount_pct: 5 } }, token);
    assert.equal(q.changes.FeePlans[0].discount_pct, 5);
    for (const p of boot.FeePlans) await be.ok('catalog.save', { tab: 'FeePlans', row: { id: p.id, active: false } }, token);
    const last = await be.call('catalog.save', { tab: 'FeePlans', row: { id: q.changes.FeePlans[0].id, active: false } }, token);
    assert.equal(last.error.code, 'VALIDATION');
  });
});

describe('admissions', () => {
  let ctx;
  beforeEach(async () => { ctx = await seeded(); });

  function admission(c, overrides = {}) {
    return {
      parent: { guardian_name: 'Ravi Kumar', phone: '98765 43210', address: 'Hyderabad' },
      students: [
        {
          name: 'Aarav', class: '5', extra: { syllabus: 'CBSE', unknown: 'dropped' },
          enrollments: [
            { course_id: c.course('Karate').id, fee_plan_id: c.plan('Monthly').id, start_date: '2026-10-13' },
            { course_id: c.course('Abacus').id, fee_plan_id: c.plan('Annual').id, start_date: '2026-10-13' },
          ],
        },
        {
          name: 'Diya', class: '3',
          enrollments: [
            { course_id: c.course('Drawing').id, fee_plan_id: c.plan('Monthly').id },
            { course_id: c.course('Chess').id, fee_plan_id: c.plan('Monthly').id },
          ],
        },
      ],
      ...overrides,
    };
  }

  it('admits a parent with two children in two courses each', async () => {
    const { be, token } = ctx;
    const res = await be.ok('admissions.create', admission(ctx), token);
    assert.equal(res.changes.Parents.length, 1);
    assert.equal(res.changes.Students.length, 2);
    assert.equal(res.changes.Enrollments.length, 4);
    assert.equal(res.changes.Parents[0].phone, '+919876543210');
    assert.equal(res.changes.Students[0].extra, '{"syllabus":"CBSE"}');

    // Read back through a fresh execution: dates and phones must come back as text, not Date/number.
    const boot = await be.ok('system.bootstrap', {}, token);
    const enr = boot.Enrollments.find((e) => e.student_id === res.student_ids[0]);
    assert.equal(enr.start_date, '2026-10-13');
    assert.equal(typeof boot.Parents[0].phone, 'string');
    assert.equal(boot.Students[0].status, 'Active');
    assert.match(boot.Students[0].join_date, /^\d{4}-\d{2}-\d{2}$/);

    const audit = be.sheetRows('AuditLog').find((r) => r.action === 'admission.create');
    assert.match(audit.summary, /Aarav, Diya \(4 course/);
  });

  it('warns about a duplicate phone and returns the existing parent', async () => {
    const { be, token } = ctx;
    const first = await be.ok('admissions.create', admission(ctx), token);
    const dup = await be.call('admissions.create', admission(ctx, { parent: { guardian_name: 'Someone', phone: '+91 98765-43210' } }), token);
    assert.equal(dup.error.code, 'CONFLICT');
    assert.equal(dup.error.details.parent_id, first.parent_id);

    const sibling = await be.ok('admissions.create', {
      parent: { id: first.parent_id },
      students: [{ name: 'Kabir', enrollments: [] }],
    }, token);
    assert.equal(sibling.changes.Parents.length, 0);
    assert.equal(sibling.changes.Students[0].parent_id, first.parent_id);
  });

  it('rejects the same course twice, inactive courses, bad phones and invalid select values', async () => {
    const { be, token } = ctx;
    const twice = admission(ctx);
    twice.students[0].enrollments[1].course_id = ctx.course('Karate').id;
    assert.equal((await be.call('admissions.create', twice, token)).error.code, 'VALIDATION');

    await be.ok('catalog.save', { tab: 'Courses', row: { id: ctx.course('Chess').id, active: false } }, token);
    const inactive = await be.call('admissions.create', admission(ctx, { parent: { guardian_name: 'A', phone: '9000000001' } }), token);
    assert.equal(inactive.error.code, 'VALIDATION');
    assert.match(inactive.error.message, /Chess is not active/);

    const badPhone = await be.call('admissions.create', { parent: { guardian_name: 'B', phone: '123' }, students: [{ name: 'Y' }] }, token);
    assert.equal(badPhone.error.details.field, 'parent.phone');

    const badSelect = admission(ctx, { parent: { guardian_name: 'C', phone: '9000000002' } });
    badSelect.students = [{ name: 'Z', extra: { syllabus: 'IB' } }];
    assert.equal((await be.call('admissions.create', badSelect, token)).error.details.field, 'students.0.extra.syllabus');
  });

  it('writes nothing when any part of the admission is invalid', async () => {
    const { be, token } = ctx;
    const broken = admission(ctx);
    broken.students[1].name = '';
    assert.equal((await be.call('admissions.create', broken, token)).error.code, 'VALIDATION');
    assert.equal(be.sheetRows('Parents').length, 0);
    assert.equal(be.sheetRows('Students').length, 0);
  });
});

describe('student status and enrollments', () => {
  let ctx;
  let ids;
  beforeEach(async () => {
    ctx = await seeded();
    const res = await ctx.be.ok('admissions.create', {
      parent: { guardian_name: 'P', phone: '9111111111' },
      students: [{
        name: 'S',
        enrollments: [
          { course_id: ctx.course('Karate').id, fee_plan_id: ctx.plan('Monthly').id },
          { course_id: ctx.course('Abacus').id, fee_plan_id: ctx.plan('Monthly').id },
        ],
      }],
    }, ctx.token);
    ids = { student: res.student_ids[0], enrollments: res.changes.Enrollments.map((e) => e.id) };
  });

  const enrollmentsOf = async (be, token, studentId) =>
    (await be.ok('system.bootstrap', {}, token)).Enrollments.filter((e) => e.student_id === studentId);

  it('requires a reason when leaving Active', async () => {
    const res = await ctx.be.call('students.setStatus', { id: ids.student, status: 'On hold' }, ctx.token);
    assert.equal(res.error.details.field, 'reason');
  });

  it('On hold pauses courses and Active resumes them', async () => {
    const { be, token } = ctx;
    const hold = await be.ok('students.setStatus', { id: ids.student, status: 'On hold', reason: 'Exams' }, token);
    assert.equal(hold.changes.Enrollments.length, 2);
    assert.ok((await enrollmentsOf(be, token, ids.student)).every((e) => e.status === 'On hold'));
    await be.ok('students.setStatus', { id: ids.student, status: 'Active' }, token);
    const after = await enrollmentsOf(be, token, ids.student);
    assert.ok(after.every((e) => e.status === 'Active' && e.status_reason === ''));
  });

  it('Dropped closes courses with an end date and blocks new courses', async () => {
    const { be, token } = ctx;
    await be.ok('students.setStatus', { id: ids.student, status: 'Dropped', reason: 'Moved city' }, token);
    const closed = await enrollmentsOf(be, token, ids.student);
    assert.ok(closed.every((e) => e.status === 'Dropped' && /^\d{4}-\d{2}-\d{2}$/.test(e.end_date)));
    const add = await be.call('enrollments.save', { student_id: ids.student, course_id: ctx.course('Chess').id, fee_plan_id: ctx.plan('Monthly').id }, token);
    assert.equal(add.error.code, 'CONFLICT');
    // Re-activating the student does not silently restart dropped courses.
    await be.ok('students.setStatus', { id: ids.student, status: 'Active' }, token);
    assert.ok((await enrollmentsOf(be, token, ids.student)).every((e) => e.status === 'Dropped'));
  });

  it('adds a course, refuses duplicates, edits the batch, and ends a course', async () => {
    const { be, token } = ctx;
    const dup = await be.call('enrollments.save', { student_id: ids.student, course_id: ctx.course('Karate').id, fee_plan_id: ctx.plan('Monthly').id }, token);
    assert.equal(dup.error.code, 'CONFLICT');

    const added = await be.ok('enrollments.save', { student_id: ids.student, course_id: ctx.course('Chess').id, fee_plan_id: ctx.plan('Annual').id }, token);
    const enr = added.changes.Enrollments[0];
    assert.equal(enr.status, 'Active');

    const batch = (await be.ok('catalog.save', { tab: 'Batches', row: { course_id: ctx.course('Chess').id, name: 'Sat 10am' } }, token)).changes.Batches[0];
    const edited = await be.ok('enrollments.save', { id: enr.id, batch_id: batch.id }, token);
    assert.equal(edited.changes.Enrollments[0].batch_id, batch.id);
    assert.equal(edited.changes.Enrollments[0].fee_plan_id, ctx.plan('Annual').id);

    const wrongBatch = await be.call('enrollments.save', { id: ids.enrollments[0], batch_id: batch.id }, token);
    assert.equal(wrongBatch.error.code, 'VALIDATION');

    const ended = await be.ok('enrollments.setStatus', { id: enr.id, status: 'Completed', reason: 'Finished level 1', end_date: '2026-12-31' }, token);
    assert.equal(ended.changes.Enrollments[0].end_date, '2026-12-31');
  });

  it('a course used by active students cannot be deleted', async () => {
    const res = await ctx.be.call('catalog.delete', { tab: 'Courses', id: ctx.course('Karate').id }, ctx.token);
    assert.equal(res.error.code, 'CONFLICT');
  });

  it('parents.save keeps phones unique', async () => {
    const { be, token } = ctx;
    const other = await be.ok('admissions.create', { parent: { guardian_name: 'Q', phone: '9222222222' }, students: [{ name: 'T' }] }, token);
    const parentId = (await be.ok('system.bootstrap', {}, token)).Parents.find((p) => p.guardian_name === 'P').id;
    const clash = await be.call('parents.save', { id: parentId, phone: '9222222222' }, token);
    assert.equal(clash.error.code, 'CONFLICT');
    assert.equal(clash.error.details.parent_id, other.parent_id);
    const okRes = await be.ok('parents.save', { id: parentId, address: 'New address' }, token);
    assert.equal(okRes.changes.Parents[0].address, 'New address');
    assert.equal(okRes.changes.Parents[0].phone, '+919111111111');
  });
});
