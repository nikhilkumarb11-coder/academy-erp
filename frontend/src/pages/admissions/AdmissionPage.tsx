import clsx from 'clsx';
import { Check, ChevronDown, Plus, UserPlus, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError, errorMessage } from '../../api/errors';
import { errorField, fieldError } from '../../api/fieldErrors';
import { CustomFieldInputs, type ExtraValues } from '../../components/CustomFieldInputs';
import { useToast } from '../../components/Toast';
import { Alert, Button, Card, Field, PageHeader, Spinner, TextAreaField } from '../../components/ui';
import type { ChargeItem, Course, Parent } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { useWrite, type WriteResult } from '../../data/useWrite';
import { formatMoney, monthlyFeeFor, planAmount } from '../../lib/fees';
import { formatPhone, normalizePhone, phoneProblem } from '../../lib/phone';
import { bool, isDeleted, num } from '../../lib/values';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { bySortOrder } from '../courses/catalogHooks';
import { EnrollmentOptions, newEnrollmentDraft, useActivePlans, type EnrollmentDraft } from './enrollmentForm';

interface ChildDraft {
  key: number;
  name: string;
  class: string;
  dob: string;
  extra: ExtraValues;
  enrollments: EnrollmentDraft[];
  /** Admission charges by charge item id; missing = ticked at its default amount. */
  charges: Record<string, { on: boolean; amount: string }>;
}

interface ParentDraft {
  guardian_name: string;
  phone: string;
  alt_phone: string;
  email: string;
  address: string;
  notes: string;
}

interface AdmissionResult extends WriteResult {
  parent_id: string;
  student_ids: string[];
}

let childKey = 1;
const emptyChild = (): ChildDraft => ({ key: childKey++, name: '', class: '', dob: '', extra: {}, enrollments: [], charges: {} });

function chargeOf(child: ChildDraft, item: ChargeItem) {
  return child.charges[item.id] ?? { on: true, amount: num(item.default_amount) ? String(num(item.default_amount)) : '' };
}

