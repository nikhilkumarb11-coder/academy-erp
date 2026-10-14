/**
 * One-time tenant setup, run from the Apps Script editor (see docs/06-Tenant-Provisioning-Runbook.md).
 *
 * Before running: set Script Properties SPREADSHEET_ID and INITIAL_PASSWORD.
 * setupTenant() creates the schema, generates TOKEN_SECRET, hashes and then deletes
 * INITIAL_PASSWORD, and installs time-driven triggers. Running it again is safe.
 */
function setupTenant() {
  Util.prop('SPREADSHEET_ID', true);

  if (!Util.prop('TOKEN_SECRET')) {
    Util.setProp('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  const initial = Util.prop('INITIAL_PASSWORD');
  if (initial) {
    Auth.setPassword(initial);
    PropertiesService.getScriptProperties().deleteProperty('INITIAL_PASSWORD');
  } else if (!Util.prop('PASSWORD_HASH')) {
    throw new AppError('CONFIG', 'Set Script Property INITIAL_PASSWORD, then run setupTenant again');
  }

  const report = Migrate.run();
  installTriggers();
  console.log(JSON.stringify(report, null, 2));
}

/** Replaces this project's triggers with the expected set. Handlers are added in later phases. */
function installTriggers() {
  const wanted = [
    { handler: 'generateMonthlyDues', build: (t) => t.timeBased().onMonthDay(1).atHour(6) },
    { handler: 'createRecurringExpenses', build: (t) => t.timeBased().everyDays(1).atHour(7) },
    { handler: 'dailyBackup', build: (t) => t.timeBased().everyDays(1).atHour(2) },
    { handler: 'onSheetEdit', build: (t) => t.forSpreadsheet(Util.prop('SPREADSHEET_ID', true)).onEdit() },
    // { handler: 'reconcilePaymentLinks', build: (t) => t.timeBased().everyMinutes(15) },       // phase 4
  ];
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  wanted.forEach((w) => w.build(ScriptApp.newTrigger(w.handler)).create());
}

/**
 * Edits typed directly into the spreadsheet: stamps updated_at on the edited rows (those with an id)
 * and marks the tab changed, so every device picks the edit up on its next sync.
 */
function onSheetEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const tab = sheet.getName();
  if (tab !== 'Settings' && BOOTSTRAP_TABS.indexOf(tab) < 0) return;
  const now = Util.nowIso();
  if (tab !== 'Settings') {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const updatedCol = headers.indexOf('updated_at') + 1;
    const idCol = headers.indexOf('id') + 1;
    const first = Math.max(2, e.range.getRow());
    const last = e.range.getLastRow();
    const onlyUpdatedAt = e.range.getColumn() === updatedCol && e.range.getNumColumns() === 1;
    if (updatedCol && idCol && last >= first && !onlyUpdatedAt) {
      const ids = sheet.getRange(first, idCol, last - first + 1, 1).getValues();
      const target = sheet.getRange(first, updatedCol, last - first + 1, 1);
      const current = target.getValues();
      target.setValues(ids.map((r, i) => [r[0] ? now : current[i][0]]));
    }
  }
  Util.setProps({ [`stamp:${tab}`]: now, data_rev: Util.newId('REV') });
}

/** Emergency reset from the editor: set INITIAL_PASSWORD, run this, and every device is logged out. */
function resetPasswordFromProperty() {
  const initial = Util.prop('INITIAL_PASSWORD', true);
  Auth.setPassword(initial);
  PropertiesService.getScriptProperties().deleteProperty('INITIAL_PASSWORD');
}
