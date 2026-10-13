import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBackend, loadPreset } from './harness.mjs';

async function seeded() {
  const be = createBackend();
  be.state.today = '2026-10-13';
  const token = await be.login();
  await be.ok('system.seed', { preset: loadPreset('multi-activity') }, token);
  return { be, token };
}

describe('backups', () => {
  it('copies the spreadsheet into a backup folder and remembers it', async () => {
    const { be, token } = await seeded();
    assert.deepEqual(await be.ok('system.backupStatus', {}, token), { last: null, count: 0, keep: 30 });

    const res = await be.ok('system.backup', {}, token);
    assert.match(res.backup.name, / backup 2026-10-13 10:\d\d$/);
    assert.equal(res.backup.kind, 'manual');
    assert.equal(res.status.count, 1);

    const folderId = be.state.props.BACKUP_FOLDER_ID;
    assert.ok(folderId);
    assert.match(be.state.drive.folders[folderId], /Backups$/);
    const copy = be.state.drive.files[res.backup.id];
    assert.equal(copy.copyOf, 'sheet-under-test');
    assert.equal(copy.folderId, folderId);

    await be.ok('system.backup', {}, token);
    assert.equal(be.state.props.BACKUP_FOLDER_ID, folderId, 'reuses the folder');
    assert.equal((await be.ok('system.backupStatus', {}, token)).count, 2);
  });

  it('keeps the newest 30 copies and trashes older ones', async () => {
    const { be, token } = await seeded();
    const ids = [];
    for (let i = 0; i < 32; i++) ids.push((await be.ok('system.backup', {}, token)).backup.id);
    const status = await be.ok('system.backupStatus', {}, token);
    assert.equal(status.count, 30);
    assert.equal(status.last.id, ids[31]);
    assert.equal(be.state.drive.files[ids[0]].trashed, true);
    assert.equal(be.state.drive.files[ids[1]].trashed, true);
    assert.equal(be.state.drive.files[ids[2]].trashed, false);
  });

  it('dailyBackup skips when a backup is less than 20 hours old', async () => {
    const { be, token } = await seeded();
    be.execution().dailyBackup();
    be.execution().dailyBackup();
    let status = await be.ok('system.backupStatus', {}, token);
    assert.equal(status.count, 1);
    assert.equal(status.last.kind, 'daily');

    be.state.today = '2026-10-14';
    be.execution().dailyBackup();
    const fresh = await be.login();
    status = await be.ok('system.backupStatus', {}, fresh);
    assert.equal(status.count, 2);
  });

  it('requires a session', async () => {
    const be = createBackend();
    assert.equal((await be.call('system.backup', {})).error.code, 'AUTH');
  });
});

describe('import', () => {
  const rows = [
    { guardian_name: 'Ravi Kumar', phone: '98765 43210', student_name: 'Aarav', class: '5', join_date: '2025-06-10', courses: 'karate; Abacus', opening_due: '1500' },
    { guardian_name: 'Ravi K', phone: '+91 9876543210', student_name: 'Diya', courses: 'Drawing', fee_plan: 'Annual (10 months)' },
    { guardian_name: 'Ravi Kumar', phone: '9876543210', student_name: 'aarav' },
    { guardian_name: 'Meena', phone: '8888888888888888', student_name: 'Kiran' },
    { guardian_name: 'Meena', phone: '9000000001', student_name: 'Kiran', courses: 'Swimming' },
    { guardian_name: 'Sita', phone: '9000000002', student_name: 'Lakshmi', dob: '12/03/2015' },
  ];

  it('previews without writing, flagging duplicates and errors', async () => {
    const { be, token } = await seeded();
    const res = await be.ok('import.students', { rows }, token);
    assert.deepEqual(res.results.map((r) => r.status), ['new_family', 'new_family', 'duplicate', 'error', 'error', 'error']);
    assert.match(res.results[1].message, /Same phone as Ravi Kumar/);
    assert.match(res.results[3].message, /Phone must be a 10-digit mobile number/);
    assert.match(res.results[4].message, /Course "Swimming" not found/);
    assert.match(res.results[5].message, /Date of birth must be a date/);
    assert.deepEqual(res.summary, { families: 1, existingFamilies: 0, students: 2, enrollments: 3, openingDues: 1500, duplicates: 1, errors: 3 });
    assert.equal(res.changes, undefined);
    assert.equal(be.sheetRows('Parents').length, 0);
  });

  it('commits families, enrolments and opening dues, and adds to existing families next time', async () => {
    const { be, token } = await seeded();
    const boot = await be.ok('system.bootstrap', {}, token);
    const karate = boot.Courses.find((c) => c.name === 'Karate');
    await be.ok('catalog.save', { tab: 'Courses', row: { ...karate, monthly_fee: 1000 } }, token);

    const res = await be.ok('import.students', { rows: rows.slice(0, 2), commit: true, bill_current_month: true }, token);
    assert.equal(res.changes.Parents.length, 1);
    assert.equal(res.changes.Parents[0].phone, '+919876543210');
    assert.deepEqual(res.changes.Students.map((s) => s.name), ['Aarav', 'Diya']);
    assert.equal(res.changes.Students[0].join_date, '2025-06-10');
    assert.equal(res.changes.Enrollments.length, 3);
    const annual = boot.FeePlans.find((p) => p.name.startsWith('Annual'));
    assert.equal(res.changes.Enrollments[2].fee_plan_id, annual.id);
    const opening = res.changes.FeeDues.find((d) => d.kind === 'OneTime');
    assert.equal(opening.amount_due, 1500);
    assert.equal(opening.period_label, 'Opening balance');
    assert.equal(opening.due_date, '2026-10-13');
    const monthly = res.changes.FeeDues.filter((d) => d.kind === 'Recurring');
    assert.equal(monthly.length, 1, 'only Karate has a fee');
    assert.equal(monthly[0].period_label, 'Oct 2026');

    const again = await be.ok('import.students', { rows: [rows[0], { guardian_name: 'Ravi Kumar', phone: '9876543210', student_name: 'Ishaan' }], commit: true }, token);
    assert.deepEqual(again.results.map((r) => r.status), ['duplicate', 'existing_family']);
    assert.equal(again.changes.Parents.length, 0);
    assert.equal(again.changes.Students[0].parent_id, res.changes.Parents[0].id);
    assert.equal(be.sheetRows('Students').length, 3);
  });

  it('rejects empty and oversized files', async () => {
    const { be, token } = await seeded();
    assert.equal((await be.call('import.students', { rows: [] }, token)).error.code, 'VALIDATION');
    const many = Array.from({ length: 501 }, (_, i) => ({ guardian_name: 'X', phone: `90000${String(i).padStart(5, '0')}`, student_name: 'Y' }));
    assert.match((await be.call('import.students', { rows: many }, token)).error.message, /at most 500/);
  });
});

