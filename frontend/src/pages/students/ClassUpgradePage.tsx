import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../api/errors';
import { useToast } from '../../components/Toast';
import { Alert, Button, Card, EmptyState, Field, PageHeader, SelectField, Spinner } from '../../components/ui';
import { applyChanges } from '../../data/merge';
import type { CoreData, Student } from '../../data/types';
import { useCoreData, coreKey } from '../../data/useCoreData';
import { useQueryClient } from '@tanstack/react-query';
import { bool, isDeleted } from '../../lib/values';
import { useLabels, useTenant } from '../../tenant/TenantContext';

const LADDER = ['Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

/** Suggest the next class: numbered ladder, or bump the last number in the text (e.g. Class 5 → Class 6). */
export function suggestNextClass(current: string): string {
  const t = current.trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  const idx = LADDER.findIndex((c) => c.toLowerCase() === lower || `class ${c}`.toLowerCase() === lower || `${c}th`.toLowerCase() === lower || `${c}st`.toLowerCase() === lower || `${c}nd`.toLowerCase() === lower || `${c}rd`.toLowerCase() === lower);
  if (idx >= 0 && idx < LADDER.length - 1) {
    const next = LADDER[idx + 1];
    if (/^class\s/i.test(t)) return `Class ${next}`;
    if (/\d+(st|nd|rd|th)$/i.test(t)) {
      const n = Number(next);
      const suf = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
      return `${n}${suf}`;
    }
    return next;
  }
  const m = t.match(/^(.*?)(\d+)(.*)$/);
  if (m) return `${m[1]}${Number(m[2]) + 1}${m[3]}`;
  return t;
}

/** Prefer a course whose name looks like tuitions when opening the screen. */
function defaultCourseId(courses: { id: string; name: string }[]): string {
  const hit = courses.find((c) => /tuition/i.test(c.name));
  return hit?.id ?? courses[0]?.id ?? '';
}

export function ClassUpgradePage() {
  const labels = useLabels();
  const tenant = useTenant();
  const { api } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isPending } = useCoreData();
  const [courseId, setCourseId] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const courses = useMemo(() => {
    if (!data) return [];
    return data.tables.Courses.filter((c) => bool(c.active) && !isDeleted(c)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const selected = courseId || defaultCourseId(courses);

  const rows = useMemo(() => {
    if (!data || !selected) return [];
    const students = new Map(data.tables.Students.map((s) => [s.id, s]));
    const seen = new Set<string>();
    return data.tables.Enrollments
      .filter((e) => e.course_id === selected && e.status === 'Active')
      .map((e) => students.get(e.student_id))
      .filter((s): s is Student => !!s && s.status === 'Active' && !seen.has(s.id) && !!seen.add(s.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => {
        const next = s.id in edits ? edits[s.id] : suggestNextClass(s.class);
        return { student: s, next, changed: next.trim() !== String(s.class || '').trim() };
      });
  }, [data, selected, edits]);

  if (isPending || !data) return <Spinner />;

  const changed = rows.filter((r) => r.changed);

  async function apply() {
    if (!changed.length) return;
    setSaving(true);
    setErr(null);
    try {
      const saved: Student[] = [];
      for (const r of changed) {
        const res = await api<{ changes: { Students?: Student[] } }>('students.save', {
          id: r.student.id,
          name: r.student.name,
          class: r.next.trim(),
          dob: r.student.dob,
          join_date: r.student.join_date,
          notes: r.student.notes,
          extra: r.student.extra,
        });
        if (res.changes?.Students?.[0]) saved.push(res.changes.Students[0]);
      }
      queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? applyChanges(old, { Students: saved }) : old));
      setEdits({});
      toast(`Updated class for ${saved.length} ${saved.length === 1 ? labels.student.toLowerCase() : labels.students.toLowerCase()}`);
    } catch (e) {
      setErr(e);
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Link to="/students" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary">
        <ArrowLeft className="size-4" aria-hidden /> {labels.students}
      </Link>
      <PageHeader
        title="Upgrade class"
        subtitle={`After the academic year, move ${labels.students.toLowerCase()} to the next ${labels.class.toLowerCase()}`}
      />

      {courses.length === 0 ? (
        <Card><EmptyState title={`No ${labels.courses.toLowerCase()} yet`}>Add courses and admissions first.</EmptyState></Card>
      ) : (
        <>
          <SelectField label={labels.course} className="mb-4 max-w-md" value={selected} onChange={(e) => { setCourseId(e.target.value); setEdits({}); }}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>

          {rows.length === 0 ? (
            <Card><EmptyState title={`No active ${labels.students.toLowerCase()} in this ${labels.course.toLowerCase()}`} /></Card>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">{rows.length} active · {changed.length} will change. Edit any row before applying.</p>
              <Card className="overflow-x-auto p-0 sm:p-0">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2.5 font-medium sm:px-4">{labels.student}</th>
                      <th className="px-3 py-2.5 font-medium">Current</th>
                      <th className="px-3 py-2.5 font-medium sm:px-4">New {labels.class.toLowerCase()}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map(({ student, next, changed: ch }) => (
                      <tr key={student.id} className={ch ? 'bg-primary-soft/40' : undefined}>
                        <td className="px-3 py-2 sm:px-4">
                          <Link to={`/students/${student.id}`} className="font-medium hover:text-primary">{student.name}</Link>
                        </td>
                        <td className="px-3 py-2 text-muted">{student.class || '—'}</td>
                        <td className="px-3 py-2 sm:px-4">
                          <Field
                            label={`New ${labels.class.toLowerCase()} for ${student.name}`}
                            className="[&>span:first-child]:sr-only"
                            value={next}
                            onChange={(e) => setEdits((m) => ({ ...m, [student.id]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              {!!err && <div className="mt-3"><Alert>{errorMessage(err)}</Alert></div>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button loading={saving} disabled={!changed.length} onClick={apply}>
                  Apply {changed.length || ''} upgrade{changed.length === 1 ? '' : 's'}
                </Button>
                {Object.keys(edits).length > 0 && (
                  <Button variant="ghost" disabled={saving} onClick={() => setEdits({})}>Reset edits</Button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
