/**
 * The only module that touches SpreadsheetApp for tenant data.
 * Rows are plain objects keyed by header name; reads and writes are batched per call.
 * Callers that write must run inside Db.withLock so concurrent devices never interleave.
 */
const Db = (() => {
  let spreadsheet = null;
  const cache = {}; // per-execution: tab -> { sheet, headers, rows }

  function ss() {
    if (!spreadsheet) spreadsheet = SpreadsheetApp.openById(Util.prop('SPREADSHEET_ID', true));
    return spreadsheet;
  }

  function sheet(tab) {
    const sh = ss().getSheetByName(tab);
    if (!sh) throw new AppError('SCHEMA', `Missing tab ${tab}. Run migrate().`);
    return sh;
  }

  const touched = {}; // tabs written in this execution, for sync stamps
  let locked = false;

  function load(tab) {
    if (cache[tab] && !cache[tab].partial) return cache[tab];
    const sh = sheet(tab);
    const values = sh.getDataRange().getValues();
    const headers = values[0].map(String);
    const rows = values.slice(1).map((r) => toObject(headers, r));
    cache[tab] = { sheet: sh, headers, rows, lastRow: values.length, lastRowTrusted: locked, maxRows: null };
    return cache[tab];
  }

  /** Headers and row count only, for append-only tabs whose rows the request never reads. */
  function loadForAppend(tab) {
    if (cache[tab]) return cache[tab];
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    cache[tab] = { sheet: sh, headers, rows: [], lastRow, lastRowTrusted: locked, maxRows: null, partial: true };
    return cache[tab];
  }

  /**
   * A tab read before the lock may miss rows another device appended since; re-read it before
   * appending so row positions stay right.
   */
  function forAppend(tab, t) {
    if (t.lastRowTrusted) return t;
    const live = t.sheet.getLastRow();
    if (live !== t.lastRow && !t.partial) {
      delete cache[tab];
      return forAppend(tab, load(tab));
    }
    t.lastRow = live;
    t.lastRowTrusted = locked;
    return t;
  }

  function maxRows(t) {
    if (t.maxRows === null) t.maxRows = t.sheet.getMaxRows();
    return t.maxRows;
  }

  function touch(tab) {
    touched[tab] = true;
  }

  /**
   * Records when each written tab last changed (Script Properties "stamp:<Tab>"), so system.sync can
   * skip tabs nothing has touched. Call after the writes are flushed.
   */
  function saveStamps() {
    const tabs = Object.keys(touched);
    if (!tabs.length) return;
    const now = Util.nowIso();
    const values = {};
    tabs.forEach((tab) => { values[`stamp:${tab}`] = now; delete touched[tab]; });
    Util.setProps(values);
  }

  /** Last change time of a tab, or null when unknown. */
  function stamp(tab) {
    return Util.prop(`stamp:${tab}`);
  }

  function toObject(headers, row) {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i] instanceof Date ? Utilities.formatDate(row[i], Util.tz(), 'yyyy-MM-dd') : row[i];
    });
    return obj;
  }

  function toRow(headers, obj) {
    return headers.map((h) => {
      const v = obj[h];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return v;
    });
  }

  function invalidate(tab) {
    delete cache[tab];
  }

  /** All rows (soft-deleted included unless excluded). */
  function all(tab, { includeDeleted = false } = {}) {
    const rows = load(tab).rows;
    return includeDeleted ? rows.slice() : rows.filter((r) => !isDeleted(r));
  }

  function isDeleted(row) {
    return row.deleted === true || String(row.deleted).toUpperCase() === 'TRUE';
  }

  function find(tab, id) {
    return load(tab).rows.find((r) => r.id === id) || null;
  }

  function where(tab, predicate) {
    return all(tab).filter(predicate);
  }

  /**
   * Rows changed at or after an ISO timestamp, deleted rows included so clients can drop them.
   * Inclusive because timestamps have one-second precision; clients merge by id, so repeats are harmless.
   */
  function changedSince(tab, sinceIso) {
    return load(tab).rows.filter((r) => String(r.updated_at || r.created_at || '') >= sinceIso);
  }

  /** Appends rows in one setValues call. Fills id, created_at, updated_at when the tab has them. */
  function insert(tab, objs, idPrefix) {
    return write(load, tab, objs, idPrefix);
  }

  /** Like insert, without reading existing rows (audit and message logs grow without bound). */
  function append(tab, objs, idPrefix) {
    return write(loadForAppend, tab, objs, idPrefix);
  }

  function write(loader, tab, objs, idPrefix) {
    if (!objs.length) return [];
    const t = forAppend(tab, loader(tab));
    const now = Util.nowIso();
    const prepared = objs.map((o) => {
      const row = Object.assign({}, o);
      if (t.headers.includes('id') && !row.id) row.id = Util.newId(idPrefix || tab.slice(0, 3).toUpperCase());
      if (t.headers.includes('created_at') && !row.created_at) row.created_at = now;
      if (t.headers.includes('updated_at')) row.updated_at = now;
      if (t.headers.includes('deleted') && row.deleted === undefined) row.deleted = false;
      return row;
    });
    const startRow = t.lastRow + 1;
    const needed = startRow + prepared.length - 1 - maxRows(t);
    if (needed > 0) {
      const add = Math.max(needed, 500);
      t.sheet.insertRowsAfter(t.maxRows, add);
      t.maxRows += add;
    }
    const range = t.sheet.getRange(startRow, 1, prepared.length, t.headers.length);
    const formats = t.headers.map((h) => (TEXT_COLUMN_PATTERN.test(h) ? '@' : 'General'));
    range.setNumberFormats(prepared.map(() => formats));
    range.setValues(prepared.map((r) => toRow(t.headers, r)));
    t.lastRow += prepared.length;
    if (!t.partial) t.rows.push(...prepared.map((r) => toObject(t.headers, toRow(t.headers, r))));
    touch(tab);
    return prepared;
  }

  /**
   * Applies partial updates [{ id, ...fields }]. Small batches write row by row;
   * large batches rewrite the data block in a single call.
   */
  function update(tab, patches) {
    if (!patches.length) return [];
    const t = load(tab);
    const now = Util.nowIso();
    const indexById = new Map(t.rows.map((r, i) => [r.id, i]));
    const changed = [];

    patches.forEach((p) => {
      const i = indexById.get(p.id);
      if (i === undefined) throw new AppError('NOT_FOUND', `${tab} ${p.id} not found`);
      const merged = Object.assign({}, t.rows[i], p);
      if (t.headers.includes('updated_at')) merged.updated_at = now;
      t.rows[i] = merged;
      changed.push(i);
    });

    if (changed.length > 20) {
      t.sheet.getRange(2, 1, t.rows.length, t.headers.length).setValues(t.rows.map((r) => toRow(t.headers, r)));
    } else {
      changed.forEach((i) => t.sheet.getRange(i + 2, 1, 1, t.headers.length).setValues([toRow(t.headers, t.rows[i])]));
    }
    touch(tab);
    return changed.map((i) => t.rows[i]);
  }

  function softDelete(tab, ids) {
    return update(tab, ids.map((id) => ({ id, deleted: true })));
  }

  /** Key/value tabs (Settings, Counters, _meta). */
  function getMap(tab) {
    const map = {};
    load(tab).rows.forEach((r) => { if (r.key) map[r.key] = r.value; });
    return map;
  }

  function setMapValues(tab, values) {
    const t = forAppend(tab, load(tab));
    const now = Util.nowIso();
    const existing = new Map(t.rows.map((r, i) => [r.key, i]));
    const toAppend = [];
    Object.keys(values).forEach((key) => {
      const i = existing.get(key);
      const row = { key, value: String(values[key]), updated_at: now };
      if (i === undefined) toAppend.push(row);
      else t.sheet.getRange(i + 2, 1, 1, t.headers.length).setValues([toRow(t.headers, Object.assign(t.rows[i], row))]);
    });
    if (toAppend.length) {
      t.sheet.getRange(t.lastRow + 1, 1, toAppend.length, t.headers.length)
        .setValues(toAppend.map((r) => toRow(t.headers, r)));
      t.rows.push(...toAppend);
      t.lastRow += toAppend.length;
    }
    touch(tab);
  }

  /** Atomic counter, e.g. receipt numbers. Must be called inside withLock. */
  function nextCounter(key) {
    if (cache.Counters && !cache.Counters.lastRowTrusted) delete cache.Counters;
    const current = Number(getMap('Counters')[key] || 0);
    const next = current + 1;
    setMapValues('Counters', { [key]: next });
    return next;
  }

  function withLock(fn) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new AppError('BUSY', 'Another device is saving. Please retry.');
    const outer = !locked;
    locked = true;
    try {
      const result = fn();
      if (outer) {
        SpreadsheetApp.flush();
        saveStamps();
      }
      return result;
    } finally {
      if (outer) {
        locked = false;
        lock.releaseLock();
      }
    }
  }

  return {
    ss, sheet, all, find, where, changedSince, insert, append, update, softDelete, getMap, setMapValues,
    nextCounter, withLock, invalidate, isDeleted, saveStamps, stamp,
  };
})();
