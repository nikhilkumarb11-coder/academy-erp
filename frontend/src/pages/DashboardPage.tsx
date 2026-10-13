import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, BookOpen, ChevronRight, GraduationCap, PhoneIncoming, PiggyBank, Receipt, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { InstallBanner } from '../components/InstallApp';
import { Alert, Card, PageHeader, Spinner } from '../components/ui';
import type { AttendanceMark } from '../data/types';
import { useCoreData } from '../data/useCoreData';
import { addDaysIso, formatDate, todayIso } from '../lib/dates';
import { collected, dueNet, familySummaries, isOpenDue } from '../lib/ledger';
import { bool, isDeleted, num } from '../lib/values';
import { useLabels, useTenant } from '../tenant/TenantContext';
import { isOpenEnquiry, needsFollowUp } from '../lib/enquiries';
import { useMoney } from './fees/feeShared';

const LOW_ATTENDANCE = 0.75;
const MIN_MARKS = 4;

function Stat({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: typeof Users; tone?: 'good' | 'bad' }) {
  return (
    <Card className="flex items-center gap-4">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-primary">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className={clsx('truncate text-2xl font-semibold', tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-success' : 'text-primary')}>{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </Card>
  );
}

function Panel({ title, to, linkLabel, children }: { title: string; to?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {to && <Link to={to} className="inline-flex items-center text-sm font-medium text-primary">{linkLabel ?? 'Open'} <ChevronRight className="size-4" aria-hidden /></Link>}
      </div>
      {children}
    </Card>
  );
}

function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-2">
      <p className={clsx('text-xl font-semibold tabular-nums', tone === 'bad' && 'text-danger')}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

