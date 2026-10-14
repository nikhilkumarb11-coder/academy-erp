import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarCheck, CheckCircle2, ChevronRight, GraduationCap, PhoneIncoming, Receipt, Tag, TrendingDown, UserPlus, Wallet } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { InstallBanner } from '../components/InstallApp';
import { Card, PageHeader, Spinner } from '../components/ui';
import { attendanceMonthQuery } from '../data/attendance';
import { useCoreData } from '../data/useCoreData';
import { formatDate, todayIso } from '../lib/dates';
import { isOpenEnquiry, needsFollowUp } from '../lib/enquiries';
import { collected, familySummaries } from '../lib/ledger';
import { bool, isDeleted, num } from '../lib/values';
import { useLabels, useTenant } from '../tenant/TenantContext';
import { useMoney } from './fees/feeShared';

const LOW_ATTENDANCE = 0.75;
const MIN_MARKS = 4;

function Tile({ to, icon: Icon, label, value, hint }: { to: string; icon: typeof Wallet; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Link to={to} className="group block">
      <Card className="h-full transition group-hover:border-primary/40 group-hover:shadow-md">
        <div className="flex items-center justify-between">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-primary"><Icon className="size-5" aria-hidden /></span>
          <ChevronRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
        </div>
        <p className="mt-3 break-words text-2xl font-semibold tabular-nums text-primary">{value}</p>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </Card>
    </Link>
  );
}

interface Attention {
  key: string;
  to: string;
  icon: typeof Wallet;
  text: string;
}

