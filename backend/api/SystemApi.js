const SystemApi = (() => {
  function ping() {
    return {
      apiVersion: API_VERSION,
      schemaVersion: Migrate.currentVersion(),
      serverTime: Util.nowIso(),
    };
  }

  /**
   * Everything the client caches at login (PRD §8 performance). The snapshot is kept in CacheService,
   * keyed by the data revision, so repeat logins and full reloads skip reading 21 tabs. A cached
   * snapshot keeps the serverTime it was read at, so the client's next sync still covers later edits.
   */
  function bootstrap() {
    Migrate.ensureCurrent();
    ExpensesApi.runRecurringIfDue();
    const key = snapshotKey();
    const hit = cachedSnapshot(key);
    if (hit) return hit;
    const data = { settings: Db.getMap('Settings'), serverTime: Util.nowIso() };
    BOOTSTRAP_TABS.forEach((tab) => { data[tab] = Db.all(tab); });
    storeSnapshot(key, data);
    return data;
  }

  const SNAPSHOT_CHUNK = 30000; // characters; CacheService values are capped at 100 KB (UTF-8)
  const SNAPSHOT_MAX_CHUNKS = 200;
  const SNAPSHOT_TTL_S = 6 * 3600;

  /** Changes whenever any cached tab or Settings is written: Db.saveStamps and onSheetEdit replace data_rev. */
  function snapshotKey() {
    let rev = Util.prop('data_rev');
    if (!rev) {
      rev = Util.newId('REV');
      Util.setProp('data_rev', rev);
    }
    return `boot:${API_VERSION}:${rev}`;
  }

  function cachedSnapshot(key) {
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get(key) || 0);
    if (!count) return null;
    const keys = Array.from({ length: count }, (_, i) => `${key}:${i}`);
    const parts = cache.getAll(keys);
    if (keys.some((k) => typeof parts[k] !== 'string')) return null;
    try {
      return JSON.parse(keys.map((k) => parts[k]).join(''));
    } catch (e) {
      return null;
    }
  }

  function storeSnapshot(key, data) {
    const json = JSON.stringify(data);
    const count = Math.ceil(json.length / SNAPSHOT_CHUNK);
    if (count > SNAPSHOT_MAX_CHUNKS) return;
    const values = {};
    for (let i = 0; i < count; i++) values[`${key}:${i}`] = json.slice(i * SNAPSHOT_CHUNK, (i + 1) * SNAPSHOT_CHUNK);
    try {
      const cache = CacheService.getScriptCache();
      const previous = cache.get('boot:last');
      if (previous && previous !== key) {
        const [oldKey, oldCount] = previous.split('#');
        cache.removeAll([oldKey].concat(Array.from({ length: Number(oldCount) || 0 }, (_, i) => `${oldKey}:${i}`)));
      }
      cache.putAll(values, SNAPSHOT_TTL_S);
      cache.put(key, String(count), SNAPSHOT_TTL_S);
      cache.put('boot:last', `${key}#${count}`, SNAPSHOT_TTL_S);
    } catch (e) {
      console.warn('Could not cache the bootstrap snapshot', e && e.message);
    }
  }

  /** Overlap that covers writes still in flight when the previous sync read the sheet. */
  const SYNC_OVERLAP_MS = 60 * 1000;

  /**
   * Delta refresh: rows changed after `since`, including soft-deleted ones. Tabs whose change stamp
   * (set by every Db write) is older than `since` are not read at all; settings are omitted when unchanged.
   */
  function sync(payload) {
    Util.requireFields(payload, ['since']);
    Migrate.ensureCurrent();
    ExpensesApi.runRecurringIfDue();
    const serverTime = Util.nowIso();
    const sinceMs = new Date(payload.since).getTime();
    const since = isNaN(sinceMs) ? String(payload.since) : Utilities.formatDate(new Date(sinceMs - SYNC_OVERLAP_MS), Util.tz(), "yyyy-MM-dd'T'HH:mm:ssXXX");
    const missing = {};
    const unchanged = (tab) => {
      const stamp = Db.stamp(tab);
      if (!stamp) missing[`stamp:${tab}`] = since;
      return !!stamp && stamp < since;
    };

    const data = { serverTime };
    if (!unchanged('Settings')) data.settings = Db.getMap('Settings');
    BOOTSTRAP_TABS.forEach((tab) => { data[tab] = unchanged(tab) ? [] : Db.changedSince(tab, since); });
    if (Object.keys(missing).length) Util.setProps(missing);
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