/** Dashboard from cached core data; today's attendance comes from one attendance.report call. */
export function DashboardPage() {
  const tenant = useTenant();
  const labels = useLabels();
  const money = useMoney();
  const { api } = useAuth();
  const { data, isPending, error } = useCoreData();
  const today = todayIso();
  const month = today.slice(0, 7);
  const modules = tenant.modules;

  const attendance = useQuery({
    queryKey: ['attendance-report', tenant.slug, month, ''],
    queryFn: () => api<{ rows: AttendanceMark[] }>('attendance.report', { month, course_id: '' }),
    enabled: modules.attendance !== false,
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    if (!data) return null;
    const t = data.tables;
    const monthStart = `${month}-01`;
    const activeStudents = t.Students.filter((s) => s.status === 'Active');
    const activeIds = new Set(activeStudents.map((s) => s.id));
    const activeEnrollments = t.Enrollments.filter((e) => e.status === 'Active' && activeIds.has(e.student_id));
    const byCourse = t.Courses.filter((c) => bool(c.active))
      .map((c) => ({ id: c.id, name: c.name, count: activeEnrollments.filter((e) => e.course_id === c.id).length }))
      .sort((a, b) => b.count - a.count);
    const families = familySummaries(t, today);
    const monthCollected = collected(t.Payments, monthStart, today);
    const monthExpenses = t.Expenses.filter((e) => !isDeleted(e) && e.date.slice(0, 7) === month).reduce((s, e) => s + num(e.amount), 0);

    const billedThisMonth = t.FeeDues.filter((d) => !isDeleted(d) && d.status !== 'Waived' && d.due_date.slice(0, 7) === month);
    const billed = billedThisMonth.reduce((s, d) => s + dueNet(d), 0);
    const billedPaid = billedThisMonth.reduce((s, d) => s + Math.max(0, dueNet(d) - num(d.balance)), 0);
    const weekAhead = addDaysIso(today, 7);
    const upcoming = t.FeeDues.filter((d) => isOpenDue(d) && d.due_date >= today && d.due_date <= weekAhead).reduce((s, d) => s + num(d.balance), 0);

    const enquiries = t.Enquiries.filter((q) => !isDeleted(q));
    const converted = enquiries.filter((q) => q.status === 'Converted').length;
    const closed = converted + enquiries.filter((q) => q.status === 'Lost').length;

    const parentName = new Map(t.Parents.map((p) => [p.id, p.guardian_name]));
    return {
      outstanding: families.reduce((s, f) => s + f.outstanding, 0),
      overdueFamilies: families.filter((f) => f.overdue > 0).length,
      topDefaulters: families.filter((f) => f.overdue > 0).slice(0, 5),
      monthCollected,
      todayCollected: collected(t.Payments, today, today),
      monthExpenses,
      monthNet: monthCollected - monthExpenses,
      collectionRate: billed > 0 ? Math.round((billedPaid / billed) * 100) : null,
      upcoming,
      recentPayments: t.Payments.filter((p) => p.status === 'Recorded')
        .sort((a, b) => b.paid_at.localeCompare(a.paid_at) || b.created_at.localeCompare(a.created_at))
        .slice(0, 5)
        .map((p) => ({ ...p, family: parentName.get(p.parent_id) ?? '' })),
      followUps: enquiries.filter((q) => needsFollowUp(q, today)).length,
      openEnquiries: enquiries.filter(isOpenEnquiry).length,
      newEnquiries: enquiries.filter((q) => q.enquiry_date.slice(0, 7) === month).length,
      conversion: closed ? Math.round((converted / closed) * 100) : null,
      admissions: t.Students.filter((s) => (s.join_date || s.created_at).slice(0, 7) === month).length,
      dropouts: t.Students.filter((s) => s.status === 'Dropped' && s.updated_at.slice(0, 7) === month).length,
      activeStudents: activeStudents.length,
      parents: t.Parents.length,
      courses: t.Courses.filter((c) => bool(c.active)).length,
      unpriced: t.Courses.filter((c) => bool(c.active) && c.monthly_fee === '').length,
      enrollments: activeEnrollments.length,
      byCourse,
      maxCourse: Math.max(1, ...byCourse.map((c) => c.count)),
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
    const names = new Map(data.tables.Students.filter((s) => s.status === 'Active').map((s) => [s.id, s.name]));
    const low = [...perStudent.entries()]
      .filter(([id, s]) => names.has(id) && s.total >= MIN_MARKS && s.present / s.total < LOW_ATTENDANCE)
      .map(([id, s]) => ({ id, name: names.get(id)!, pct: Math.round((s.present / s.total) * 100) }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);
    return {
      present: todays.filter((r) => r.status === 'Present').length,
      absent: todays.filter((r) => r.status === 'Absent').length,
      leave: todays.filter((r) => r.status === 'Leave').length,
      low,
    };
  }, [attendance.data, data, today]);

  if (isPending) return <Spinner label="Loading your academy…" />;
  if (!stats) return <p className="text-sm text-danger">{error ? 'Could not load data.' : ''}</p>;

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const showFinance = modules.expenses !== false || modules.finance !== false;

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

      <InstallBanner />

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

      {showFinance && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Link to="/expenses" className="contents"><Stat label="Expenses this month" value={money(stats.monthExpenses)} icon={Receipt} /></Link>
          <Link to="/reports" className="contents"><Stat label={stats.monthNet >= 0 ? 'Profit this month' : 'Loss this month'} value={money(stats.monthNet)} icon={PiggyBank} tone={stats.monthNet < 0 ? 'bad' : 'good'} /></Link>
          <Stat label="This month's fees collected" value={stats.collectionRate === null ? '—' : `${stats.collectionRate}%`} icon={TrendingUp} />
          <Stat label="Due in the next 7 days" value={money(stats.upcoming)} icon={Wallet} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Active ${labels.students.toLowerCase()}`} value={stats.activeStudents} icon={GraduationCap} />
        <Stat label={labels.guardians} value={stats.parents} icon={Users} />
        <Stat label={`Active ${labels.courses.toLowerCase()}`} value={stats.courses} icon={BookOpen} />
        <Stat label="Active enrolments" value={stats.enrollments} icon={UserPlus} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {modules.attendance !== false && (
          <Panel title="Today's attendance" to="/attendance" linkLabel="Mark">
            {!att ? <p className="text-sm text-muted">{attendance.isError ? 'Could not load attendance.' : 'Loading…'}</p> : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Figure label="Present" value={att.present} />
                  <Figure label="Absent" value={att.absent} tone={att.absent ? 'bad' : undefined} />
                  <Figure label="On leave" value={att.leave} />
                </div>
                {att.present + att.absent + att.leave === 0 && <p className="mt-2 text-sm text-muted">Not marked yet today.</p>}
                {att.low.length > 0 && (
                  <>
                    <p className="mb-1 mt-4 text-sm font-medium">Below {LOW_ATTENDANCE * 100}% this month</p>
                    <ul className="divide-y divide-line text-sm">
                      {att.low.map((s) => (
                        <li key={s.id}><Link to={`/students/${s.id}`} className="flex justify-between py-1.5 hover:text-primary"><span>{s.name}</span><span className="font-medium text-danger tabular-nums">{s.pct}%</span></Link></li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </Panel>
        )}

        {modules.enquiries !== false && (
          <Panel title="Enquiries" to="/enquiries">
            <div className="grid grid-cols-3 gap-2">
              <Link to="/enquiries"><Figure label="Follow up today" value={stats.followUps} tone={stats.followUps ? 'bad' : undefined} /></Link>
              <Figure label="New this month" value={stats.newEnquiries} />
              <Figure label="Join rate" value={stats.conversion === null ? '—' : `${stats.conversion}%`} />
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted">
              <PhoneIncoming className="size-4" aria-hidden /> {stats.openEnquiries} open · {stats.admissions} admitted and {stats.dropouts} dropped out this month
            </p>
          </Panel>
        )}

        <Panel title="Recent payments" to="/payments" linkLabel="All">
          {stats.recentPayments.length === 0 ? <p className="text-sm text-muted">No payments yet.</p> : (
            <ul className="divide-y divide-line text-sm">
              {stats.recentPayments.map((p) => (
                <li key={p.id}>
                  <Link to={`/receipts/${p.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-primary">
                    <span className="min-w-0"><span className="block truncate font-medium">{p.family}</span><span className="text-xs text-muted">{formatDate(p.paid_at)} · {p.mode}</span></span>
                    <span className="font-medium tabular-nums">{money(num(p.amount))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Most overdue" to="/fees?view=overdue" linkLabel="All dues">
          {stats.topDefaulters.length === 0 ? <p className="text-sm text-muted">No overdue fees. 🎉</p> : (
            <ul className="divide-y divide-line text-sm">
              {stats.topDefaulters.map((f) => (
                <li key={f.parentId}>
                  <Link to={`/fees/${f.parentId}`} className="flex items-center justify-between gap-3 py-2 hover:text-primary">
                    <span className="min-w-0"><span className="block truncate font-medium">{f.guardian}</span><span className="text-xs text-muted">{f.children.join(', ')}{f.bucket && ` · ${f.bucket}`}</span></span>
                    <span className="font-medium text-danger tabular-nums">{money(f.overdue)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Card className="mt-4">
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
    </>
  );
}