describe('sync', () => {
  const readsOf = (be, tabs) => tabs.reduce((n, tab) => n + be.state.spreadsheet.getSheetByName(tab).reads, 0);

  it('skips tabs nothing wrote to since the last sync', async () => {
    const { be, token } = await seeded();
    const boot = await be.ok('system.bootstrap', {}, token);
    be.state.today = '2026-10-14';
    const fresh = await be.login();
    const first = await be.ok('system.sync', { since: boot.serverTime }, fresh);

    const before = readsOf(be, ['Courses', 'Students', 'Settings', 'FeeDues']);
    const quiet = await be.ok('system.sync', { since: first.serverTime }, fresh);
    assert.equal(readsOf(be, ['Courses', 'Students', 'Settings', 'FeeDues']), before, 'unchanged tabs are not read');
    assert.equal(quiet.settings, undefined);
    assert.deepEqual(quiet.Courses, []);

    const course = boot.Courses.find((c) => c.name === 'Karate');
    const plan = boot.FeePlans.find((p) => p.frequency === 'Monthly');
    await be.ok('admissions.create', {
      parent: { guardian_name: 'Asha', phone: '9000000009' },
      students: [{ name: 'Ira', enrollments: [{ course_id: course.id, fee_plan_id: plan.id }] }],
    }, fresh);
    const coursesRead = readsOf(be, ['Courses']);
    const delta = await be.ok('system.sync', { since: quiet.serverTime }, fresh);
    assert.deepEqual(delta.Students.map((s) => s.name), ['Ira']);
    assert.equal(delta.Parents.length, 1);
    assert.equal(readsOf(be, ['Courses']), coursesRead, 'courses were only read by the admission, not by sync');
  });

  it('picks up edits typed directly into the spreadsheet', async () => {
    const { be, token } = await seeded();
    const boot = await be.ok('system.bootstrap', {}, token);
    const plan = boot.FeePlans.find((p) => p.frequency === 'Monthly');
    await be.ok('admissions.create', {
      parent: { guardian_name: 'Asha', phone: '9000000009' },
      students: [{ name: 'rr', class: 'hgh', enrollments: [{ course_id: boot.Courses[0].id, fee_plan_id: plan.id }] }],
    }, token);
    be.state.today = '2026-10-14';
    const fresh = await be.login();
    const synced = await be.ok('system.sync', { since: boot.serverTime }, fresh);

    const sheet = be.state.spreadsheet.getSheetByName('Students');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const nameCell = sheet.getRange(2, headers.indexOf('name') + 1);
    nameCell.setValues([['Pranik']]);
    be.execution().onSheetEdit({ range: nameCell });

    const delta = await be.ok('system.sync', { since: synced.serverTime }, fresh);
    assert.deepEqual(delta.Students.map((s) => s.name), ['Pranik']);
  });

  it('appends audit entries without reading the log', async () => {
    const { be, token } = await seeded();
    const before = readsOf(be, ['AuditLog']);
    await be.ok('settings.update', { academy_phone: '9000000000' }, token);
    await be.ok('settings.update', { academy_phone: '9000000001' }, token);
    assert.equal(readsOf(be, ['AuditLog']) - before, 2, 'only the header row is read, once per request');
    assert.equal(be.sheetRows('AuditLog').filter((r) => r.action === 'settings.update').length, 2);
  });
});
