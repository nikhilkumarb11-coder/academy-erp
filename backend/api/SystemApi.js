const SystemApi = (() => {
  function ping() {
    return {
      apiVersion: API_VERSION,
      schemaVersion: Migrate.currentVersion(),
      serverTime: Util.nowIso(),
    };
  }

  /** Everything the client caches at login (PRD §8 performance). */
  function bootstrap() {
    Migrate.ensureCurrent();
    ExpensesApi.runRecurringIfDue();
    const data = { settings: Db.getMap('Settings'), serverTime: Util.nowIso() };
    BOOTSTRAP_TABS.forEach((tab) => { data[tab] = Db.all(tab); });
    return data;
  }

  /** Delta refresh: rows changed after `since`, including soft-deleted ones. */
  function sync(payload) {
    Util.requireFields(payload, ['since']);
    Migrate.ensureCurrent();
    ExpensesApi.runRecurringIfDue();
    const data = { settings: Db.getMap('Settings'), serverTime: Util.nowIso() };
    BOOTSTRAP_TABS.forEach((tab) => { data[tab] = Db.changedSince(tab, payload.since); });
    return data;
  }

  function migrate(payload, ctx) {
    const report = Migrate.run();
    Db.withLock(() => Audit.log('system.migrate', '_meta', '', JSON.stringify(report).slice(0, 500), ctx));
    return report;
  }

  function updateSettings(payload, ctx) {
    const allowed = Object.keys(DEFAULT_SETTINGS);
    const changes = {};
    Object.keys(payload).forEach((k) => { if (allowed.includes(k)) changes[k] = payload[k]; });
    if (!Object.keys(changes).length) throw new AppError('VALIDATION', 'No valid settings supplied');
    return Db.withLock(() => {
      Db.setMapValues('Settings', changes);
      Audit.log('settings.update', 'Settings', '', Object.keys(changes).join(', '), ctx);
      return Db.getMap('Settings');
    });
  }

  /**
   * Loads a preset (presets/*.json) into an empty tenant. Refuses if courses already exist,
   * unless payload.force is true. Category and course names are linked by name in the preset.
   */
  function seed(payload, ctx) {
    const preset = payload.preset;
    if (!preset || !preset.id) throw new AppError('VALIDATION', 'payload.preset is required');

    return Db.withLock(() => {
      if (Db.all('Courses').length && !payload.force) {
        throw new AppError('CONFLICT', 'Tenant already has courses. Pass force: true to seed anyway.');
      }

      if (preset.settings) Db.setMapValues('Settings', preset.settings);

      const categories = Db.insert('Categories', (preset.categories || []).map((name, i) => ({ name, sort_order: i + 1 })), 'CAT');
      const categoryId = (name) => {
        const c = categories.find((x) => x.name === name);
        if (!c) throw new AppError('VALIDATION', `Preset course refers to unknown category "${name}"`);
        return c.id;
      };

      Db.insert('Courses', (preset.courses || []).map((c, i) => ({
        category_id: categoryId(c.category),
        name: c.name,
        monthly_fee: c.monthly_fee === null || c.monthly_fee === undefined ? '' : c.monthly_fee,
        classes_per_week: c.classes_per_week || '',
        description: c.description || '',
        active: true,
        sort_order: i + 1,
      })), 'CRS');

      Db.insert('FeePlans', (preset.feePlans || []).map((p, i) => ({ ...p, active: true, sort_order: i + 1 })), 'FPL');
      Db.insert('ChargeItems', (preset.chargeItems || []).map((c) => ({ ...c, active: true })), 'CHG');
      Db.insert('ExpenseCategories', (preset.expenseCategories || []).map((name, i) => ({ name, sort_order: i + 1 })), 'ECT');
      Db.insert('MessageTemplates', (preset.messageTemplates || []).map((t) => ({ ...t, active: true })), 'TPL');
      Db.insert('CustomFields', (preset.customFields || []).map((f, i) => ({
        ...f,
        options: Array.isArray(f.options) ? f.options.join('|') : (f.options || ''),
        sort_order: i + 1,
        active: true,
      })), 'CFD');

      Db.setMapValues('_meta', { preset: preset.id, seeded_at: Util.nowIso() });
      Audit.log('system.seed', '_meta', '', `Preset ${preset.id}`, ctx);
      return { preset: preset.id, categories: categories.length, courses: (preset.courses || []).length };
    });
  }

  /** system.backup -> { backup: { at, url, name }, status } */
  function backup(payload, ctx) {
    const entry = Backup.run('manual');
    Db.withLock(() => Audit.log('system.backup', '_meta', entry.id, `Manual backup ${entry.name}`, ctx));
    return { backup: entry, status: Backup.status() };
  }

  function backupStatus() {
    return Backup.status();
  }

  return { ping, bootstrap, sync, migrate, updateSettings, seed, backup, backupStatus };
})();
