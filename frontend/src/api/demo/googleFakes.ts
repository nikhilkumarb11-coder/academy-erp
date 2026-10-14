/**
 * In-browser stand-ins for the Google services the backend uses (SpreadsheetApp, PropertiesService,
 * Utilities, DriveApp, ...). Mirrors tests/backend/harness.mjs. Like Google Sheets, non-text cells turn
 * "TRUE"/"FALSE" into booleans, numeric strings into numbers and yyyy-mm-dd into Dates.
 */
import { hmacSha256, sha256 } from './sha256';

type Cell = string | number | boolean | Date;

export interface SheetState {
  name: string;
  rows: Cell[][];
  formats: Record<number, string>;
  maxRows: number;
}

export interface DemoState {
  spreadsheetId: string;
  sheets: SheetState[];
  props: Record<string, string>;
  cache: Record<string, string>;
  files: Record<string, { name: string; html: string }>;
}

export function emptyState(spreadsheetId: string): DemoState {
  return { spreadsheetId, sheets: [{ name: 'Sheet1', rows: [], formats: {}, maxRows: 1000 }], props: {}, cache: {}, files: {} };
}

/** JSON with Dates preserved. */
export const serialize = (state: DemoState) =>
  JSON.stringify(state, function (this: Record<string, unknown>, key, value) {
    const raw = this[key];
    return raw instanceof Date ? { $d: raw.getTime() } : value;
  });

export const deserialize = (text: string): DemoState =>
  JSON.parse(text, (_k, v) => (v && typeof v === 'object' && '$d' in v ? new Date(v.$d) : v));

// ---------- Sheets ----------