export function AdmissionPage() {
  const labels = useLabels();
  const { locale } = useTenant();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { data, isPending } = useCoreData();
  const plans = useActivePlans();
  const create = useWrite<Record<string, unknown>, AdmissionResult>('admissions.create');

  const [existingParentId, setExistingParentId] = useState<string | null>(params.get('parent'));
  const [dismissedMatch, setDismissedMatch] = useState<string | null>(null);
  const [parent, setParent] = useState<ParentDraft>({ guardian_name: '', phone: '', alt_phone: '', email: '', address: '', notes: '' });
  const [moreParent, setMoreParent] = useState(false);
  const [children, setChildren] = useState<ChildDraft[]>(() => [emptyChild()]);
  const [collectNow, setCollectNow] = useState(true);

  const t = data?.tables;
  const enquiry = t?.Enquiries.find((q) => q.id === params.get('enquiry') && !isDeleted(q) && q.status !== 'Converted') ?? null;
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);
  if (enquiry && t && prefilledFrom !== enquiry.id) {
    setPrefilledFrom(enquiry.id);
    const courseIds = enquiry.course_interested.split(',').map((s) => s.trim())
      .filter((id) => t.Courses.some((c) => c.id === id && bool(c.active)));
    setParent((p) => ({ ...p, phone: enquiry.phone, notes: enquiry.notes }));
    setChildren([{ ...emptyChild(), name: enquiry.name, enrollments: courseIds.map((id) => newEnrollmentDraft(id, plans)) }]);
  }
  const existingParent = t?.Parents.find((p) => p.id === existingParentId) ?? null;
  const normalized = normalizePhone(parent.phone, locale.countryCode);
  const phoneMatch = !existingParent && normalized ? t?.Parents.find((p) => p.phone === normalized) ?? null : null;
  const showMatch = phoneMatch && dismissedMatch !== phoneMatch.id;

  const coursesById = useMemo(() => new Map((t?.Courses ?? []).map((c) => [c.id, c])), [t]);
  const courseGroups = useMemo(() => {
    if (!t) return [];
    return [...t.Categories].sort(bySortOrder)
      .map((cat) => ({ category: cat, courses: t.Courses.filter((c) => c.category_id === cat.id && bool(c.active)).sort(bySortOrder) }))
      .filter((g) => g.courses.length > 0);
  }, [t]);

  if (isPending || !t) return <Spinner />;
  const admissionItems = t.ChargeItems.filter((c) => c.applies_to === 'Admission' && bool(c.active) && !isDeleted(c));

  const updateChild = (key: number, patch: Partial<ChildDraft>) => setChildren((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  function toggleCourse(child: ChildDraft, course: Course) {
    const has = child.enrollments.some((e) => e.course_id === course.id);
    updateChild(child.key, {
      enrollments: has ? child.enrollments.filter((e) => e.course_id !== course.id) : [...child.enrollments, newEnrollmentDraft(course.id, plans)],
    });
  }

  const totals = children.reduce(
    (acc, c) => {
      c.enrollments.forEach((e) => {
        const course = coursesById.get(e.course_id);
        const plan = plans.find((p) => p.id === e.fee_plan_id);
        const fee = monthlyFeeFor(course, { monthly_fee_override: e.monthly_fee_override === '' ? '' : num(e.monthly_fee_override) });
        acc.courses += 1;
        if (fee === null || !plan) acc.unpriced += 1;
        else acc.firstBill += planAmount(fee, plan);
      });
      admissionItems.forEach((item) => {
        const ch = chargeOf(c, item);
        if (ch.on) acc.firstBill += num(ch.amount);
      });
      return acc;
    },
    { courses: 0, firstBill: 0, unpriced: 0 },
  );

  const err = create.error;
  const childErr = (i: number, field: string) => fieldError(err, `students.${i}.${field}`);
  const conflictParentId = err instanceof ApiError && err.code === 'CONFLICT' ? (err.details as { parent_id?: string } | undefined)?.parent_id : undefined;
  const shownInline = (() => {
    const f = errorField(err);
    if (!f) return false;
    return f === 'parent.guardian_name' || f === 'parent.phone' || /^students\.\d+\.(name|class|dob)$/.test(f) || /^students\.\d+\.extra\./.test(f) || /^students\.\d+\.enrollments\.\d+\./.test(f) || /^students\.\d+\.charges\.\d+\.amount$/.test(f);
  })();

  function submit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      enquiry_id: enquiry?.id,
      parent: existingParent ? { id: existingParent.id } : parent,
      students: children.map((c) => ({
        name: c.name,
        class: c.class,
        dob: c.dob,
        extra: c.extra,
        enrollments: c.enrollments.map((en) => ({ ...en, monthly_fee_override: en.monthly_fee_override })),
        charges: chosenCharges(c).map(({ item, amount }) => ({ charge_item_id: item.id, amount })),
      })),
    };
    create.mutate(payload, {
      onSuccess: (res) => {
        const n = res.student_ids.length;
        toast(n === 1 ? `${children[0].name} admitted` : `${n} ${labels.students.toLowerCase()} admitted`);
        const owes = res.changes.FeeDues?.some((d) => num((d as { balance?: unknown }).balance) > 0);
        navigate(collectNow && owes ? `/fees/${res.parent_id}?pay=1` : `/students/${res.student_ids[0]}`, { replace: true });
      },
    });
  }

  function chosenCharges(c: ChildDraft) {
    return admissionItems.map((item) => ({ item, ...chargeOf(c, item) })).filter((x) => x.on);
  }

  function chooseParent(p: Parent) {
    setExistingParentId(p.id);
    create.reset();
  }

  return (
    <form onSubmit={submit} className="pb-24 lg:pb-0">
      <PageHeader title="New admission" subtitle={`Add a ${labels.guardian.toLowerCase()} with one or more children`} />

      {enquiry && (
        <div className="mb-4">
          <Alert tone="info">Filled in from the enquiry by {enquiry.name}. It will be marked converted when you save.</Alert>
        </div>
      )}

      <Card className="mb-4">
        <h2 className="mb-4 text-lg font-semibold">{labels.guardian}</h2>
        {existingParent ? (
          <ExistingParent parent={existingParent} onChange={() => setExistingParentId(null)} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="98765 43210"
              value={parent.phone}
              onChange={(e) => setParent((p) => ({ ...p, phone: e.target.value }))}
              maxLength={16}
              error={phoneProblem(parent.phone, locale.countryCode) ?? fieldError(err, 'parent.phone')}
              hint={normalized && !showMatch ? `Saved as ${formatPhone(normalized, locale.countryCode)}` : undefined}
            />
            <Field label={`${labels.guardian} name`} autoComplete="off" value={parent.guardian_name} onChange={(e) => setParent((p) => ({ ...p, guardian_name: e.target.value }))} error={fieldError(err, 'parent.guardian_name')} />
            {showMatch && phoneMatch && (
              <div className="sm:col-span-2">
                <Alert tone="warning">
                  <p className="mb-2">
                    <strong>{phoneMatch.guardian_name}</strong> is already registered with this number
                    {(() => {
                      const kids = t.Students.filter((s) => s.parent_id === phoneMatch.id).map((s) => s.name);
                      return kids.length ? ` (${kids.join(', ')})` : '';
                    })()}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => chooseParent(phoneMatch)}>Add child to this family</Button>
                    <Button type="button" variant="ghost" onClick={() => setDismissedMatch(phoneMatch.id)}>Use a different number</Button>
                  </div>
                </Alert>
              </div>
            )}
            <TextAreaField label="Address" rows={2} value={parent.address} onChange={(e) => setParent((p) => ({ ...p, address: e.target.value }))} className="sm:col-span-2" />
            <button type="button" onClick={() => setMoreParent((v) => !v)} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary sm:col-span-2">
              <ChevronDown className={clsx('size-4 transition', moreParent && 'rotate-180')} aria-hidden /> {moreParent ? 'Fewer details' : 'Alternate phone, email, notes'}
            </button>
            {moreParent && (
              <>
                <Field label="Alternate phone (optional)" type="tel" inputMode="tel" value={parent.alt_phone} maxLength={16} onChange={(e) => setParent((p) => ({ ...p, alt_phone: e.target.value }))} error={phoneProblem(parent.alt_phone, locale.countryCode) ?? fieldError(err, 'parent.alt_phone')} />
                <Field label="Email (optional)" type="email" value={parent.email} onChange={(e) => setParent((p) => ({ ...p, email: e.target.value }))} />
                <TextAreaField label="Notes (optional)" rows={2} value={parent.notes} onChange={(e) => setParent((p) => ({ ...p, notes: e.target.value }))} className="sm:col-span-2" />
              </>
            )}
          </div>
        )}
      </Card>

      {children.map((child, i) => (
        <Card key={child.key} className="mb-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{children.length > 1 ? `Child ${i + 1}` : 'Child'}</h2>
            {children.length > 1 && (
              <Button type="button" variant="ghost" className="min-h-9 px-2 text-danger" onClick={() => setChildren((list) => list.filter((c) => c.key !== child.key))} aria-label={`Remove child ${i + 1}`}>
                <X className="size-4" aria-hidden /> Remove
              </Button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`${labels.student} name`} autoComplete="off" value={child.name} onChange={(e) => updateChild(child.key, { name: e.target.value })} error={childErr(i, 'name')} className="sm:col-span-2" />
            <Field label={`${labels.class} (optional)`} value={child.class} onChange={(e) => updateChild(child.key, { class: e.target.value })} error={childErr(i, 'class')} />
            <CustomFieldInputs
              entity="Student"
              values={child.extra}
              onChange={(key, value) => updateChild(child.key, { extra: { ...child.extra, [key]: value } })}
              errorFor={(key) => childErr(i, `extra.${key}`)}
            />
            <Field label="Date of birth (optional)" type="date" value={child.dob} onChange={(e) => updateChild(child.key, { dob: e.target.value })} error={childErr(i, 'dob')} />
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-muted">{labels.courses}</h3>
          {courseGroups.length === 0 ? (
            <p className="text-sm text-muted">No active {labels.courses.toLowerCase()}. Add some in the {labels.course.toLowerCase()} master first.</p>
          ) : (
            <div className="space-y-3">
              {courseGroups.map(({ category, courses }) => (
                <div key={category.id}>
                  <p className="mb-1.5 text-xs font-medium text-muted">{category.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {courses.map((course) => {
                      const on = child.enrollments.some((e) => e.course_id === course.id);
                      return (
                        <button
                          key={course.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleCourse(child, course)}
                          className={clsx(
                            'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition',
                            on ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink hover:border-primary',
                          )}
                        >
                          {on && <Check className="size-4 text-accent" aria-hidden />}
                          {course.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {child.enrollments.length > 0 && (
            <div className="mt-4 space-y-3">
              {child.enrollments.map((en, j) => {
                const course = coursesById.get(en.course_id);
                if (!course) return null;
                return (
                  <div key={en.course_id} className="rounded-xl border border-line bg-canvas p-3">
                    <p className="mb-2 text-sm font-semibold text-primary">{course.name}</p>
                    <EnrollmentOptions
                      draft={en}
                      course={course}
                      onChange={(patch) => updateChild(child.key, { enrollments: child.enrollments.map((x, k) => (k === j ? { ...x, ...patch } : x)) })}
                      errorFor={(field) => childErr(i, `enrollments.${j}.${field}`)}
                    />
                    {childErr(i, `enrollments.${j}.course_id`) && <p className="mt-1 text-xs text-danger">{childErr(i, `enrollments.${j}.course_id`)}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {admissionItems.length > 0 && (
            <div className="mt-4 space-y-2">
              {admissionItems.map((item) => {
                const ch = chargeOf(child, item);
                const k = chosenCharges(child).findIndex((x) => x.item.id === item.id);
                const setCharge = (patch: Partial<typeof ch>) => updateChild(child.key, { charges: { ...child.charges, [item.id]: { ...ch, ...patch } } });
                return (
                  <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2">
                    <label className="flex min-h-10 flex-1 items-center gap-3">
                      <input type="checkbox" checked={ch.on} onChange={(e) => setCharge({ on: e.target.checked })} className="size-5 accent-[var(--tenant-primary)]" />
                      <span className="text-sm font-medium">{item.name}</span>
                    </label>
                    {ch.on && (
                      <div className="w-32">
                        <Field label={`${item.name} amount`} className="[&>span:first-child]:sr-only" inputMode="numeric" value={ch.amount}
                          onChange={(e) => setCharge({ amount: e.target.value.replace(/[^\d]/g, '') })} error={k >= 0 ? childErr(i, `charges.${k}.amount`) : undefined} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ))}

      <Button type="button" variant="secondary" className="mb-4 w-full sm:w-auto" onClick={() => setChildren((list) => [...list, emptyChild()])}>
        <Plus className="size-4" aria-hidden /> Add sibling
      </Button>

      {err && !shownInline && (
        <div className="mb-4">
          <Alert>
            {errorMessage(err)}
            {conflictParentId && t.Parents.some((p) => p.id === conflictParentId) && (
              <Button type="button" variant="secondary" className="ml-2 mt-2" onClick={() => chooseParent(t.Parents.find((p) => p.id === conflictParentId)!)}>
                Add child to existing family
              </Button>
            )}
          </Alert>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface px-4 py-3 lg:static lg:mt-2 lg:rounded-2xl lg:border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">
              {children.length} {children.length === 1 ? 'child' : 'children'} · {totals.courses} {totals.courses === 1 ? labels.course.toLowerCase() : labels.courses.toLowerCase()}
            </p>
            {(totals.courses > 0 || totals.firstBill > 0) && (
              <p className="text-xs text-muted">
                First bill {formatMoney(totals.firstBill, locale.currencySymbol)}
                {totals.unpriced > 0 && <span className="text-warning"> · {totals.unpriced} without a fee</span>}
              </p>
            )}
            {totals.firstBill > 0 && (
              <label className="mt-1 inline-flex items-center gap-2 text-xs">
                <input type="checkbox" checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} className="size-4 accent-[var(--tenant-primary)]" />
                Collect payment after saving
              </label>
            )}
          </div>
          <Button type="submit" loading={create.isPending}>
            <UserPlus className="size-4" aria-hidden /> Save admission
          </Button>
        </div>
      </div>
    </form>
  );
}

function ExistingParent({ parent, onChange }: { parent: Parent; onChange: () => void }) {
  const { locale } = useTenant();
  const labels = useLabels();
  const { data } = useCoreData();
  const kids = (data?.tables.Students ?? []).filter((s) => s.parent_id === parent.id);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-soft p-3">
      <div>
        <p className="font-medium">{parent.guardian_name}</p>
        <p className="text-sm text-muted">{formatPhone(parent.phone, locale.countryCode)}</p>
        {kids.length > 0 && <p className="mt-1 text-xs text-muted">Existing {labels.students.toLowerCase()}: {kids.map((k) => k.name).join(', ')}</p>}
      </div>
      <Button type="button" variant="ghost" onClick={onChange}>Change</Button>
    </div>
  );
}
