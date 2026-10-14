/**
 * Brings a tenant spreadsheet up to the current SCHEMA. Safe to run any number of times:
 *  1. creates missing tabs and appends missing columns (never removes or renames),
 *  2. runs data migrations newer than _meta.schema_version, in order,
 *  3. adds any DEFAULT_SETTINGS keys the tenant does not have yet.
 *
 * To change the schema: append columns in Schema.js; add an entry to DATA_MIGRATIONS
 * only when existing rows need transforming or back-filling.
 */
const DATA_MIGRATIONS = [
  // { version: 2, name: 'backfill_due_parent_id', up: () => { ... } },
];

const Migrate = (() => {
  const HEADER_PROTECTION = 'Header row: change via migrations only';

  function run() {
    return Db.withLock(() => {
      const report = { tabsCreated: [], columnsAdded: {}, migrationsRun: [], settingsAdded: [] };
      syncSchema(report);
      runDataMigrations(report);
      addDefaultSettings(report);
      Db.setMapValues('_meta', { schema_signature: signature() });
      Util.setProp('data_rev', Util.newId('REV')); // new columns: drop the cached login snapshot
      return report;
    });
  }

  function syncSchema(report) {
    const ss = Db.ss();
    Object.keys(SCHEMA).forEach((tab) => {
      const wanted = SCHEMA[tab];
      let sh = ss.getSheetByName(tab);
      if (!sh) {
        sh = ss.insertSheet(tab);
        sh.getRange(1, 1, 1, wanted.length).setValues([wanted]);
        formatColumns(sh, wanted, 1);
        styleHeader(sh, wanted.length);
        report.tabsCreated.push(tab);
        Db.invalidate(tab);
        return;
      }
      const lastCol = sh.getLastColumn();
      const existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
      const missing = wanted.filter((c) => !existing.includes(c));
      if (missing.length) {
        sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
        formatColumns(sh, missing, existing.length + 1);
        styleHeader(sh, existing.length + missing.length);
        report.columnsAdded[tab] = missing;
        Db.invalidate(tab);
      }
    });
    removeDefaultSheet(ss);
  }

  function formatColumns(sh, columns, firstColIndex) {
    columns.forEach((c, i) => {
      if (TEXT_COLUMN_PATTERN.test(c)) sh.getRange(1, firstColIndex + i, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  }

  function styleHeader(sh, width) {
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#0B1F3A').setFontColor('#FFFFFF');
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
      .filter((p) => p.getDescription() === HEADER_PROTECTION)
      .forEach((p) => p.remove());
    const protection = sh.getRange(1, 1, 1, width).protect().setDescription(HEADER_PROTECTION);
    protection.setWarningOnly(true);
  }

  function removeDefaultSheet(ss) {
    const blank = ss.getSheetByName('Sheet1');
    if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  }

  function signature() {
    return Util.sha256Hex(JSON.stringify([SCHEMA, Object.keys(DEFAULT_SETTINGS), DATA_MIGRATIONS.length])).slice(0, 16);
  }

  /**
   * Runs the migration once after a deploy that changed the schema; a cheap no-op otherwise.
   * A confirmed signature is remembered in CacheService, so most requests never open _meta.
   */
  function ensureCurrent() {
    const sig = signature();
    const cache = CacheService.getScriptCache();
    if (cache.get('schema_signature') === sig) return null;
    const report = Db.getMap('_meta').schema_signature === sig ? null : run();
    cache.put('schema_signature', sig, 6 * 3600);
    return report;
  }

  function currentVersion() {
    return Number(Db.getMap('_meta').schema_version || 0);
  }

  function runDataMigrations(report) {
    const from = currentVersion();
    DATA_MIGRATIONS
      .filter((m) => m.version > from)
      .sort((a, b) => a.version - b.version)
      .forEach((m) => {
        m.up();
        Db.setMapValues('_meta', { schema_version: m.version });
        report.migrationsRun.push(`${m.version}_${m.name}`);
      });
    const latest = DATA_MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 1);
    if (currentVersion() < latest) Db.setMapValues('_meta', { schema_version: latest });
    Db.setMapValues('_meta', { api_version: API_VERSION, last_migrated_at: Util.nowIso() });
  }

  function addDefaultSettings(report) {
    const current = Db.getMap('Settings');
    const missing = {};
    Object.keys(DEFAULT_SETTINGS).forEach((k) => {
      if (!(k in current)) missing[k] = DEFAULT_SETTINGS[k];
    });
    if (Object.keys(missing).length) {
      Db.setMapValues('Settings', missing);
      report.settingsAdded = Object.keys(missing);
    }
  }

  return { run, ensureCurrent, currentVersion };
})();
