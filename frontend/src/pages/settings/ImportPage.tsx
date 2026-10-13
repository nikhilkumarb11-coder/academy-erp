import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Download, FileUp } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, Card, Field, PageHeader, Toggle } from '../../components/ui';
import type { Changes } from '../../data/merge';
import { useWrite } from '../../data/useWrite';
import { mapImport, IMPORT_TEMPLATE, parseCsv, type ImportRow, type MappedImport } from '../../lib/csv';
import { todayIso } from '../../lib/dates';
import { downloadCsv } from '../../lib/finance';
import { useMoney } from '../fees/feeShared';

type RowStatus = 'new_family' | 'existing_family' | 'duplicate' | 'error';

type ImportResult = {
  results: { row: number; status: RowStatus; message: string; family?: string }[];
  summary: { families: number; existingFamilies: number; students: number; enrollments: number; openingDues: number; duplicates: number; errors: number };
  changes?: Changes;
};

interface ImportPayload {
  rows: ImportRow[];
  commit: boolean;
  bill_current_month: boolean;
  opening_due_date: string;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  new_family: 'New family',
  existing_family: 'Adds to family',
  duplicate: 'Already exists',
  error: 'Error',
};

const STATUS_TONE: Record<RowStatus, string> = {
  new_family: 'bg-success/10 text-success',
  existing_family: 'bg-primary-soft text-primary',
  duplicate: 'bg-warning/10 text-warning',
  error: 'bg-danger/10 text-danger',
};

