import { useMemo } from 'react';
import { Field, SelectField } from '../../components/ui';
import type { Course, FeePlan } from '../../data/types';
import { useCoreTables } from '../../data/useCoreData';
import { todayIso } from '../../lib/dates';
import { describePlanAmount, monthlyFeeFor } from '../../lib/fees';
import { bool, num } from '../../lib/values';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { bySortOrder } from '../courses/catalogHooks';

export interface EnrollmentDraft {
  course_id: string;
  fee_plan_id: string;
  batch_id: string;
  start_date: string;
  monthly_fee_override: string;
}

export { todayIso };

export function useActivePlans(): FeePlan[] {
  const tables = useCoreTables();
  return useMemo(() => (tables?.FeePlans ?? []).filter((p) => bool(p.active)).sort(bySortOrder), [tables]);
}

export function newEnrollmentDraft(courseId: string, plans: FeePlan[]): EnrollmentDraft {
  return { course_id: courseId, fee_plan_id: plans[0]?.id ?? '', batch_id: '', start_date: todayIso(), monthly_fee_override: '' };
}

/** Plan, batch, start date and optional custom fee for one enrolment, with a live fee preview. */
export function EnrollmentOptions({
  draft,
  course,
  onChange,
  errorFor,
}: {
  draft: EnrollmentDraft;
  course: Course;
  onChange: (patch: Partial<EnrollmentDraft>) => void;
  errorFor?: (field: keyof EnrollmentDraft) => string | undefined;
}) {
  const tables = useCoreTables();
  const labels = useLabels();
  const { locale } = useTenant();
  const plans = useActivePlans();
  const batches = (tables?.Batches ?? []).filter((b) => b.course_id === course.id && bool(b.active)).sort((a, b) => a.name.localeCompare(b.name));
  const plan = plans.find((p) => p.id === draft.fee_plan_id);
  const fee = monthlyFeeFor(course, { monthly_fee_override: draft.monthly_fee_override === '' ? '' : num(draft.monthly_fee_override) });

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <SelectField label="Fee plan" value={draft.fee_plan_id} onChange={(e) => onChange({ fee_plan_id: e.target.value })} error={errorFor?.('fee_plan_id')}>
        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </SelectField>
      <Field label="Start date" type="date" value={draft.start_date} onChange={(e) => onChange({ start_date: e.target.value })} error={errorFor?.('start_date')} />
      {batches.length > 0 && (
        <SelectField label={labels.batch} value={draft.batch_id} onChange={(e) => onChange({ batch_id: e.target.value })} error={errorFor?.('batch_id')}>
          <option value="">Any / not decided</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </SelectField>
      )}
      <Field
        label="Custom monthly fee"
        inputMode="numeric"
        placeholder={course.monthly_fee === '' ? 'Not set' : String(course.monthly_fee)}
        value={draft.monthly_fee_override}
        onChange={(e) => onChange({ monthly_fee_override: e.target.value.replace(/[^\d.]/g, '') })}
        error={errorFor?.('monthly_fee_override')}
      />
      <p className="col-span-2 text-xs text-muted sm:col-span-4">
        {fee === null ? (
          <span className="text-warning">No fee set for {course.name} yet. Set it in the {labels.course.toLowerCase()} master or enter a custom fee.</span>
        ) : (
          <>Billed: <span className="font-medium text-ink">{describePlanAmount(fee, plan, locale.currencySymbol)}</span></>
        )}
      </p>
    </div>
  );
}
