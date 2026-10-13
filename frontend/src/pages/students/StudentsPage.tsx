import { Search, UserPlus } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ExportButton } from '../../components/ExportButton';
import { Button, Card, EmptyState, PageHeader, SelectField, Spinner, StatusBadge } from '../../components/ui';
import type { StudentStatus } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { formatPhone, phoneDigits } from '../../lib/phone';
import { useLabels, useTenant } from '../../tenant/TenantContext';

const STATUSES: StudentStatus[] = ['Active', 'On hold', 'Dropped', 'Completed'];
const OPEN = (s: string) => s === 'Active' || s === 'On hold';

export function StudentsPage() {
  const labels = useLabels();
  const { locale } = useTenant();
  const navigate = useNavigate();
  const { data, isPending } = useCoreData();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'Active';
  const courseId = params.get('course') ?? '';
  const query = params.get('q') ?? '';
  const deferredQuery = useDeferredValue(query);

  const setParam = (key: string, value: string, fallback = '') =>
    setParams((p) => {
      if (value === fallback) p.delete(key);
      else p.set(key, value);
      return p;
    }, { replace: true });

  const rows = useMemo(() => {
    const t = data?.tables;
    if (!t) return [];
    const parents = new Map(t.Parents.map((p) => [p.id, p]));
    const courseNames = new Map(t.Courses.map((c) => [c.id, c.name]));
    const openCourses = new Map<string, string[]>();
    t.Enrollments.forEach((e) => {
      if (!OPEN(e.status)) return;
      const list = openCourses.get(e.student_id) ?? [];
      list.push(e.course_id);
      openCourses.set(e.student_id, list);
    });

    const q = deferredQuery.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return t.Students
      .map((s) => {
        const parent = parents.get(s.parent_id);
        const courses = openCourses.get(s.id) ?? [];
        return { student: s, parent, courseIds: courses, courses: courses.map((c) => courseNames.get(c) ?? '?') };
      })
      .filter(({ student, parent, courseIds }) => {
        if (status !== 'All' && student.status !== status) return false;
        if (courseId && !courseIds.includes(courseId)) return false;
        if (!q) return true;
        if (student.name.toLowerCase().includes(q)) return true;
        if (parent?.guardian_name.toLowerCase().includes(q)) return true;
        return qDigits.length >= 3 && !!parent && phoneDigits(parent.phone).includes(qDigits);
      })
      .sort((a, b) => a.student.name.localeCompare(b.student.name));
  }, [data, status, courseId, deferredQuery]);

  if (isPending || !data) return <Spinner />;
  const t = data.tables;
  const courses = [...t.Courses].sort((a, b) => a.name.localeCompare(b.name));
  const filtered = status !== 'Active' || courseId || query;

  return (
    <>
      <PageHeader
        title={labels.students}
        subtitle={`${rows.length} shown · ${t.Students.filter((s) => s.status === 'Active').length} active`}
        actions={
          <>
            <ExportButton list="students" />
            <Button onClick={() => navigate('/admissions/new')}>
              <UserPlus className="size-4" aria-hidden /> New admission
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="relative block">
          <span className="sr-only">Search {labels.students.toLowerCase()}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder={`Name, ${labels.guardian.toLowerCase()} or phone`}
            className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <SelectField label="Status" className="[&>span]:sr-only" value={status} onChange={(e) => setParam('status', e.target.value, 'Active')}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="All">All statuses</option>
        </SelectField>
        <SelectField label={labels.course} className="[&>span]:sr-only" value={courseId} onChange={(e) => setParam('course', e.target.value)}>
          <option value="">All {labels.courses.toLowerCase()}</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
      </div>

      {rows.length === 0 ? (
        <Card>
          {t.Students.length === 0 ? (
            <EmptyState title={`No ${labels.students.toLowerCase()} yet`} action={<Button onClick={() => navigate('/admissions/new')}>Add the first admission</Button>}>
              Each admission adds a {labels.guardian.toLowerCase()} and one or more children.
            </EmptyState>
          ) : (
            <EmptyState
              title="No matches"
              action={filtered && <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>Clear filters</Button>}
            >
              Try another name or phone number, or change the filters.
            </EmptyState>
          )}
        </Card>
      ) : (
        <>
          <Card className="hidden p-0 sm:block sm:p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">{labels.student}</th>
                  <th className="px-4 py-3 font-medium">{labels.guardian}</th>
                  <th className="px-4 py-3 font-medium">{labels.courses}</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ student, parent, courses: names }) => (
                  <tr key={student.id} className="cursor-pointer hover:bg-primary-soft/60" onClick={() => navigate(`/students/${student.id}`)}>
                    <td className="px-4 py-3">
                      <Link to={`/students/${student.id}`} className="font-medium text-ink hover:text-primary" onClick={(e) => e.stopPropagation()}>
                        {student.name}
                      </Link>
                      {student.class && <span className="ml-2 text-xs text-muted">{labels.class} {student.class}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span>{parent?.guardian_name ?? '—'}</span>
                      {parent && <span className="block text-xs text-muted">{formatPhone(parent.phone, locale.countryCode)}</span>}
                    </td>
                    <td className="px-4 py-3 text-muted">{names.join(', ') || '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={student.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ul className="space-y-2 sm:hidden">
            {rows.map(({ student, parent, courses: names }) => (
              <li key={student.id}>
                <Link to={`/students/${student.id}`} className="block rounded-2xl border border-line bg-surface p-4 active:bg-primary-soft">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{student.name}</p>
                      <p className="break-words text-xs text-muted">
                        {[parent?.guardian_name, student.class && `${labels.class} ${student.class}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <StatusBadge status={student.status} />
                  </div>
                  {names.length > 0 && <p className="mt-2 break-words text-sm text-muted">{names.join(', ')}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
