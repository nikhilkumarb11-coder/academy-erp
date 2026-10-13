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
    // { handler: 'reconcilePaymentLinks', build: (t) => t.timeBased().everyMinutes(15) },       // phase 4
    // { handler: 'dailyBackup', build: (t) => t.timeBased().everyDays(1).atHour(2) },           // phase 6
  ];
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  wanted.forEach((w) => w.build(ScriptApp.newTrigger(w.handler)).create());
}

/** Emergency reset from the editor: set INITIAL_PASSWORD, run this, and every device is logged out. */
function resetPasswordFromProperty() {
  const initial = Util.prop('INITIAL_PASSWORD', true);
  Auth.setPassword(initial);
  PropertiesService.getScriptProperties().deleteProperty('INITIAL_PASSWORD');
}
