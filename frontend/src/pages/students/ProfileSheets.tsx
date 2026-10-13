import { useState, type FormEvent } from 'react';
import { errorField, fieldError } from '../../api/fieldErrors';
import { errorMessage } from '../../api/errors';
import { CustomFieldInputs, type ExtraValues } from '../../components/CustomFieldInputs';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Alert, Button, Field, SelectField, TextAreaField } from '../../components/ui';
import type { Enrollment, Parent, Student, StudentStatus } from '../../data/types';
import { useCoreTables } from '../../data/useCoreData';
import { useWrite } from '../../data/useWrite';
import { formatPhone, phoneProblem } from '../../lib/phone';
import { bool, parseExtra } from '../../lib/values';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { bySortOrder } from '../courses/catalogHooks';
import { EnrollmentOptions, newEnrollmentDraft, todayIso, useActivePlans, type EnrollmentDraft } from '../admissions/enrollmentForm';

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const STATUSES: StudentStatus[] = ['Active', 'On hold', 'Dropped', 'Completed'];

function Footer({ formId, saving, label = 'Save' }: { formId: string; saving: boolean; label?: string }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" form={formId} loading={saving}>{label}</Button>
    </div>
  );
}

/** Shows the error inline when it targets one of `inline`, otherwise as a banner. */
function FormError({ error, inline }: { error: unknown; inline: (field: string) => boolean }) {
  if (!error) return null;
  const f = errorField(error);
  if (f && inline(f)) return null;
  return <Alert>{errorMessage(error)}</Alert>;
}

// ---------- Student details ----------

export function EditStudentSheet({ student, onClose }: { student: Student; onClose: () => void }) {
  const labels = useLabels();
  const toast = useToast();
  const save = useWrite('students.save');
  const [v, setV] = useState({ name: student.name, class: student.class, dob: str(student.dob), join_date: str(student.join_date), notes: student.notes });
  const [extra, setExtra] = useState<ExtraValues>(() => Object.fromEntries(Object.entries(parseExtra(student.extra)).map(([k, x]) => [k, str(x)])));
  const err = save.error;
  const fe = (f: string) => fieldError(err, `student.${f}`);

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ id: student.id, ...v, extra }, { onSuccess: () => { toast('Details saved'); onClose(); } });
  }

  return (
    <Sheet open title={`Edit ${labels.student.toLowerCase()}`} onClose={onClose} footer={<Footer formId="student-form" saving={save.isPending} />}>
      <form id="student-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={fe('name')} className="sm:col-span-2" />
        <Field label={`${labels.class} (optional)`} value={v.class} onChange={(e) => setV({ ...v, class: e.target.value })} error={fe('class')} />
        <Field label="Date of birth (optional)" type="date" value={v.dob} onChange={(e) => setV({ ...v, dob: e.target.value })} error={fe('dob')} />
        <CustomFieldInputs entity="Student" values={extra} onChange={(k, x) => setExtra({ ...extra, [k]: x })} errorFor={(k) => fe(`extra.${k}`)} />
        <Field label="Joined on" type="date" value={v.join_date} onChange={(e) => setV({ ...v, join_date: e.target.value })} error={fe('join_date')} />
        <TextAreaField label="Notes (optional)" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} error={fe('notes')} className="sm:col-span-2" />
        <div className="sm:col-span-2"><FormError error={err} inline={(f) => f.startsWith('student.')} /></div>
      </form>
    </Sheet>
  );
}

// ---------- Guardian ----------

export function EditParentSheet({ parent, onClose }: { parent: Parent; onClose: () => void }) {
  const labels = useLabels();
  const { locale } = useTenant();
  const toast = useToast();
  const save = useWrite('parents.save');
  const [v, setV] = useState({
    guardian_name: parent.guardian_name,
    phone: formatPhone(parent.phone, locale.countryCode),
    alt_phone: parent.alt_phone ? formatPhone(parent.alt_phone, locale.countryCode) : '',
    email: parent.email,
    address: parent.address,
    notes: parent.notes,
  });
  const err = save.error;
  const fe = (f: string) => fieldError(err, `parent.${f}`);

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ id: parent.id, ...v }, { onSuccess: () => { toast(`${labels.guardian} saved`); onClose(); } });
  }

  return (
    <Sheet open title={`Edit ${labels.guardian.toLowerCase()}`} onClose={onClose} footer={<Footer formId="parent-form" saving={save.isPending} />}>
      <form id="parent-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" value={v.guardian_name} onChange={(e) => setV({ ...v, guardian_name: e.target.value })} error={fe('guardian_name')} className="sm:col-span-2" />
        <Field label="Phone" type="tel" inputMode="tel" maxLength={16} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} error={phoneProblem(v.phone, locale.countryCode) ?? fe('phone')} hint="Changing it affects every child in this family" />
        <Field label="Alternate phone (optional)" type="tel" inputMode="tel" maxLength={16} value={v.alt_phone} onChange={(e) => setV({ ...v, alt_phone: e.target.value })} error={phoneProblem(v.alt_phone, locale.countryCode) ?? fe('alt_phone')} />
        <Field label="Email (optional)" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={fe('email')} className="sm:col-span-2" />
        <TextAreaField label="Address (optional)" rows={2} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} error={fe('address')} className="sm:col-span-2" />
        <TextAreaField label="Notes (optional)" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} error={fe('notes')} className="sm:col-span-2" />
        <div className="sm:col-span-2"><FormError error={err} inline={(f) => f.startsWith('parent.')} /></div>
      </form>
    </Sheet>
  );
}

// ---------- Status (student or one course) ----------

