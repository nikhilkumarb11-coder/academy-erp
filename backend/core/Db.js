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

  function load(tab) {
    if (cache[tab]) return cache[tab];
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    const values = lastRow > 0 && lastCol > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
    const headers = values[0].map(String);
    const rows = values.slice(1).map((r) => toObject(headers, r));
    cache[tab] = { sheet: sh, headers, rows };
    return cache[tab];
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
    if (!objs.length) return [];
    const t = load(tab);
    const now = Util.nowIso();
    const prepared = objs.map((o) => {
      const row = Object.assign({}, o);
      if (t.headers.includes('id') && !row.id) row.id = Util.newId(idPrefix || tab.slice(0, 3).toUpperCase());
      if (t.headers.includes('created_at') && !row.created_at) row.created_at = now;
      if (t.headers.includes('updated_at')) row.updated_at = now;
      if (t.headers.includes('deleted') && row.deleted === undefined) row.deleted = false;
      return row;
    });
    const startRow = t.sheet.getLastRow() + 1;
    const needed = startRow + prepared.length - 1 - t.sheet.getMaxRows();
    if (needed > 0) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), Math.max(needed, 500));
    const range = t.sheet.getRange(startRow, 1, prepared.length, t.headers.length);
    const formats = t.headers.map((h) => (TEXT_COLUMN_PATTERN.test(h) ? '@' : 'General'));
    range.setNumberFormats(prepared.map(() => formats));
    range.setValues(prepared.map((r) => toRow(t.headers, r)));
    t.rows.push(...prepared.map((r) => toObject(t.headers, toRow(t.headers, r))));
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
    const touched = [];

    patches.forEach((p) => {
      const i = indexById.get(p.id);
      if (i === undefined) throw new AppError('NOT_FOUND', `${tab} ${p.id} not found`);
      const merged = Object.assign({}, t.rows[i], p);
      if (t.headers.includes('updated_at')) merged.updated_at = now;
      t.rows[i] = merged;
      touched.push(i);
    });

    if (touched.length > 20) {
      t.sheet.getRange(2, 1, t.rows.length, t.headers.length).setValues(t.rows.map((r) => toRow(t.headers, r)));
    } else {
      touched.forEach((i) => t.sheet.getRange(i + 2, 1, 1, t.headers.length).setValues([toRow(t.headers, t.rows[i])]));
    }
    return touched.map((i) => t.rows[i]);
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
    const t = load(tab);
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
      t.sheet.getRange(t.sheet.getLastRow() + 1, 1, toAppend.length, t.headers.length)
        .setValues(toAppend.map((r) => toRow(t.headers, r)));
      t.rows.push(...toAppend);
    }
  }

  /** Atomic counter, e.g. receipt numbers. Must be called inside withLock. */
  function nextCounter(key) {
    const current = Number(getMap('Counters')[key] || 0);
    const next = current + 1;
    setMapValues('Counters', { [key]: next });
    return next;
  }

  function withLock(fn) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new AppError('BUSY', 'Another device is saving. Please retry.');
    try {
      const result = fn();
      SpreadsheetApp.flush();
      return result;
    } finally {
      lock.releaseLock();
    }
  }

  return { ss, sheet, all, find, where, changedSince, insert, update, softDelete, getMap, setMapValues, nextCounter, withLock, invalidate, isDeleted };
})();
