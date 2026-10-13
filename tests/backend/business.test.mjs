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

describe('enquiries', () => {
  it('saves, follows up, loses and converts enquiries', async () => {
    const { be, token } = await seeded();
    const boot = await be.ok('system.bootstrap', {}, token);
    assert.ok(Array.isArray(boot.Enquiries));
    const course = boot.Courses[0];

    const created = (await be.ok('enquiries.save', { row: { name: 'Meena', phone: '98480 12345', course_interested: course.id } }, token)).changes.Enquiries[0];
    assert.match(created.id, /^ENQ/);
    assert.equal(created.phone, '+919848012345');
    assert.equal(created.status, 'New');
    assert.equal(created.source, 'Walk-in');
    assert.equal(created.enquiry_date, '2026-10-13');

    const followed = (await be.ok('enquiries.save', { row: { id: created.id, status: 'Follow-up', next_followup_date: '2026-10-15' } }, token)).changes.Enquiries[0];
    assert.equal(followed.name, 'Meena');
    assert.equal(followed.next_followup_date, '2026-10-15');

    const noReason = await be.call('enquiries.save', { row: { id: created.id, status: 'Lost' } }, token);
    assert.equal(noReason.error.details.field, 'lost_reason');
    const lost = (await be.ok('enquiries.save', { row: { id: created.id, status: 'Lost', lost_reason: 'Too far' } }, token)).changes.Enquiries[0];
    assert.equal(lost.next_followup_date, '');

    const badPhone = await be.call('enquiries.save', { row: { name: 'X', phone: '12' } }, token);
    assert.equal(badPhone.error.details.field, 'phone');

    const res = await be.ok('admissions.create', {
      enquiry_id: created.id,
      parent: { guardian_name: 'Meena', phone: '98480 12345' },
      students: [{ name: 'Diya', extra: { syllabus: 'CBSE' } }],
    }, token);
    assert.equal(res.changes.Enquiries[0].status, 'Converted');
    assert.equal(res.changes.Enquiries[0].converted_student_id, res.student_ids[0]);
    assert.equal(res.changes.Enquiries[0].lost_reason, '');

    const del = await be.ok('enquiries.delete', { id: created.id }, token);
    assert.equal(del.changes.Enquiries[0].deleted, true);
    assert.equal((await be.ok('system.bootstrap', {}, token)).Enquiries.length, 0);
  });
});

describe('expenses', () => {
  it('records, edits and deletes expenses', async () => {
    const { be, token } = await seeded();
    const boot = await be.ok('system.bootstrap', {}, token);
    const rent = boot.ExpenseCategories[0];
    assert.ok(rent, 'preset has expense categories');

    const saved = (await be.ok('expenses.save', { row: { category_id: rent.id, amount: 15000, payee: 'Landlord', mode: 'Bank' } }, token)).changes.Expenses[0];
    assert.match(saved.id, /^EXP/);
    assert.equal(saved.date, '2026-10-13');
    assert.equal(saved.source, 'Manual');

    const edited = (await be.ok('expenses.save', { row: { id: saved.id, amount: 16000 } }, token)).changes.Expenses[0];
    assert.equal(edited.amount, 16000);
    assert.equal(edited.payee, 'Landlord');

    assert.equal((await be.call('expenses.save', { row: { category_id: 'nope', amount: 10 } }, token)).error.details.field, 'category_id');
    assert.equal((await be.call('expenses.save', { row: { category_id: rent.id, amount: 0 } }, token)).error.details.field, 'amount');
    assert.equal((await be.call('expenses.save', { row: { category_id: rent.id, amount: 5, mode: 'Gold' } }, token)).error.details.field, 'mode');

    const inUse = await be.call('catalog.delete', { tab: 'ExpenseCategories', id: rent.id }, token);
    assert.equal(inUse.error.code, 'CONFLICT');

    await be.ok('expenses.delete', { id: saved.id }, token);
    assert.equal((await be.ok('system.bootstrap', {}, token)).Expenses.length, 0);
  });

  it('creates recurring expenses once a month, on their day, without recreating deleted ones', async () => {
    const { be, token: first } = await seeded();
    let token = first;
    const moveTo = async (day) => { be.state.today = day; token = await be.login(); };
    const cat = (await be.ok('system.bootstrap', {}, token)).ExpenseCategories[0];
    const rec = (await be.ok('catalog.save', { tab: 'RecurringExpenses', row: { category_id: cat.id, amount: 15000, payee: 'Landlord', day_of_month: 5, auto_create: true } }, token)).changes.RecurringExpenses[0];
    assert.match(rec.id, /^REC/);
    await be.ok('catalog.save', { tab: 'RecurringExpenses', row: { category_id: cat.id, amount: 900, payee: 'Internet', day_of_month: 20, auto_create: true } }, token);
    await be.ok('catalog.save', { tab: 'RecurringExpenses', row: { category_id: cat.id, amount: 500, payee: 'Manual one', day_of_month: 1, auto_create: false } }, token);
    assert.equal((await be.call('catalog.save', { tab: 'RecurringExpenses', row: { category_id: cat.id, amount: 1, payee: 'x', day_of_month: 31 } }, token)).error.code, 'VALIDATION');

    // already ran today (during the earlier bootstrap), so nothing until tomorrow
    assert.equal((await be.ok('system.bootstrap', {}, token)).Expenses.length, 0);

    await moveTo('2026-10-14');
    const boot = await be.ok('system.bootstrap', {}, token);
    assert.equal(boot.Expenses.length, 1);
    assert.equal(boot.Expenses[0].date, '2026-10-05');
    assert.equal(boot.Expenses[0].source, 'Recurring');
    assert.equal(boot.Expenses[0].ref_id, `${rec.id}:2026-10`);

    const dup = await be.call('expenses.save', { row: { category_id: cat.id, amount: 15000, ref_id: `${rec.id}:2026-10` } }, token);
    assert.equal(dup.error.code, 'CONFLICT');

    await be.ok('expenses.delete', { id: boot.Expenses[0].id }, token);
    await moveTo('2026-10-21');
    const later = (await be.ok('system.bootstrap', {}, token)).Expenses;
    assert.deepEqual(later.map((e) => e.payee), ['Internet']);

    await moveTo('2026-11-06');
    const since = '2026-10-30T00:00:00.000Z';
    const delta = await be.ok('system.sync', { since }, token);
    assert.deepEqual(delta.Expenses.map((e) => e.date), ['2026-11-05']);
  });

  it('saves balance items', async () => {
    const { be, token } = await seeded();
    const item = (await be.ok('catalog.save', { tab: 'BalanceItems', row: { type: 'Asset', name: 'Mats and equipment', amount: 40000 } }, token)).changes.BalanceItems[0];
    assert.equal(item.as_of_date, '2026-10-13');
    assert.equal((await be.call('catalog.save', { tab: 'BalanceItems', row: { type: 'Equity', name: 'x', amount: 1 } }, token)).error.code, 'VALIDATION');
  });
});
