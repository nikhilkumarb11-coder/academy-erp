import { AlertTriangle, BookOpen, GraduationCap, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Alert, Card, PageHeader, Spinner } from '../components/ui';
import { useCoreData } from '../data/useCoreData';
import { todayIso } from '../lib/dates';
import { collected, familySummaries } from '../lib/ledger';
import { bool } from '../lib/values';
import { useLabels, useTenant } from '../tenant/TenantContext';
import { useMoney } from './fees/feeShared';

function Stat({ label, value, icon: Icon }: { label: string; value: number | string; icon: typeof Users }) {
  return (
    <Card className="flex items-center gap-4">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-primary">
        <Icon className="size-5" aria-hidden />
      </div>
      <div>
        <p className="text-2xl font-semibold text-primary">{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </Card>
  );
}

/** Dashboard from cached core data. Attendance and finance cards come in phase 5. */
export function DashboardPage() {
  const tenant = useTenant();
  const labels = useLabels();
  const money = useMoney();
  const { data, isPending, error } = useCoreData();

  const stats = useMemo(() => {
    if (!data) return null;
    const t = data.tables;
    const activeStudents = t.Students.filter((s) => s.status === 'Active');
    const activeIds = new Set(activeStudents.map((s) => s.id));
    const activeEnrollments = t.Enrollments.filter((e) => e.status === 'Active' && activeIds.has(e.student_id));
    const byCourse = t.Courses.filter((c) => bool(c.active))
      .map((c) => ({ id: c.id, name: c.name, count: activeEnrollments.filter((e) => e.course_id === c.id).length }))
      .sort((a, b) => b.count - a.count);
    const today = todayIso();
    const families = familySummaries(t, today);
    return {
      outstanding: families.reduce((s, f) => s + f.outstanding, 0),
      overdueFamilies: families.filter((f) => f.overdue > 0).length,
      monthCollected: collected(t.Payments, `${today.slice(0, 7)}-01`, today),
      todayCollected: collected(t.Payments, today, today),
      activeStudents: activeStudents.length,
      parents: t.Parents.length,
      courses: t.Courses.filter((c) => bool(c.active)).length,
      unpriced: t.Courses.filter((c) => bool(c.active) && c.monthly_fee === '').length,
      enrollments: activeEnrollments.length,
      byCourse,
      maxCourse: Math.max(1, ...byCourse.map((c) => c.count)),
    };
  }, [data]);

  if (isPending) return <Spinner label="Loading your academy…" />;
  if (!stats) return <p className="text-sm text-danger">{error ? 'Could not load data.' : ''}</p>;

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={greeting}
        subtitle={`${data?.settings.academy_name || tenant.name} at a glance`}
        actions={
          <Link
            to="/admissions/new"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-white shadow-sm hover:opacity-95"
          >
            <UserPlus className="size-4" aria-hidden /> New admission
          </Link>
        }
      />

      {stats.unpriced > 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            {stats.unpriced} {stats.unpriced === 1 ? labels.course.toLowerCase() : labels.courses.toLowerCase()} have no monthly fee yet.{' '}
            <Link to="/courses" className="font-medium underline underline-offset-2">Set fees</Link>
          </Alert>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/fees" className="contents"><Stat label="Outstanding fees" value={money(stats.outstanding)} icon={Wallet} /></Link>
        <Link to="/fees?view=overdue" className="contents"><Stat label="Families overdue" value={stats.overdueFamilies} icon={AlertTriangle} /></Link>
        <Link to="/payments" className="contents"><Stat label="Collected this month" value={money(stats.monthCollected)} icon={TrendingUp} /></Link>
        <Link to="/payments" className="contents"><Stat label="Collected today" value={money(stats.todayCollected)} icon={Wallet} /></Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Active ${labels.students.toLowerCase()}`} value={stats.activeStudents} icon={GraduationCap} />
        <Stat label={labels.guardians} value={stats.parents} icon={Users} />
        <Stat label={`Active ${labels.courses.toLowerCase()}`} value={stats.courses} icon={BookOpen} />
        <Stat label="Active enrolments" value={stats.enrollments} icon={UserPlus} />
      </div>

      <Card className="mt-5">
        <h2 className="mb-4 text-lg font-semibold">{labels.course}-wise enrolment</h2>
        {stats.byCourse.length === 0 ? (
          <p className="text-sm text-muted">
            No {labels.courses.toLowerCase()} yet.{' '}
            <Link to="/settings" className="font-medium text-primary underline underline-offset-2">Load the starter setup in Settings</Link> or{' '}
            <Link to="/courses" className="font-medium text-primary underline underline-offset-2">add them yourself</Link>.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {stats.byCourse.map((c) => (
              <li key={c.id} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_2.5rem]">
                <span className="truncate">{c.name}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-primary-soft">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(c.count / stats.maxCourse) * 100}%` }} />
                </span>
                <span className="text-right font-medium tabular-nums">{c.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-5 text-center text-xs text-muted">Attendance and finance cards are added in a later phase.</p>
    </>
  );
}