/** Four numbers that matter today, what needs doing, and the latest payments. Everything else lives in Reports. */
export function DashboardPage() {
  const tenant = useTenant();
  const labels = useLabels();
  const money = useMoney();
  const { api } = useAuth();
  const { data, isPending, error } = useCoreData();
  const today = todayIso();
  const month = today.slice(0, 7);
  const modules = tenant.modules;
  const showAttendance = modules.attendance !== false;

  const attendance = useQuery({ ...attendanceMonthQuery(api, tenant.slug, month), enabled: showAttendance });

  const stats = useMemo(() => {
    if (!data) return null;
    const t = data.tables;
    const activeStudents = t.Students.filter((s) => s.status === 'Active');
    const activeIds = new Set(activeStudents.map((s) => s.id));
    const activeEnrollments = t.Enrollments.filter((e) => e.status === 'Active' && activeIds.has(e.student_id));
    const courses = t.Courses.filter((c) => bool(c.active));
    const top = courses
      .map((c) => ({ name: c.name, count: activeEnrollments.filter((e) => e.course_id === c.id).length }))
      .sort((a, b) => b.count - a.count)[0];
    const recorded = new Set(t.Expenses.map((e) => e.ref_id).filter(Boolean));
    const parentName = new Map(t.Parents.map((p) => [p.id, p.guardian_name]));

    return {
      activeStudents: activeStudents.length,
      enrollments: activeEnrollments.length,
      outstanding: familySummaries(t, today).reduce((s, f) => s + f.outstanding, 0),
      monthCollected: collected(t.Payments, `${month}-01`, today),
      courses: courses.length,
      topCourse: top && top.count > 0 ? top : null,
      unpriced: courses.filter((c) => c.monthly_fee === '').length,
      followUps: t.Enquiries.filter((q) => !isDeleted(q) && isOpenEnquiry(q) && needsFollowUp(q, today)).length,
      recurringDue: t.RecurringExpenses.filter((r) => !isDeleted(r) && bool(r.active) && !bool(r.auto_create) && num(r.day_of_month) <= Number(today.slice(8)) && !recorded.has(`${r.id}:${month}`)).length,
      recentPayments: t.Payments.filter((p) => p.status === 'Recorded')
        .sort((a, b) => b.paid_at.localeCompare(a.paid_at) || b.created_at.localeCompare(a.created_at))
        .slice(0, 3)
        .map((p) => ({ ...p, family: parentName.get(p.parent_id) ?? '' })),
    };
  }, [data, today, month]);

  const att = useMemo(() => {
    const rows = attendance.data?.rows;
    if (!rows || !data) return null;
    const todays = rows.filter((r) => r.date === today);
    const perStudent = new Map<string, { present: number; total: number }>();
    rows.forEach((r) => {
      if (r.status === 'Leave') return;
      const s = perStudent.get(r.student_id) ?? { present: 0, total: 0 };
      s.total += 1;
      if (r.status === 'Present') s.present += 1;
      perStudent.set(r.student_id, s);
    });
    const active = new Set(data.tables.Students.filter((s) => s.status === 'Active').map((s) => s.id));
    return {
      present: todays.filter((r) => r.status === 'Present').length,
      absent: todays.filter((r) => r.status === 'Absent').length,
      low: [...perStudent.entries()].filter(([id, s]) => active.has(id) && s.total >= MIN_MARKS && s.present / s.total < LOW_ATTENDANCE).length,
    };
  }, [attendance.data, data, today]);

  if (isPending) return <Spinner label="Loading your academy…" />;
  if (!stats) return <p className="text-sm text-danger">{error ? 'Could not load data.' : ''}</p>;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const marked = att ? att.present + att.absent : 0;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const attention: Attention[] = [
    modules.enquiries !== false && stats.followUps > 0 && { key: 'enq', to: '/enquiries', icon: PhoneIncoming, text: `${plural(stats.followUps, 'enquiry', 'enquiries')} to follow up today` },
    showAttendance && att && marked === 0 && { key: 'mark', to: '/attendance', icon: CalendarCheck, text: "Today's attendance is not marked yet" },
    showAttendance && att && att.low > 0 && { key: 'low', to: '/attendance?tab=report', icon: TrendingDown, text: `${plural(att.low, labels.student.toLowerCase(), labels.students.toLowerCase())} below ${LOW_ATTENDANCE * 100}% attendance this month` },
    modules.expenses !== false && stats.recurringDue > 0 && { key: 'rec', to: '/expenses', icon: Receipt, text: `${plural(stats.recurringDue, 'recurring expense', 'recurring expenses')} to record` },
    stats.unpriced > 0 && { key: 'fee', to: '/courses', icon: Tag, text: `${plural(stats.unpriced, labels.course.toLowerCase(), labels.courses.toLowerCase())} without a monthly fee` },
  ].filter((a): a is Attention => !!a);

  return (
    <>
      <PageHeader
        title={greeting}
        subtitle={data?.settings.academy_name || tenant.name}
        actions={
          <Link to="/admissions/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-white shadow-sm hover:opacity-95">
            <UserPlus className="size-4" aria-hidden /> New admission
          </Link>
        }
      />

      <InstallBanner />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile to="/students" icon={GraduationCap} label={labels.students} value={stats.activeStudents} hint={plural(stats.enrollments, 'enrolment', 'enrolments')} />
        <Tile to="/fees" icon={Wallet} label="Outstanding" value={money(stats.outstanding)} hint={`${money(stats.monthCollected)} collected this month`} />
        {showAttendance && (
          <Tile to="/attendance" icon={CalendarCheck} label="Today's attendance"
            value={!att ? '…' : marked ? `${att.present}/${marked}` : '—'}
            hint={!att ? (attendance.isError ? 'Could not load' : 'Loading') : marked ? `${att.absent} absent` : 'Not marked yet'} />
        )}
        <Tile to="/courses" icon={BookOpen} label={labels.courses} value={stats.courses} hint={stats.topCourse ? `Most joined: ${stats.topCourse.name}` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Needs attention</h2>
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 py-2 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden /> All caught up.</p>
          ) : (
            <ul className="divide-y divide-line">
              {attention.map(({ key, to, icon: Icon, text }) => (
                <li key={key}>
                  <Link to={to} className="flex items-center gap-3 py-2.5 text-sm hover:text-primary">
                    <Icon className="size-4 shrink-0 text-warning" aria-hidden />
                    <span className="flex-1">{text}</span>
                    <ChevronRight className="size-4 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent payments</h2>
            <Link to="/payments" className="inline-flex items-center text-sm font-medium text-primary">All <ChevronRight className="size-4" aria-hidden /></Link>
          </div>
          {stats.recentPayments.length === 0 ? <p className="py-2 text-sm text-muted">No payments yet.</p> : (
            <ul className="divide-y divide-line text-sm">
              {stats.recentPayments.map((p) => (
                <li key={p.id}>
                  <Link to={p._pending ? `/fees/${p.parent_id}` : `/receipts/${p.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-primary">
                    <span className="min-w-0"><span className="block break-words font-medium">{p.family}</span><span className="text-xs text-muted">{formatDate(p.paid_at)} · {p.mode}</span></span>
                    <span className="font-medium tabular-nums">{money(num(p.amount))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(modules.expenses !== false || modules.finance !== false) && (
        <Link to="/reports" className="mt-4 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-medium text-primary hover:bg-primary-soft">
          Income, expenses, profit and charts in Reports <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
    </>
  );
}