const STATUS_HELP: Record<StudentStatus, string> = {
  Active: 'Attends classes and is billed normally.',
  'On hold': 'Temporarily paused (travel, exams, injury). No new dues while on hold.',
  Dropped: 'Has left. Open courses are ended today.',
  Completed: 'Finished the programme. Open courses are ended today.',
};

export function StatusSheet({
  target,
  onClose,
}: {
  target: { kind: 'student'; row: Student } | { kind: 'enrollment'; row: Enrollment; courseName: string };
  onClose: () => void;
}) {
  const labels = useLabels();
  const toast = useToast();
  const write = useWrite(target.kind === 'student' ? 'students.setStatus' : 'enrollments.setStatus');
  const current = target.row.status;
  const [status, setStatus] = useState<StudentStatus>(current === 'Active' ? 'On hold' : 'Active');
  const [reason, setReason] = useState('');
  const [endDate, setEndDate] = useState(todayIso());
  const closing = status === 'Dropped' || status === 'Completed';
  const name = target.kind === 'student' ? target.row.name : target.courseName;

  function submit(e: FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { id: target.row.id, status, reason };
    if (target.kind === 'enrollment' && closing) payload.end_date = endDate;
    write.mutate(payload, { onSuccess: () => { toast(`${name}: ${status}`); onClose(); } });
  }

  return (
    <Sheet open title={`Change status: ${name}`} onClose={onClose} footer={<Footer formId="status-form" saving={write.isPending} label="Change status" />}>
      <form id="status-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">Currently <strong className="text-ink">{current}</strong>.</p>
        <fieldset className="space-y-2">
          <legend className="sr-only">New status</legend>
          {STATUSES.filter((s) => s !== current).map((s) => (
            <label key={s} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} className="mt-1 accent-[var(--tenant-primary)]" />
              <span>
                <span className="block text-sm font-medium">{s}</span>
                <span className="block text-xs text-muted">
                  {target.kind === 'student' ? STATUS_HELP[s] : s === 'Active' ? 'Resume this course.' : s === 'On hold' ? 'Pause only this course.' : 'End only this course.'}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {status !== 'Active' && (
          <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Board exams, moving city" error={fieldError(write.error, 'reason')} />
        )}
        {target.kind === 'enrollment' && closing && (
          <Field label="Last day" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={fieldError(write.error, 'end_date')} />
        )}
        {target.kind === 'student' && status === 'Active' && current === 'On hold' && (
          <p className="text-xs text-muted">Courses paused with this {labels.student.toLowerCase()} resume automatically.</p>
        )}
        <FormError error={write.error} inline={(f) => f === 'reason' || f === 'end_date'} />
      </form>
    </Sheet>
  );
}

// ---------- Add / edit a course ----------

export function EnrollmentSheet({
  student,
  enrollment,
  onClose,
}: {
  student: Student;
  enrollment: Enrollment | null;
  onClose: () => void;
}) {
  const t = useCoreTables();
  const labels = useLabels();
  const toast = useToast();
  const plans = useActivePlans();
  const save = useWrite('enrollments.save');

  const openCourseIds = new Set((t?.Enrollments ?? []).filter((e) => e.student_id === student.id && (e.status === 'Active' || e.status === 'On hold')).map((e) => e.course_id));
  const categories = new Map((t?.Categories ?? []).map((c) => [c.id, c.name]));
  const available = (t?.Courses ?? []).filter((c) => bool(c.active) && !openCourseIds.has(c.id)).sort(bySortOrder);

  const [draft, setDraft] = useState<EnrollmentDraft>(() =>
    enrollment
      ? {
          course_id: enrollment.course_id,
          fee_plan_id: enrollment.fee_plan_id,
          batch_id: enrollment.batch_id,
          start_date: str(enrollment.start_date),
          monthly_fee_override: str(enrollment.monthly_fee_override),
        }
      : newEnrollmentDraft('', plans),
  );
  const [discountNote, setDiscountNote] = useState(enrollment?.discount_note ?? '');
  const course = t?.Courses.find((c) => c.id === draft.course_id);
  const err = save.error;
  const fe = (f: string) => fieldError(err, `enrollment.${f}`);

  function submit(e: FormEvent) {
    e.preventDefault();
    const payload = { ...draft, discount_note: discountNote, ...(enrollment ? { id: enrollment.id } : { student_id: student.id }) };
    save.mutate(payload, { onSuccess: () => { toast(enrollment ? `${course?.name ?? labels.course} updated` : `Added to ${course?.name ?? labels.course}`); onClose(); } });
  }

  const title = enrollment ? `Edit ${course?.name ?? labels.course.toLowerCase()}` : `Add ${labels.course.toLowerCase()}`;
  return (
    <Sheet open wide title={title} onClose={onClose} footer={<Footer formId="enrollment-form" saving={save.isPending} label={enrollment ? 'Save' : `Add ${labels.course.toLowerCase()}`} />}>
      <form id="enrollment-form" onSubmit={submit} className="space-y-4">
        {!enrollment && (
          <SelectField label={labels.course} value={draft.course_id} onChange={(e) => setDraft({ ...draft, course_id: e.target.value, batch_id: '' })} error={fe('course_id')}>
            <option value="">Choose…</option>
            {available.map((c) => <option key={c.id} value={c.id}>{c.name}{categories.get(c.category_id) ? ` · ${categories.get(c.category_id)}` : ''}</option>)}
          </SelectField>
        )}
        {course && <EnrollmentOptions draft={draft} course={course} onChange={(patch) => setDraft({ ...draft, ...patch })} errorFor={(f) => fe(f)} />}
        {course && (
          <Field label="Discount note (optional)" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} placeholder="e.g. Sibling discount" error={fe('discount_note')} />
        )}
        <FormError error={err} inline={(f) => f.startsWith('enrollment.')} />
      </form>
    </Sheet>
  );
}
