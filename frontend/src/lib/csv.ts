/** CSV reading for imports (RFC 4180: quoted cells, doubled quotes, CRLF, BOM; comma, semicolon or tab separated). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const IMPORT_COLUMNS = [
  'guardian_name', 'phone', 'alt_phone', 'email', 'address',
  'student_name', 'class', 'dob', 'gender', 'join_date',
  'courses', 'fee_plan', 'opening_due', 'opening_due_note', 'notes',
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export type ImportRow = Partial<Record<ImportColumn, string>>;

const ALIASES: Record<string, ImportColumn> = {
  guardian: 'guardian_name', parent: 'guardian_name', parent_name: 'guardian_name', father_name: 'guardian_name', mother_name: 'guardian_name', guardian_name: 'guardian_name',
  phone: 'phone', mobile: 'phone', phone_number: 'phone', mobile_number: 'phone', parent_phone: 'phone', contact: 'phone', whatsapp: 'phone',
  alt_phone: 'alt_phone', alternate_phone: 'alt_phone', phone_2: 'alt_phone', other_phone: 'alt_phone',
  email: 'email', email_id: 'email',
  address: 'address',
  student: 'student_name', student_name: 'student_name', name: 'student_name', child: 'student_name', child_name: 'student_name',
  class: 'class', grade: 'class', standard: 'class',
  dob: 'dob', date_of_birth: 'dob', birth_date: 'dob',
  gender: 'gender',
  join_date: 'join_date', joined: 'join_date', joining_date: 'join_date', admission_date: 'join_date', date_of_joining: 'join_date',
  courses: 'courses', course: 'courses', activities: 'courses', activity: 'courses',
  fee_plan: 'fee_plan', plan: 'fee_plan',
  opening_due: 'opening_due', pending: 'opening_due', pending_fee: 'opening_due', pending_fees: 'opening_due', due: 'opening_due', dues: 'opening_due', balance: 'opening_due',
  opening_due_note: 'opening_due_note', due_note: 'opening_due_note',
  notes: 'notes', remarks: 'notes', note: 'notes',
};

const headerKey = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Two-digit years up to this year are 20xx, later ones 19xx (birth dates). */
function fullYear(y: string): number {
  if (y.length === 4) return Number(y);
  const n = Number(y);
  return n <= new Date().getFullYear() % 100 ? 2000 + n : 1900 + n;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Dates as Excel tends to save them become yyyy-mm-dd: 2015-03-12, 12-03-2015, 12/03/15, 12.3.2015,
 * 12-Mar-15, 12 March 2015, Mar 12, 2015. Day comes first unless the second number cannot be a month.
 * Anything else is returned trimmed for the server to reject.
 */
export function normalizeDate(value: string): string {
  const v = value.trim();
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(v);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3])) ?? v;

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), fullYear(m[3])];
    return (b > 12 ? iso(y, a, b) : iso(y, b, a)) ?? v;
  }

  const month = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
  m = /^(\d{1,2})[\s/.-]+([a-z]{3,9})\.?[\s/.,-]+(\d{2}|\d{4})$/i.exec(v);
  if (m && month(m[2])) return iso(fullYear(m[3]), month(m[2]), Number(m[1])) ?? v;
  m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(v);
  if (m && month(m[1])) return iso(Number(m[3]), month(m[1]), Number(m[2])) ?? v;
  return v;
}

export interface MappedImport {
  rows: ImportRow[];
  /** Header -> column it was read into. */
  mapped: [string, ImportColumn][];
  ignored: string[];
  missing: ImportColumn[];
}

export function mapImport(table: string[][]): MappedImport {
  const [header = [], ...body] = table;
  const columns = header.map((h) => ALIASES[headerKey(h)] ?? null);
  const used = new Set<ImportColumn>();
  const at = columns.map((c) => {
    if (!c || used.has(c)) return null;
    used.add(c);
    return c;
  });
  const rows = body.map((cells) => {
    const row: ImportRow = {};
    at.forEach((col, i) => {
      if (!col) return;
      const v = (cells[i] ?? '').trim();
      if (v) row[col] = col === 'dob' || col === 'join_date' ? normalizeDate(v) : col === 'opening_due' ? v.replace(/[₹,\s]/g, '') : v;
    });
    return row;
  });
  return {
    rows,
    mapped: header.flatMap((h, i) => (at[i] ? [[h, at[i]] as [string, ImportColumn]] : [])),
    ignored: header.filter((h, i) => !at[i] && h.trim()),
    missing: (['guardian_name', 'phone', 'student_name'] as ImportColumn[]).filter((c) => !used.has(c)),
  };
}

export const IMPORT_TEMPLATE: string[][] = [
  [...IMPORT_COLUMNS],
  ['Ravi Kumar', '9876543210', '', 'ravi@example.com', 'MG Road', 'Aarav', '5', '12-Mar-2015', 'Male', '10-Jun-2025', 'Karate; Abacus', 'Monthly', '1500', 'Pending till Sep', 'Delete these example rows'],
  ['Ravi Kumar', '9876543210', '', '', '', 'Diya', '2', '02-Nov-2018', 'Female', '10-Jun-2025', 'Drawing', '', '', '', ''],
];