const NUMERIC = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class FakeSheet {
  constructor(public s: SheetState) {}
  getName() { return this.s.name; }
  getMaxRows() { return this.s.maxRows; }
  insertRowsAfter(_after: number, n: number) { this.s.maxRows += n; }
  setFrozenRows() {}
  getProtections() { return []; }
  getLastRow() {
    for (let r = this.s.rows.length - 1; r >= 0; r--) if (this.s.rows[r]?.some((v) => v !== '' && v !== null && v !== undefined)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let last = 0;
    this.s.rows.forEach((row) => row?.forEach((v, c) => { if (v !== '' && v !== null && v !== undefined) last = Math.max(last, c + 1); }));
    return last;
  }
  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    if (row + numRows - 1 > this.s.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new FakeRange(this, row, col, numRows, numCols);
  }
  coerce(col: number, value: unknown): Cell {
    if (value instanceof Date || typeof value !== 'string') return value as Cell;
    if (this.s.formats[col] === '@') return value;
    if (value === 'TRUE') return true;
    if (value === 'FALSE') return false;
    if (NUMERIC.test(value)) return Number(value);
    if (ISO_DATE.test(value)) return new Date(`${value}T00:00:00+05:30`);
    return value;
  }
}

class FakeRange {
  constructor(private sheet: FakeSheet, private row: number, private col: number, private numRows: number, private numCols: number) {}
  getValues(): Cell[][] {
    const out: Cell[][] = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.s.rows[this.row - 1 + r] ?? [];
      const line: Cell[] = [];
      for (let c = 0; c < this.numCols; c++) line.push(src[this.col - 1 + c] ?? '');
      out.push(line);
    }
    return out;
  }
  setValues(values: unknown[][]) {
    values.forEach((line, r) => {
      const rowIndex = this.row - 1 + r;
      const target = (this.sheet.s.rows[rowIndex] ??= []);
      line.forEach((v, c) => { target[this.col - 1 + c] = this.sheet.coerce(this.col + c, v); });
    });
    for (let i = 0; i < this.sheet.s.rows.length; i++) this.sheet.s.rows[i] ??= [];
    return this;
  }
  setNumberFormat(fmt: string) {
    for (let c = 0; c < this.numCols; c++) this.sheet.s.formats[this.col + c] = fmt;
    return this;
  }
  setNumberFormats(formats: string[][]) {
    formats[0].forEach((fmt, c) => { this.sheet.s.formats[this.col + c] = fmt; });
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  protect() {
    const p = { setDescription: () => p, getDescription: () => '', setWarningOnly: () => p, remove: () => {} };
    return p;
  }
}

// ---------- helpers ----------

const utf8 = (s: string) => new TextEncoder().encode(s);
const toBytes = (v: string | number[]) => (typeof v === 'string' ? utf8(v) : Uint8Array.from(v, (b) => b & 255));
const signed = (bytes: Uint8Array) => Array.from(bytes, (b) => (b > 127 ? b - 256 : b));

function toBase64(bytes: Uint8Array) {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

function fromBase64(text: string) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function formatDate(date: Date, tz: string, pattern: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  if (pattern === 'yyyy-MM-dd') return ymd;
  if (pattern === "yyyy-MM-dd'T'HH:mm:ssXXX") {
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const offset = Math.round((local - Math.floor(date.getTime() / 1000) * 1000) / 60000);
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    return `${ymd}T${parts.hour}:${parts.minute}:${parts.second}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  }
  throw new Error(`Unsupported date pattern: ${pattern}`);
}

interface FakeBlob {
  setName(n: string): FakeBlob;
  getName(): string;
  getBytes(): number[];
  getDataAsString(): string;
}

function blobOf(text: string): FakeBlob {
  let name = '';
  const blob: FakeBlob = {
    setName: (n) => { name = n; return blob; },
    getName: () => name,
    getBytes: () => signed(utf8(text)),
    getDataAsString: () => text,
  };
  return blob;
}

/** Global objects handed to the backend code for one execution. */
export function googleServices(state: DemoState) {
  const spreadsheet = {
    getSheetByName: (name: string) => {
      const s = state.sheets.find((x) => x.name === name);
      return s ? new FakeSheet(s) : null;
    },
    getSheets: () => state.sheets.map((s) => new FakeSheet(s)),
    insertSheet: (name: string) => {
      const s: SheetState = { name, rows: [], formats: {}, maxRows: 1000 };
      state.sheets.push(s);
      return new FakeSheet(s);
    },
    deleteSheet: (sheet: FakeSheet) => { state.sheets = state.sheets.filter((s) => s !== sheet.s); },
  };

  const folder = (id: string) => ({
    getId: () => id,
    createFile: (blob: FakeBlob) => {
      const fileId = `demo-file-${Object.keys(state.files).length + 1}`;
      const html = blob.getDataAsString();
      state.files[fileId] = { name: blob.getName(), html };
      return { getId: () => fileId, getUrl: () => `demo-receipt:${fileId}`, setSharing: () => {} };
    },
  });

  return {
    SpreadsheetApp: {
      openById: (id: string) => {
        if (id !== state.spreadsheetId) throw new Error(`No spreadsheet ${id}`);
        return spreadsheet;
      },
      flush: () => {},
      ProtectionType: { RANGE: 'RANGE' },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (k in state.props ? state.props[k] : null),
        getProperties: () => ({ ...state.props }),
        setProperty: (k: string, v: unknown) => { state.props[k] = String(v); },
        setProperties: (values: Record<string, string>) => { Object.assign(state.props, values); },
        deleteProperty: (k: string) => { delete state.props[k]; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => (k in state.cache ? state.cache[k] : null),
        put: (k: string, v: unknown) => { state.cache[k] = String(v); },
        getAll: (keys: string[]) => Object.fromEntries(keys.filter((k) => k in state.cache).map((k) => [k, state.cache[k]])),
        putAll: (values: Record<string, unknown>) => { Object.keys(values).forEach((k) => { state.cache[k] = String(values[k]); }); },
        remove: (k: string) => { delete state.cache[k]; },
        removeAll: (keys: string[]) => { keys.forEach((k) => { delete state.cache[k]; }); },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      formatDate,
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_alg: string, text: string) => signed(sha256(utf8(text))),
      computeHmacSha256Signature: (value: string, key: string) => signed(hmacSha256(utf8(value), utf8(key))),
      base64EncodeWebSafe: (v: string | number[]) => toBase64(toBytes(v)).replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s: string) => signed(fromBase64(s.replace(/-/g, '+').replace(/_/g, '/'))),
      base64Encode: (v: string | number[]) => toBase64(toBytes(v)),
      base64Decode: (s: string) => signed(fromBase64(s)),
      newBlob: (bytes: number[], _type?: string, name?: string) => blobOf(new TextDecoder().decode(toBytes(bytes))).setName(name ?? ''),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({ setMimeType() { return this; }, getContent: () => text }),
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: () => {
        const builder: Record<string, unknown> = new Proxy({}, { get: (_t, key) => (key === 'create' ? () => {} : () => builder) });
        return builder;
      },
    },
    HtmlService: {
      createHtmlOutput: (html: string) => ({ getBlob: () => ({ getAs: () => blobOf(html) }) }),
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      createFolder: () => folder('demo-folder'),
      getFolderById: (id: string) => folder(id),
      getFileById: (id: string) => ({
        getBlob: () => blobOf(state.files[id]?.html ?? ''),
        // A demo "backup" records only its name; copying the whole demo spreadsheet would fill localStorage.
        makeCopy: (name: string) => {
          const fileId = `demo-backup-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          state.files[fileId] = { name, html: '' };
          return { getId: () => fileId, getUrl: () => '', getName: () => name };
        },
        setTrashed: () => { delete state.files[id]; },
      }),
    },
  };
}