export function ImportPage() {
  const { api } = useAuth();
  const money = useMoney();
  const [file, setFile] = useState<{ name: string; mapped: MappedImport } | null>(null);
  const [readError, setReadError] = useState('');
  const [billCurrent, setBillCurrent] = useState(false);
  const [dueDate, setDueDate] = useState(todayIso());
  const [done, setDone] = useState<ImportResult | null>(null);

  const payload = (commit: boolean): ImportPayload => ({ rows: file?.mapped.rows ?? [], commit, bill_current_month: billCurrent, opening_due_date: dueDate });
  const preview = useMutation({ mutationFn: (p: ImportPayload) => api<ImportResult>('import.students', p) });
  const commit = useWrite<ImportPayload, ImportResult & { changes: Changes }>('import.students');

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setReadError('');
    setDone(null);
    preview.reset();
    commit.reset();
    if (!/\.(csv|txt)$/i.test(picked.name)) {
      setFile(null);
      setReadError('Choose a .csv file. In Excel use File > Save As > CSV (comma delimited).');
      return;
    }
    const mapped = mapImport(parseCsv(await picked.text()));
    setFile({ name: picked.name, mapped });
    if (mapped.missing.length) {
      setReadError(`Missing column(s): ${mapped.missing.join(', ')}. Download the template to see the expected headings.`);
      return;
    }
    if (!mapped.rows.length) {
      setReadError('The file has a heading row but no students.');
      return;
    }
    preview.mutate({ rows: mapped.rows, commit: false, bill_current_month: billCurrent, opening_due_date: dueDate });
  }

  const result = preview.data;
  const importable = result ? result.summary.students : 0;

  return (
    <>
      <Link to="/settings#data-export" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
        <ArrowLeft className="size-4" aria-hidden /> Settings
      </Link>
      <PageHeader title="Import students" subtitle="Families, students, their courses and pending fees from a CSV file" />

      {done ? (
        <Card className="space-y-3">
          <Alert tone="success">
            Imported {done.summary.students} student(s) in {done.summary.families} new and {done.summary.existingFamilies} existing family(ies),
            with {done.summary.enrollments} course enrolment(s){done.summary.openingDues > 0 && ` and ${money(done.summary.openingDues)} of opening dues`}.
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Link to="/students" className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-white">View students</Link>
            <Button variant="secondary" onClick={() => { setDone(null); setFile(null); preview.reset(); }}>Import another file</Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Download the template and fill one row per student. Brothers and sisters share the guardian's phone number.</li>
              <li>List courses by their names in this app, separated by semicolons, e.g. <em>Karate; Abacus</em>.</li>
              <li>Put each student's unpaid fees as of today in <em>opening_due</em>. They are added as an "Opening balance" charge.</li>
              <li>Dates can be 2015-03-12 or 12/03/2015. Save as CSV and choose the file below. Nothing is saved until you confirm.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => downloadCsv('students-import-template.csv', IMPORT_TEMPLATE)}>
                <Download className="size-4" aria-hidden /> Template
              </Button>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white">
                <FileUp className="size-4" aria-hidden /> Choose CSV file
                <input type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => void onFile(e)} />
              </label>
            </div>
            {file && (
              <p className="mt-3 text-sm text-muted">
                {file.name}: {file.mapped.rows.length} row(s)
                {file.mapped.ignored.length > 0 && ` · ignored columns: ${file.mapped.ignored.join(', ')}`}
              </p>
            )}
            {readError && <div className="mt-3"><Alert>{readError}</Alert></div>}
            {preview.error && <div className="mt-3"><Alert>{errorMessage(preview.error)}</Alert></div>}
          </Card>

          {preview.isPending && <p className="text-sm text-muted">Checking the file…</p>}

          {result && (
            <>
              <Card>
                <h2 className="mb-3 text-lg font-semibold">Preview</h2>
                <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  {[
                    ['Students to add', result.summary.students],
                    ['New families', result.summary.families],
                    ['Course enrolments', result.summary.enrollments],
                    ['Opening dues', money(result.summary.openingDues)],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="rounded-xl bg-canvas px-3 py-2">
                      <dt className="text-xs text-muted">{k}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
                {(result.summary.duplicates > 0 || result.summary.errors > 0) && (
                  <div className="mb-4">
                    <Alert tone="warning">
                      {result.summary.errors > 0 && `${result.summary.errors} row(s) have errors and will be skipped. `}
                      {result.summary.duplicates > 0 && `${result.summary.duplicates} student(s) already exist and will be skipped. `}
                      Fix the file and choose it again, or import the rest now.
                    </Alert>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Opening dues are due on" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                    hint="Usually your go-live date" />
                  <div>
                    <Toggle checked={billCurrent} onChange={setBillCurrent} label="Also bill this month's course fees" />
                    <p className="text-xs text-muted">Leave off if opening dues already include this month. Next month is billed automatically.</p>
                  </div>
                </div>
              </Card>

              <Card className="!p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-muted">
                      <tr className="border-b border-line">
                        <th className="px-4 py-2 font-medium">Row</th>
                        <th className="px-2 py-2 font-medium">Student</th>
                        <th className="px-2 py-2 font-medium">Guardian</th>
                        <th className="px-2 py-2 font-medium">Courses</th>
                        <th className="px-2 py-2 text-right font-medium">Opening due</th>
                        <th className="px-4 py-2 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {result.results.map((r) => {
                        const row = file?.mapped.rows[r.row - 1] ?? {};
                        return (
                          <tr key={r.row} className={clsx(r.status === 'error' && 'bg-danger/5')}>
                            <td className="px-4 py-2 tabular-nums text-muted">{r.row + 1}</td>
                            <td className="px-2 py-2 font-medium">{row.student_name}</td>
                            <td className="px-2 py-2">{row.guardian_name}<span className="block text-xs text-muted">{row.phone}</span></td>
                            <td className="px-2 py-2">{row.courses}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{row.opening_due ? money(Number(row.opening_due) || 0) : ''}</td>
                            <td className="px-4 py-2">
                              <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_TONE[r.status])}>{STATUS_LABEL[r.status]}</span>
                              {r.message && <span className="block text-xs text-muted">{r.message}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {commit.error && <Alert>{errorMessage(commit.error)}</Alert>}
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={!importable} loading={commit.isPending}
                  onClick={() => commit.mutate(payload(true), { onSuccess: (res) => setDone(res) })}>
                  Import {importable} student(s)
                </Button>
                <span className="text-sm text-muted">A backup before a big import is a good idea (Settings &gt; Backups).</span>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
