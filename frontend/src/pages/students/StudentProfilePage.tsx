import clsx from 'clsx';
import { ArrowLeft, Loader2, MessageCircle, Pencil, Phone, Plus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCustomFields } from '../../components/CustomFieldInputs';
import { Button, Card, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import type { Enrollment } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { formatDate } from '../../lib/dates';
import { describePlanAmount, monthlyFeeFor } from '../../lib/fees';
import { formatPhone, phoneDigits } from '../../lib/phone';
import { parseExtra } from '../../lib/values';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { EditParentSheet, EditStudentSheet, EnrollmentSheet, StatusSheet } from './ProfileSheets';
import { StudentActivity } from './StudentActivity';

type OpenSheet =
  | { kind: 'student' }
  | { kind: 'parent' }
  | { kind: 'status' }
  | { kind: 'enrollment'; enrollment: Enrollment | null }
  | { kind: 'enrollmentStatus'; enrollment: Enrollment };

const OPEN = (s: string) => s === 'Active' || s === 'On hold';

const linkButton = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium text-primary hover:bg-primary-soft';

export function StudentProfilePage() {
  const { id } = useParams();
  const labels = useLabels();
  const { locale } = useTenant();
  const { data, isPending } = useCoreData();
  const customFields = useCustomFields('Student');
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const close = () => setSheet(null);

  if (isPending) return <Spinner />;
  const t = data?.tables;
  const student = t?.Students.find((s) => s.id === id);
  if (!t || !student) {
    return (
      <Card>
        <p className="text-sm">
          This {labels.student.toLowerCase()} was not found. They may have been removed on another device.{' '}
          <Link to="/students" className="font-medium text-primary underline">Back to {labels.students.toLowerCase()}</Link>
        </p>
      </Card>
    );
  }

  const parent = t.Parents.find((p) => p.id === student.parent_id);
  const siblings = t.Students.filter((s) => s.parent_id === student.parent_id && s.id !== student.id);
  const enrollments = t.Enrollments
    .filter((e) => e.student_id === student.id)
    .sort((a, b) => Number(OPEN(b.status)) - Number(OPEN(a.status)) || String(b.start_date).localeCompare(String(a.start_date)));
  const course = (cid: string) => t.Courses.find((c) => c.id === cid);
  const extra = parseExtra(student.extra);
  const closed = student.status === 'Dropped' || student.status === 'Completed';

  const details: [string, string][] = [
    [labels.class, student.class],
    ['Date of birth', formatDate(student.dob)],
    ...customFields.map((f): [string, string] => [f.label, String(extra[f.key] ?? '')]),
    ['Joined', formatDate(student.join_date)],
  ];

  return (
    <>
      <Link to="/students" className="mb-3 inline-flex min-h-10 items-center gap-1 text-sm text-muted hover:text-primary">
        <ArrowLeft className="size-4" aria-hidden /> {labels.students}
      </Link>
      <PageHeader
        title={student.name}
        subtitle={[student.class && `${labels.class} ${student.class}`, parent?.guardian_name].filter(Boolean).join(' · ')}
        actions={student._pending ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Saving…</span>
        ) : (
          <>
            <button type="button" onClick={() => setSheet({ kind: 'status' })} className="rounded-full" aria-label={`Status: ${student.status}. Change status`}>
              <StatusBadge status={student.status} />
            </button>
            <Button variant="secondary" onClick={() => setSheet({ kind: 'student' })}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
          </>
        )}
      />
      {student.status !== 'Active' && student.status_reason && (
        <p className="-mt-3 mb-4 text-sm text-muted">
          {student.status}: {student.status_reason}{' '}
          <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setSheet({ kind: 'status' })}>Change</button>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{labels.courses}</h2>
            {!closed && !student._pending && (
              <Button variant="secondary" className="min-h-10" onClick={() => setSheet({ kind: 'enrollment', enrollment: null })}>
                <Plus className="size-4" aria-hidden /> Add {labels.course.toLowerCase()}
              </Button>
            )}
          </div>
          {enrollments.length === 0 ? (
            <p className="text-sm text-muted">Not enrolled in any {labels.course.toLowerCase()} yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {enrollments.map((e) => {
                const c = course(e.course_id);
                const plan = t.FeePlans.find((p) => p.id === e.fee_plan_id);
                const batch = t.Batches.find((b) => b.id === e.batch_id);
                const fee = monthlyFeeFor(c, e);
                const open = OPEN(e.status);
                return (
                  <li key={e.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={open ? 'font-medium' : 'font-medium text-muted'}>{c?.name ?? 'Unknown'}</p>
                        <p className="text-sm text-muted">
                          {[plan?.name, batch?.name, fee === null ? 'Fee not set' : describePlanAmount(fee, plan, locale.currencySymbol)].filter(Boolean).join(' · ')}
                        </p>
                        <p className="text-xs text-muted">
                          From {formatDate(e.start_date)}
                          {e.end_date && ` to ${formatDate(e.end_date)}`}
                          {e.discount_note && ` · ${e.discount_note}`}
                          {e.status !== 'Active' && e.status_reason && ` · ${e.status_reason}`}
                        </p>
                      </div>
                      <div className={clsx('flex items-center gap-1', e._pending && 'pointer-events-none opacity-60')}>
                        <button type="button" onClick={() => setSheet({ kind: 'enrollmentStatus', enrollment: e })} className="rounded-full" aria-label={`${c?.name}: ${e.status}. Change status`}>
                          <StatusBadge status={e.status} />
                        </button>
                        {open && (
                          <Button variant="ghost" className="min-h-9 px-2" onClick={() => setSheet({ kind: 'enrollment', enrollment: e })} aria-label={`Edit ${c?.name}`}>
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{labels.guardian}</h2>
            {parent && !parent._pending && (
              <Button variant="ghost" className="min-h-9 px-2" onClick={() => setSheet({ kind: 'parent' })} aria-label={`Edit ${labels.guardian.toLowerCase()}`}>
                <Pencil className="size-4" aria-hidden />
              </Button>
            )}
          </div>
          {parent ? (
            <>
              <p className="font-medium">{parent.guardian_name}</p>
              <p className="text-sm text-muted">{formatPhone(parent.phone, locale.countryCode)}</p>
              {parent.alt_phone && <p className="text-sm text-muted">Alt: {formatPhone(parent.alt_phone, locale.countryCode)}</p>}
              {parent.address && <p className="mt-1 text-sm text-muted">{parent.address}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`tel:${parent.phone}`} className={linkButton}>
                  <Phone className="size-4" aria-hidden /> Call
                </a>
                <a href={`https://wa.me/${phoneDigits(parent.phone)}`} target="_blank" rel="noreferrer" className={linkButton}>
                  <MessageCircle className="size-4" aria-hidden /> WhatsApp
                </a>
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-sm font-medium">Siblings</p>
                {siblings.length > 0 ? (
                  <ul className="mb-2 space-y-1">
                    {siblings.map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-sm">
                        <Link to={`/students/${s.id}`} className="text-primary underline-offset-2 hover:underline">{s.name}</Link>
                        <StatusBadge status={s.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-2 text-sm text-muted">None yet.</p>
                )}
                <Link to={`/admissions/new?parent=${parent.id}`} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary">
                  <UserPlus className="size-4" aria-hidden /> Add sibling
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">No {labels.guardian.toLowerCase()} linked.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Details</h2>
          <dl className="space-y-2 text-sm">
            {details.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right font-medium">{value || '—'}</dd>
              </div>
            ))}
          </dl>
          {student.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-canvas p-3 text-sm">{student.notes}</p>}
        </Card>

        <StudentActivity t={t} student={student} />
      </div>

      {sheet?.kind === 'student' && <EditStudentSheet student={student} onClose={close} />}
      {sheet?.kind === 'parent' && parent && <EditParentSheet parent={parent} onClose={close} />}
      {sheet?.kind === 'status' && <StatusSheet target={{ kind: 'student', row: student }} onClose={close} />}
      {sheet?.kind === 'enrollment' && <EnrollmentSheet student={student} enrollment={sheet.enrollment} onClose={close} />}
      {sheet?.kind === 'enrollmentStatus' && (
        <StatusSheet target={{ kind: 'enrollment', row: sheet.enrollment, courseName: course(sheet.enrollment.course_id)?.name ?? labels.course }} onClose={close} />
      )}
    </>
  );
}
