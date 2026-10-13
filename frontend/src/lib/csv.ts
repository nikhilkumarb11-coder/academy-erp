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

/** dd/mm/yyyy, dd-mm-yyyy and dd.mm.yyyy become yyyy-mm-dd; other text is returned trimmed for the server to reject. */
export function normalizeDate(value: string): string {
  const v = value.trim();
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(v);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
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
  ['Ravi Kumar', '9876543210', '', 'ravi@example.com', 'MG Road', 'Aarav', '5', '2015-03-12', 'Male', '2025-06-10', 'Karate; Abacus', 'Monthly', '1500', 'Pending till Sep', ''],
  ['Ravi Kumar', '9876543210', '', '', '', 'Diya', '2', '2018-11-02', 'Female', '2025-06-10', 'Drawing', '', '', '', ''],
];
