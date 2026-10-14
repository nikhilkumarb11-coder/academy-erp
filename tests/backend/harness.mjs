/**
 * Runs the real backend/*.js Apps Script code in Node against in-memory fakes of Google services.
 * Each API call executes in a fresh VM context (like a real Apps Script execution) while the
 * spreadsheet, script properties and cache persist between calls.
 *
 * Fidelity notes: like Google Sheets, cells in non-text columns turn "TRUE"/"FALSE" into booleans,
 * numeric strings into numbers and yyyy-mm-dd strings into Date objects.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const jsIn = (dir) => readdirSync(join(repo, 'backend', dir)).filter((f) => f.endsWith('.js')).sort().map((f) => `${dir}/${f}`);
/** Same order as the in-browser demo runtime: schema, core (Util first), api, entry points. */
const BACKEND_FILES = [
  'Schema.js',
  'core/Util.js', ...jsIn('core').filter((f) => f !== 'core/Util.js'),
  ...jsIn('api'),
  'Main.js', 'Setup.js',
];
const SOURCE = BACKEND_FILES.map((f) => `// ---- ${f}\n${readFileSync(join(repo, 'backend', f), 'utf8')}`).join('\n');
const EXPORTS = '\n;({ doPost, doGet, setupTenant, Migrate, Db, dailyBackup, onSheetEdit })';

export function loadPreset(id) {
  return JSON.parse(readFileSync(join(repo, 'presets', `${id}.json`), 'utf8'));
}

// ---------- Google Sheets fake ----------

const NUMERIC = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map(); // "r,c" -> value (1-based)
    this.formats = new Map(); // column -> number format
    this.maxRows = 1000;
    this.protections = [];
    this.reads = 0; // getValues calls, to check which tabs a request reads
  }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  setFrozenRows() {}
  getProtections() { return this.protections.slice(); }
  getLastRow() {
    let last = 0;
    for (const [k, v] of this.cells) if (v !== '' && v !== null && v !== undefined) last = Math.max(last, Number(k.split(',')[0]));
    return last;
  }
  getLastColumn() {
    let last = 0;
    for (const [k, v] of this.cells) if (v !== '' && v !== null && v !== undefined) last = Math.max(last, Number(k.split(',')[1]));
    return last;
  }
  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error(`Invalid range ${row},${col},${numRows},${numCols}`);
    if (row + numRows - 1 > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new FakeRange(this, row, col, numRows, numCols);
  }
  coerce(col, value) {
    if (value instanceof Date || typeof value !== 'string') return value;
    if (this.formats.get(col) === '@') return value;
    if (value === 'TRUE') return true;
    if (value === 'FALSE') return false;
    if (NUMERIC.test(value)) return Number(value);
    if (ISO_DATE.test(value)) return new Date(`${value}T00:00:00+05:30`);
    return value;
  }
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getLastRow() { return this.row + this.numRows - 1; }
  getColumn() { return this.col; }
  getNumColumns() { return this.numCols; }
  getValues() {
    this.sheet.reads += 1;
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = this.sheet.cells.get(`${this.row + r},${this.col + c}`);
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((l) => l.length !== this.numCols)) {
      throw new Error(`setValues dimension mismatch: expected ${this.numRows}x${this.numCols}`);
    }
    values.forEach((line, r) => line.forEach((v, c) => {
      const col = this.col + c;
      this.sheet.cells.set(`${this.row + r},${col}`, this.sheet.coerce(col, v));
    }));
    return this;
  }
  setNumberFormat(fmt) {
    for (let c = 0; c < this.numCols; c++) this.sheet.formats.set(this.col + c, fmt);
    return this;
  }
  setNumberFormats(formats) {
    formats[0].forEach((fmt, c) => this.sheet.formats.set(this.col + c, fmt));
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  protect() {
    const sheet = this.sheet;
    const p = {
      description: '',
      setDescription(d) { this.description = d; return this; },
      getDescription() { return this.description; },
      setWarningOnly() { return this; },
      remove() { sheet.protections = sheet.protections.filter((x) => x !== p); },
    };
    sheet.protections.push(p);
    return p;
  }
}

class FakeSpreadsheet {
  constructor(id) {
    this.id = id;
    this.sheets = [new FakeSheet('Sheet1')];
  }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error(`Sheet ${name} exists`);
    const s = new FakeSheet(name);
    this.sheets.push(s);
    return s;
  }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
}

// ---------- Other services ----------

const signed = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
const unsigned = (bytes) => Buffer.from(bytes.map((b) => b & 255));
const toBuffer = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : unsigned(v));

function formatDate(date, _tz, pattern) {
  const ist = new Date(date.getTime() + 330 * 60_000); // Asia/Kolkata, no DST
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const ymd = `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}`;
  if (pattern === 'yyyy-MM-dd') return ymd;
  if (pattern === "yyyy-MM-dd'T'HH:mm:ssXXX") return `${ymd}T${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}+05:30`;
  throw new Error(`Unsupported date pattern in fake: ${pattern}`);
}

function fakeBlob(buffer) {
  const blob = {
    name: '',
    setName(n) { blob.name = n; return blob; },
    getName: () => blob.name,
    getBytes: () => signed(buffer),
    getDataAsString: () => buffer.toString('utf8'),
  };
  return blob;
}

