import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarOff, CheckCheck, ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../api/errors';
import { fieldError } from '../../api/fieldErrors';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Alert, Button, Card, EmptyState, Field, PageHeader, SelectField, Spinner } from '../../components/ui';
import { activeCourses, attendanceDayQuery, attendanceMonthQuery, defaultAttendanceCourse, LAST_COURSE } from '../../data/attendance';
import type { AttendanceMark, AttendanceStatus, CoreTables, Holiday } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { useLogMessages, useRecentMessages } from '../../data/useMessages';
import { beginSave, endSave } from '../../data/pending';
import { useWrite } from '../../data/useWrite';
import { addDaysIso, addMonths, formatDate, monthLabel, todayIso, weekdayShort } from '../../lib/dates';
import { bool, isDeleted } from '../../lib/values';
import { fillMessage, templateText, whatsappUrl } from '../../lib/whatsapp';
import { useLabels, useTenant } from '../../tenant/TenantContext';

type Mark = AttendanceStatus | '';
const STATES: { status: AttendanceStatus; short: string; on: string }[] = [
  { status: 'Present', short: 'P', on: 'border-success bg-success text-white' },
  { status: 'Absent', short: 'A', on: 'border-danger bg-danger text-white' },
];
type DayMarks = { marks: AttendanceMark[] };

/** Course picker with prev/next chevrons (same pattern as the date stepper). */
function CourseStepper({ courses, courseId, onChange, label }: {
  courses: { id: string; name: string }[];
  courseId: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const i = Math.max(0, courses.findIndex((c) => c.id === courseId));
  const course = courses[i] ?? courses[0];
  return (
    <div className="inline-flex w-full min-w-0 items-center rounded-xl border border-line bg-surface">
      <button type="button" aria-label={`Previous ${label}`} disabled={i <= 0}
        className="grid size-11 shrink-0 place-items-center text-muted hover:text-primary disabled:opacity-30"
        onClick={() => onChange(courses[i - 1].id)}>
        <ChevronLeft className="size-5" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate px-1 text-center font-medium">{course?.name}</span>
      <button type="button" aria-label={`Next ${label}`} disabled={i >= courses.length - 1}
        className="grid size-11 shrink-0 place-items-center text-muted hover:text-primary disabled:opacity-30"
        onClick={() => onChange(courses[i + 1].id)}>
        <ChevronRight className="size-5" aria-hidden />
      </button>
    </div>
  );
}

/** Students enrolled in a course on a date (active, started, not ended), optionally one batch. */
function rosterFor(t: CoreTables, courseId: string, batchId: string, date: string) {
  const students = new Map(t.Students.map((s) => [s.id, s]));
  const seen = new Set<string>();
  return t.Enrollments
    .filter((e) => e.course_id === courseId && e.status === 'Active' && (!batchId || e.batch_id === batchId)
      && (!e.start_date || e.start_date <= date) && (!e.end_date || e.end_date >= date))
    .map((e) => ({ enrollment: e, student: students.get(e.student_id) }))
    .filter((r): r is typeof r & { student: NonNullable<typeof r.student> } => !!r.student && r.student.status === 'Active' && !seen.has(r.student.id) && !!seen.add(r.student.id))
    .sort((a, b) => a.student.name.localeCompare(b.student.name));
}

type AttTab = 'mark' | 'remind' | 'report';
const ATT_TABS: { key: AttTab; label: string }[] = [
  { key: 'mark', label: 'Mark' },
  { key: 'remind', label: 'Remind' },
  { key: 'report', label: 'Monthly report' },
];

export function AttendancePage() {
  const { data, isPending } = useCoreData();
  const [params, setParams] = useSearchParams();
  const tab = (ATT_TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'mark') as AttTab;

  if (isPending || !data) return <Spinner />;
  const courses = activeCourses(data.tables);

  return (
    <>
      <PageHeader title="Attendance" />
      <div className="mb-4 flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-1 sm:inline-flex" role="tablist">
        {ATT_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => setParams((p) => { if (t.key === 'mark') p.delete('tab'); else p.set('tab', t.key); return p; }, { replace: true })}
            className={clsx('min-h-9 shrink-0 rounded-lg px-3 text-sm font-medium sm:px-4', tab === t.key ? 'bg-primary text-white' : 'text-muted')}>
            {t.label}
          </button>
        ))}
      </div>
      {courses.length === 0 ? (
        <Card><EmptyState title="No courses yet">Add courses and admissions first.</EmptyState></Card>
      ) : tab === 'mark' ? (
        <MarkTab t={data.tables} courses={courses} />
      ) : tab === 'remind' ? (
        <RemindTab t={data.tables} courses={courses} settings={data.settings} />
      ) : (
        <ReportTab t={data.tables} courses={courses} />
      )}
    </>
  );
}

