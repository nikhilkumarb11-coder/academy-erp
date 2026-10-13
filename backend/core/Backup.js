/**
 * Spreadsheet backups (PRD §6.10, §8): a full copy of the data spreadsheet in a Drive folder.
 * The folder is created on first use and remembered in the BACKUP_FOLDER_ID Script Property.
 * The newest KEEP copies are kept; older ones are moved to Drive's trash (recoverable for 30 days).
 * The list of copies lives in _meta.backups so retention never has to scan Drive.
 */
const Backup = (() => {
  const KEEP = 30;
  /** dailyBackup skips when a backup (manual or automatic) is younger than this. */
  const MIN_HOURS_BETWEEN_AUTO = 20;

  function folder() {
    const id = Util.prop('BACKUP_FOLDER_ID');
    if (id) {
      try {
        return DriveApp.getFolderById(id);
      } catch (e) {
        // folder deleted or no access: create a new one below
      }
    }
    const created = DriveApp.createFolder(`${Db.getMap('Settings').academy_name || 'Academy'} - Backups`);
    Util.setProp('BACKUP_FOLDER_ID', created.getId());
    return created;
  }

  function list() {
    try {
      const parsed = JSON.parse(Db.getMap('_meta').backups || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /** { last: { at, url, name, kind } | null, count } */
  function status() {
    const all = list();
    return { last: all[0] || null, count: all.length, keep: KEEP };
  }

  /** Copies the spreadsheet now. kind: 'manual' | 'daily'. */
  function run(kind) {
    const at = Util.nowIso();
    const name = `${Db.getMap('Settings').academy_name || 'Academy'} backup ${at.slice(0, 16).replace('T', ' ')}`;
    const copy = DriveApp.getFileById(Util.prop('SPREADSHEET_ID', true)).makeCopy(name, folder());
    const entry = { id: copy.getId(), url: copy.getUrl(), name, at, kind };

    return Db.withLock(() => {
      const all = [entry].concat(list());
      all.slice(KEEP).forEach((old) => {
        try {
          DriveApp.getFileById(old.id).setTrashed(true);
        } catch (e) {
          // already deleted by hand
        }
      });
      Db.setMapValues('_meta', { backups: JSON.stringify(all.slice(0, KEEP)) });
      return entry;
    });
  }

  function isDue() {
    const last = list()[0];
    return !last || Date.now() - new Date(last.at).getTime() >= MIN_HOURS_BETWEEN_AUTO * 3600 * 1000;
  }

  return { run, status, isDue, KEEP };
})();

/** Time-driven trigger (daily, 02:00). */
function dailyBackup() {
  if (!Backup.isDue()) return;
  const entry = Backup.run('daily');
  Db.withLock(() => Audit.log('system.backup', '_meta', entry.id, `Daily backup ${entry.name}`, { device: 'system' }));
}