function services(state) {
  const driveFolder = (folderId) => ({
    getId: () => folderId,
    createFile: (blob) => {
      const id = `file-${Object.keys(state.drive.files).length + 1}`;
      state.drive.files[id] = { folderId, name: blob.getName(), bytes: unsigned(blob.getBytes()), sharing: null };
      return {
        getId: () => id,
        getUrl: () => `https://drive.example/${id}`,
        setSharing: (access, permission) => { state.drive.files[id].sharing = `${access}:${permission}`; },
      };
    },
  });
  return {
    SpreadsheetApp: {
      openById(id) {
        if (id !== state.spreadsheet.id) throw new Error(`No spreadsheet ${id}`);
        return state.spreadsheet;
      },
      flush() {},
      ProtectionType: { RANGE: 'RANGE' },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in state.props ? state.props[k] : null),
        getProperties: () => ({ ...state.props }),
        setProperty: (k, v) => { state.props[k] = String(v); },
        setProperties: (values) => { Object.assign(state.props, values); },
        deleteProperty: (k) => { delete state.props[k]; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in state.cache ? state.cache[k] : null),
        put: (k, v) => { state.cache[k] = String(v); },
        getAll: (keys) => Object.fromEntries(keys.filter((k) => k in state.cache).map((k) => [k, state.cache[k]])),
        putAll: (values) => { Object.keys(values).forEach((k) => { state.cache[k] = String(values[k]); }); },
        remove: (k) => { delete state.cache[k]; },
        removeAll: (keys) => { keys.forEach((k) => { delete state.cache[k]; }); },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      formatDate,
      getUuid: () => randomUUID(),
      computeDigest: (alg, text) => signed(createHash(alg).update(text, 'utf8').digest()),
      computeHmacSha256Signature: (value, key) => signed(createHmac('sha256', key).update(value, 'utf8').digest()),
      base64EncodeWebSafe: (v) => toBuffer(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) => signed(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (bytes, _type, name) => fakeBlob(unsigned(bytes)).setName(name || ''),
      base64Encode: (v) => toBuffer(v).toString('base64'),
      base64Decode: (s) => signed(Buffer.from(s, 'base64')),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ setMimeType() { return this; }, getContent: () => text }),
    },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
      newTrigger: (handler) => {
        const builder = new Proxy({}, {
          get: (_t, key) => (key === 'create' ? () => { state.triggers.push({ handler }); } : () => builder),
        });
        return builder;
      },
    },
    HtmlService: {
      createHtmlOutput: (html) => ({
        getBlob: () => ({
          getAs: () => fakeBlob(Buffer.from(`%PDF-fake\n${html}`, 'utf8')),
        }),
      }),
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      createFolder: (name) => {
        const id = `folder-${Object.keys(state.drive.folders).length + 1}`;
        state.drive.folders[id] = name;
        return driveFolder(id);
      },
      getFolderById: (id) => {
        if (!state.drive.folders[id]) throw new Error('No folder');
        return driveFolder(id);
      },
      getFileById: (id) => {
        if (id !== state.props.SPREADSHEET_ID && !state.drive.files[id]) throw new Error(`No file ${id}`);
        return {
          getBlob: () => fakeBlob(state.drive.files[id].bytes),
          makeCopy: (name, folder) => {
            const copyId = `file-${Object.keys(state.drive.files).length + 1}`;
            state.drive.files[copyId] = { folderId: folder.getId(), name, copyOf: id, trashed: false };
            return { getId: () => copyId, getUrl: () => `https://drive.example/${copyId}`, getName: () => name };
          },
          setTrashed: (v) => { state.drive.files[id].trashed = v; },
        };
      },
    },
    console: { log() {}, error: (...a) => state.errors.push(a.join(' ')), warn() {} },
  };
}

/** Date whose "now" is state.today at 10:00 IST when set; the clock still ticks so timestamps stay ordered. */
function clock(state) {
  if (!state.today) return Date;
  const offset = new Date(`${state.today}T10:00:00+05:30`).getTime() - Date.now();
  return class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [Date.now() + offset]));
    }
    static now() {
      return Date.now() + offset;
    }
    static [Symbol.hasInstance](value) {
      return value instanceof Date;
    }
  };
}

/** A tenant backend with its own spreadsheet. setupTenant() has already run. */
export function createBackend({ password = 'correct-horse-1' } = {}) {
  const state = {
    spreadsheet: new FakeSpreadsheet('sheet-under-test'),
    props: { SPREADSHEET_ID: 'sheet-under-test', INITIAL_PASSWORD: password },
    cache: {},
    errors: [],
    triggers: [],
    drive: { folders: {}, files: {} },
    /** Overrides "today" for the backend (yyyy-MM-dd), so tests can move through months. */
    today: null,
  };

  function execution() {
    const context = vm.createContext({ ...services(state), Date: clock(state), JSON, Math, Number, String, Object, Array, Error, Map, Set });
    return vm.runInContext(SOURCE + EXPORTS, context, { filename: 'backend.js' });
  }

  execution().setupTenant();

  async function call(action, payload = {}, token = null) {
    const out = execution().doPost({ postData: { contents: JSON.stringify({ action, payload, token, device: 'test' }) } });
    return JSON.parse(out.getContent());
  }

  /** Calls an action and returns data, throwing on { ok: false }. */
  async function ok(action, payload, token) {
    const res = await call(action, payload, token);
    if (!res.ok) throw new Error(`${action} failed: ${res.error.code} ${res.error.message}`);
    return res.data;
  }

  async function login(pw = password) {
    return (await ok('auth.login', { password: pw })).token;
  }

  function sheetRows(tab) {
    const sheet = state.spreadsheet.getSheetByName(tab);
    const values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), Math.max(sheet.getLastColumn(), 1)).getValues();
    const [headers, ...rows] = values;
    return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  }

  return { call, ok, login, state, execution, sheetRows };
}