function MarkTab({ t, courses }: { t: CoreTables; courses: CoreTables['Courses'] }) {
  const labels = useLabels();
  const tenant = useTenant();
  const { api } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const courseId = params.get('course') ?? defaultAttendanceCourse(t, tenant.slug);
  const batchId = params.get('batch') ?? '';
  const date = params.get('date') ?? today;
  const [edits, setEdits] = useState<{ key: string; marks: Record<string, Mark> }>({ key: '', marks: {} });
  const [remindPrompt, setRemindPrompt] = useState<number | null>(null);
  const [holidaySheet, setHolidaySheet] = useState(false);
  const deleteHoliday = useWrite('holidays.delete');

  const set = (key: string, value: string, fallback = '') =>
    setParams((p) => {
      if (value === fallback) p.delete(key);
      else p.set(key, value);
      if (key === 'course') p.delete('batch');
      return p;
    }, { replace: true });

  const marksOptions = attendanceDayQuery(api, tenant.slug, date);
  const marksKey = marksOptions.queryKey;
  const marksQuery = useQuery(marksOptions);
  const loaded = !!marksQuery.data;
  useEffect(() => {
    if (loaded) queryClient.prefetchQuery(attendanceDayQuery(api, tenant.slug, addDaysIso(date, -1))).catch(() => {});
  }, [loaded, api, tenant.slug, date, queryClient]);

  const course = courses.find((c) => c.id === courseId);
  const batches = t.Batches.filter((b) => b.course_id === courseId && bool(b.active) && !isDeleted(b));
  const roster = useMemo(() => rosterFor(t, courseId, batchId, date), [t, courseId, batchId, date]);
  const holiday = t.Holidays.find((h) => !isDeleted(h) && h.date === date && (!h.course_id || h.course_id === courseId));

  const key = `${courseId}|${date}`;
  const myEdits = edits.key === key ? edits.marks : {};
  const server = useMemo(() => new Map((marksQuery.data?.marks ?? [])
    .filter((m) => m.course_id === courseId && (m.status === 'Present' || m.status === 'Absent'))
    .map((m) => [m.student_id, m.status as Mark])), [marksQuery.data, courseId]);
  const markOf = (studentId: string): Mark => (studentId in myEdits ? myEdits[studentId] : server.get(studentId) ?? '');
  const changed = Object.entries(myEdits).filter(([id, m]) => (server.get(id) ?? '') !== m);
  const counts = roster.reduce((acc, r) => { const m = markOf(r.student.id); if (m === 'Present' || m === 'Absent') acc[m] += 1; else acc.none += 1; return acc; }, { Present: 0, Absent: 0, none: 0 });

  function setMark(studentId: string, m: Mark) {
    setEdits((e) => ({ key, marks: { ...(e.key === key ? e.marks : {}), [studentId]: m } }));
  }

  function markAllPresent() {
    setEdits((e) => {
      const marks = { ...(e.key === key ? e.marks : {}) };
      roster.forEach((r) => { if (!markOf(r.student.id)) marks[r.student.id] = 'Present'; });
      return { key, marks };
    });
  }

  /** Shows the marks as saved straight away; the server confirms in the background. */
  async function save() {
    const sent = changed;
    void queryClient.cancelQueries({ queryKey: marksKey });
    const previous = queryClient.getQueryData<DayMarks>(marksKey);
    const withCourse = (data: DayMarks | undefined, courseMarks: AttendanceMark[]): DayMarks => ({
      marks: [...(data?.marks ?? []).filter((m) => m.course_id !== courseId), ...courseMarks],
    });
    const local = new Map((previous?.marks ?? []).filter((m) => m.course_id === courseId).map((m) => [m.student_id, m]));
    sent.forEach(([student_id, status]) => {
      if (status) local.set(student_id, { ...(local.get(student_id) ?? { id: '', date, course_id: courseId, batch_id: batchId, student_id, remarks: '' }), status } as AttendanceMark);
      else local.delete(student_id);
    });
    queryClient.setQueryData<DayMarks>(marksKey, (d) => withCourse(d, [...local.values()]));
    localStorage.setItem(`${LAST_COURSE}:${tenant.slug}`, courseId);
    const newlyAbsent = sent.filter(([, m]) => m === 'Absent').length;
    setEdits({ key: '', marks: {} });
    toast(`Saved: ${counts.Present} present, ${counts.Absent} absent`);
    if (newlyAbsent > 0) setRemindPrompt(newlyAbsent);

    beginSave([]);
    try {
      const res = await api<DayMarks>('attendance.save', {
        course_id: courseId,
        batch_id: batchId,
        date,
        marks: sent.map(([student_id, status]) => ({ student_id, status })),
      });
      queryClient.setQueryData<DayMarks>(marksKey, (d) => withCourse(d, res.marks));
    } catch (err) {
      queryClient.setQueryData<DayMarks>(marksKey, (d) => withCourse(d, (previous?.marks ?? []).filter((m) => m.course_id === courseId)));
      setEdits((e) => ({ key, marks: { ...Object.fromEntries(sent), ...(e.key === key ? e.marks : {}) } }));
      toast(`Attendance not saved: ${errorMessage(err)}`, 'error');
    } finally {
      endSave([]);
    }
  }

  return (
    <div className="pb-24 lg:pb-0">
      <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <CourseStepper
          courses={courses}
          courseId={courseId}
          label={labels.course}
          onChange={(id) => {
            localStorage.setItem(`${LAST_COURSE}:${tenant.slug}`, id);
            set('course', id);
          }}
        />
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous day" className="grid size-11 place-items-center rounded-xl border border-line bg-surface" onClick={() => set('date', addDaysIso(date, -1), today)}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <label className="flex-1">
            <span className="sr-only">Date</span>
            <input type="date" value={date} max={today} onChange={(e) => e.target.value && set('date', e.target.value, today)}
              className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base" />
          </label>
          <button type="button" aria-label="Next day" disabled={date >= today} className="grid size-11 place-items-center rounded-xl border border-line bg-surface disabled:opacity-40" onClick={() => set('date', addDaysIso(date, 1), today)}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      <p className="mb-3 text-sm text-muted">{weekdayShort(date)}, {formatDate(date)}{date === today && ' · today'}</p>

      {batches.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {[{ id: '', name: 'All' }, ...batches].map((b) => (
            <button key={b.id} type="button" aria-pressed={batchId === b.id} onClick={() => set('batch', b.id)}
              className={clsx('min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium', batchId === b.id ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>
              {b.name}
            </button>
          ))}
        </div>
      )}

      {holiday ? (
        <Card className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm"><CalendarOff className="size-4 text-primary" aria-hidden /> Holiday{holiday.course_id ? '' : ' for all courses'}: <strong>{holiday.reason}</strong></p>
          <Button variant="ghost" className="min-h-9" loading={deleteHoliday.isPending} onClick={() => deleteHoliday.mutate({ id: holiday.id }, { onError: (e) => toast(errorMessage(e), 'error') })}>Not a holiday</Button>
        </Card>
      ) : (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            {roster.length} {roster.length === 1 ? labels.student.toLowerCase() : labels.students.toLowerCase()}
            {roster.length > 0 && (loaded
              ? ` · ${counts.Present} P · ${counts.Absent} A${counts.none ? ` · ${counts.none} not marked` : ''}`
              : marksQuery.isError ? '' : ' · loading saved marks…')}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" className="min-h-9 px-2.5" onClick={() => setHolidaySheet(true)}><CalendarOff className="size-4" aria-hidden /> Holiday</Button>
            {loaded && roster.length > 0 && counts.none > 0 && <Button variant="secondary" className="min-h-9" onClick={markAllPresent}><CheckCheck className="size-4" aria-hidden /> All present</Button>}
          </div>
        </div>
      )}

      {marksQuery.isError && !loaded ? (
        <Alert>{errorMessage(marksQuery.error)} <button type="button" className="underline" onClick={() => marksQuery.refetch()}>Retry</button></Alert>
      ) : roster.length === 0 ? (
        <Card><EmptyState title={`No ${labels.students.toLowerCase()} in this ${labels.course.toLowerCase()}`}>Only active enrolments that started on or before this date are listed.</EmptyState></Card>
      ) : (
        <Card className={clsx('p-0 sm:p-0', holiday && 'opacity-60')}>
          <ul className="divide-y divide-line">
            {roster.map(({ student }) => {
              const current = markOf(student.id);
              return (
                <li key={student.id} className="flex items-center gap-3 px-4 py-2.5">
                  <p className="min-w-0 flex-1 break-words font-medium">{student.name}</p>
                  <div className="flex gap-1.5" role="group" aria-label={`Attendance for ${student.name}`}>
                    {STATES.map((s) => (
                      <button key={s.status} type="button" aria-pressed={current === s.status} aria-label={s.status}
                        onClick={() => setMark(student.id, current === s.status ? '' : s.status)}
                        className={clsx('grid size-11 place-items-center rounded-xl border text-sm font-semibold transition', current === s.status ? s.on : 'border-line bg-surface text-muted')}>
                        {s.short}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {changed.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface p-3 lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="flex-1 text-sm text-muted">{changed.length} change{changed.length === 1 ? '' : 's'}</p>
            <Button variant="ghost" onClick={() => setEdits({ key: '', marks: {} })}>Undo</Button>
            <Button disabled={!loaded} onClick={save}>{loaded ? 'Save attendance' : 'Loading…'}</Button>
          </div>
        </div>
      )}

      {remindPrompt !== null && (
        <Sheet
          open
          title="Remind parents?"
          onClose={() => setRemindPrompt(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRemindPrompt(null)}>Later</Button>
              <Button onClick={() => {
                setRemindPrompt(null);
                setParams((p) => { p.set('tab', 'remind'); return p; }, { replace: true });
              }}>
                Remind now
              </Button>
            </div>
          }
        >
          <p className="text-sm text-muted">
            {remindPrompt} {remindPrompt === 1 ? labels.student.toLowerCase() : labels.students.toLowerCase()} marked absent.
            Open Remind any time to send WhatsApp one by one — the list stays for this course and day.
          </p>
        </Sheet>
      )}

      {holidaySheet && <HolidaySheet date={date} courseId={courseId} courseName={course?.name ?? ''} onClose={() => setHolidaySheet(false)} />}
    </div>
  );
}

function absentWhatsApp(
  t: CoreTables,
  settings: Record<string, string>,
  academy: string,
  courseName: string,
  date: string,
  studentId: string,
) {
  const student = t.Students.find((s) => s.id === studentId);
  const parent = t.Parents.find((p) => p.id === student?.parent_id);
  if (!student || !parent) return null;
  const text = fillMessage(templateText(t.MessageTemplates, 'Absent'), {
    parent: parent.guardian_name,
    student: student.name,
    course: courseName,
    date: formatDate(date),
    academy: settings.academy_name || academy,
  });
  return { studentId, url: whatsappUrl(parent.phone, text), text, parentId: parent.id, studentName: student.name, parentName: parent.guardian_name };
}

function RemindTab({ t, courses, settings }: { t: CoreTables; courses: CoreTables['Courses']; settings: Record<string, string> }) {
  const labels = useLabels();
  const tenant = useTenant();
  const { api } = useAuth();
  const logMessages = useLogMessages();
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const courseId = params.get('course') ?? defaultAttendanceCourse(t, tenant.slug);
  const date = params.get('date') ?? today;
  const [sentLocal, setSentLocal] = useState<Set<string>>(() => new Set());

  const set = (key: string, value: string, fallback = '') =>
    setParams((p) => {
      if (value === fallback) p.delete(key);
      else p.set(key, value);
      return p;
    }, { replace: true });

  const marksQuery = useQuery(attendanceDayQuery(api, tenant.slug, date));
  const course = courses.find((c) => c.id === courseId);
  const absentees = useMemo(() => {
    const ids = (marksQuery.data?.marks ?? [])
      .filter((m) => m.course_id === courseId && m.status === 'Absent')
      .map((m) => m.student_id);
    return [...new Set(ids)]
      .map((id) => absentWhatsApp(t, settings, tenant.name, course?.name ?? '', date, id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  }, [marksQuery.data, courseId, t, settings, tenant.name, course?.name, date]);

  const messages = useRecentMessages(14);
  const alreadySent = useMemo(() => {
    const set = new Set(sentLocal);
    (messages.data ?? []).forEach((m) => {
      if (m.type !== 'Absent' || !m.student_id) return;
      if (String(m.sent_at).slice(0, 10) === date) set.add(m.student_id);
    });
    return set;
  }, [messages.data, date, sentLocal]);

  return (
    <div>
      <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <CourseStepper
          courses={courses}
          courseId={courseId}
          label={labels.course}
          onChange={(id) => {
            localStorage.setItem(`${LAST_COURSE}:${tenant.slug}`, id);
            set('course', id);
          }}
        />
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous day" className="grid size-11 place-items-center rounded-xl border border-line bg-surface" onClick={() => set('date', addDaysIso(date, -1), today)}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <label className="flex-1">
            <span className="sr-only">Date</span>
            <input type="date" value={date} max={today} onChange={(e) => e.target.value && set('date', e.target.value, today)}
              className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base" />
          </label>
          <button type="button" aria-label="Next day" disabled={date >= today} className="grid size-11 place-items-center rounded-xl border border-line bg-surface disabled:opacity-40" onClick={() => set('date', addDaysIso(date, 1), today)}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      <p className="mb-3 text-sm text-muted">
        Absent on {weekdayShort(date)}, {formatDate(date)}
        {absentees.length > 0 && ` · ${absentees.length} to remind`}
        . Send one WhatsApp at a time — come back later if you skip someone.
      </p>

      {marksQuery.isPending ? (
        <Spinner label="Loading absentees…" />
      ) : marksQuery.isError ? (
        <Alert>{errorMessage(marksQuery.error)} <button type="button" className="underline" onClick={() => marksQuery.refetch()}>Retry</button></Alert>
      ) : absentees.length === 0 ? (
        <Card>
          <EmptyState title="No absentees for this day">
            Mark attendance first, then return here to message parents.
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {absentees.map((msg) => {
              const done = alreadySent.has(msg.studentId);
              return (
                <li key={msg.studentId} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{msg.studentName}</p>
                    <p className="text-xs text-muted">{msg.parentName}{done ? ' · messaged' : ''}</p>
                  </div>
                  <a
                    href={msg.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      setSentLocal((prev) => new Set(prev).add(msg.studentId));
                      logMessages([{ type: 'Absent', parent_id: msg.parentId, student_id: msg.studentId, preview: msg.text }]);
                    }}
                    className={clsx(
                      'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium',
                      done ? 'border-line text-muted' : 'border-line text-primary hover:bg-primary-soft',
                    )}
                  >
                    <MessageCircle className="size-4" aria-hidden /> {done ? 'Send again' : 'WhatsApp'}
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

function HolidaySheet({ date, courseId, courseName, onClose }: { date: string; courseId: string; courseName: string; onClose: () => void }) {
  const toast = useToast();
  const save = useWrite<Partial<Holiday>>('holidays.save');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<'all' | 'course'>('all');

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ date, reason, course_id: scope === 'all' ? '' : courseId }, { onSuccess: () => { toast('Holiday marked'); onClose(); } });
  }

  return (
    <Sheet open title={`Holiday on ${formatDate(date)}`} onClose={onClose}
      footer={<div className="flex justify-end"><Button type="submit" form="holiday-form" loading={save.isPending}>Mark holiday</Button></div>}>
      <form id="holiday-form" onSubmit={submit} className="space-y-4">
        <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Diwali" error={fieldError(save.error, 'reason')} autoFocus />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Applies to</legend>
          {([['all', 'All courses'], ['course', `Only ${courseName}`]] as const).map(([k, label]) => (
            <label key={k} className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
              <input type="radio" name="scope" checked={scope === k} onChange={() => setScope(k)} className="size-4 accent-[var(--tenant-primary)]" />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </fieldset>
        {save.error && !fieldError(save.error, 'reason') ? <Alert>{errorMessage(save.error)}</Alert> : null}
      </form>
    </Sheet>
  );
}

function ReportTab({ t, courses }: { t: CoreTables; courses: CoreTables['Courses'] }) {
  const labels = useLabels();
  const tenant = useTenant();
  const { api } = useAuth();
  const thisMonth = todayIso().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [courseId, setCourseId] = useState(courses[0].id);

  const report = useQuery(attendanceMonthQuery(api, tenant.slug, month, courseId));

  const rows = useMemo(() => {
    const marks = (report.data?.rows ?? []).filter((m) => m.status === 'Present' || m.status === 'Absent');
    const days = new Set(marks.map((m) => m.date)).size;
    const byStudent = new Map<string, { Present: number; Absent: number }>();
    marks.forEach((m) => {
      const c = byStudent.get(m.student_id) ?? { Present: 0, Absent: 0 };
      c[m.status as 'Present' | 'Absent'] += 1;
      byStudent.set(m.student_id, c);
    });
    const enrolled = new Set(t.Enrollments.filter((e) => e.course_id === courseId && e.status !== 'Dropped').map((e) => e.student_id));
    const ids = new Set([...enrolled].filter((id) => t.Students.find((s) => s.id === id)?.status === 'Active').concat([...byStudent.keys()]));
    return {
      days,
      list: [...ids].map((id) => {
        const c = byStudent.get(id) ?? { Present: 0, Absent: 0 };
        const marked = c.Present + c.Absent;
        return { id, name: t.Students.find((s) => s.id === id)?.name ?? '?', ...c, pct: marked ? Math.round((c.Present / marked) * 100) : null };
      }).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.name.localeCompare(b.name)),
    };
  }, [report.data, t, courseId]);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <CourseStepper courses={courses} courseId={courseId} label={labels.course} onChange={setCourseId} />
        <SelectField label="Month" className="[&>span]:sr-only" value={month} onChange={(e) => setMonth(e.target.value)}>
          {Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, -i)).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </SelectField>
      </div>
      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <Alert>{errorMessage(report.error)}</Alert>
      ) : rows.list.length === 0 ? (
        <Card><EmptyState title="Nothing to report">No {labels.students.toLowerCase()} or marks for {monthLabel(month)}.</EmptyState></Card>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">{rows.days} class day{rows.days === 1 ? '' : 's'} marked in {monthLabel(month)}. Below 75% is highlighted.</p>
          <Card className="overflow-x-auto p-0 sm:p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2.5 font-medium sm:px-4">{labels.student}</th>
                  <th className="px-1.5 py-2.5 text-center font-medium sm:px-2">P</th>
                  <th className="px-1.5 py-2.5 text-center font-medium sm:px-2">A</th>
                  <th className="px-3 py-2.5 text-right font-medium sm:px-4">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.list.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2.5 font-medium sm:px-4">{r.name}</td>
                    <td className="px-1.5 py-2.5 text-center tabular-nums sm:px-2">{r.Present}</td>
                    <td className="px-1.5 py-2.5 text-center tabular-nums sm:px-2">{r.Absent}</td>
                    <td className={clsx('px-3 py-2.5 text-right font-semibold tabular-nums sm:px-4', r.pct !== null && r.pct < 75 && 'text-danger')}>{r.pct === null ? '—' : `${r.pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
