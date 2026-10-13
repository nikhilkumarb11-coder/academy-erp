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

describe('messages', () => {
  it('edits templates and groups through catalog.save', async () => {
    const { be, token } = await seeded();
    const boot = await be.ok('system.bootstrap', {}, token);
    assert.ok(Array.isArray(boot.WhatsAppGroups), 'groups are cached on devices');
    const reminder = boot.MessageTemplates.find((t) => t.type === 'FeeReminder');

    const edited = await be.ok('catalog.save', { tab: 'MessageTemplates', row: { id: reminder.id, text: 'Hi {parent}, ₹{balance} is due.' } }, token);
    assert.equal(edited.changes.MessageTemplates[0].text, 'Hi {parent}, ₹{balance} is due.');
    assert.equal(edited.changes.MessageTemplates[0].type, 'FeeReminder');

    const bad = await be.call('catalog.save', { tab: 'MessageTemplates', row: { type: 'Spam', name: 'x', text: 'y' } }, token);
    assert.equal(bad.error.code, 'VALIDATION');

    const group = await be.ok('catalog.save', { tab: 'WhatsAppGroups', row: { name: 'Karate parents' } }, token);
    assert.match(group.changes.WhatsAppGroups[0].id, /^WAG/);
    const dup = await be.call('catalog.save', { tab: 'WhatsAppGroups', row: { name: 'Karate parents' } }, token);
    assert.equal(dup.ok, false);
  });

  it('logs sent messages, stamps groups and lists recent ones newest first', async () => {
    const { be, token } = await seeded();
    const group = (await be.ok('catalog.save', { tab: 'WhatsAppGroups', row: { name: 'All parents' } }, token)).changes.WhatsAppGroups[0];

    const first = await be.ok('messages.log', { entries: [
      { type: 'FeeReminder', parent_id: 'PAR-1', preview: 'Dear Ravi,\n\nfee   pending' },
      { type: 'FeeReminder', parent_id: 'PAR-2', preview: 'x'.repeat(500) },
    ] }, token);
    assert.equal(first.logged.length, 2);
    assert.equal(first.logged[0].preview, 'Dear Ravi, fee pending');
    assert.equal(first.logged[1].preview.length, 200);
    assert.equal(first.logged[0].channel, 'WhatsApp');
    assert.deepEqual(first.changes.WhatsAppGroups, []);

    const sent = await be.ok('messages.log', { entries: [{ type: 'Event', channel: 'Copy', group_id: group.id, preview: 'Sports day' }] }, token);
    assert.equal(sent.changes.WhatsAppGroups[0].id, group.id);
    assert.ok(sent.changes.WhatsAppGroups[0].last_sent_at);

    const { rows } = await be.ok('messages.recent', {}, token);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].type, 'Event');

    const invalid = await be.call('messages.log', { entries: [{ type: 'Nope' }] }, token);
    assert.equal(invalid.error.code, 'VALIDATION');
    const empty = await be.call('messages.log', { entries: [] }, token);
    assert.equal(empty.error.code, 'VALIDATION');
  });

  it('adds the group_id column to an existing log on upgrade', async () => {
    const { be, token } = await seeded();
    await be.ok('system.migrate', {}, token);
    const headers = be.state.spreadsheet.getSheetByName('MessageLog').getRange(1, 1, 1, 9).getValues()[0];
    assert.ok(headers.includes('group_id'));
  });
});
