import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/errors';
import { fieldError } from '../../api/fieldErrors';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Alert, Button, Field, SelectField, StatusBadge, TextAreaField, Toggle } from '../../components/ui';
import type { Batch, Category, ChargeItem, Course, FeePlan } from '../../data/types';
import { useCoreTables } from '../../data/useCoreData';
import { describePlanAmount } from '../../lib/fees';
import { bool, num } from '../../lib/values';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { useCatalogDelete, useCatalogSave, type CatalogTab } from './catalogHooks';

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function SheetFooter({ saving, onDelete, deleting, formId }: { saving: boolean; onDelete?: () => void; deleting?: boolean; formId: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      {onDelete ? (
        <Button type="button" variant="ghost" className="text-danger" loading={deleting} onClick={onDelete}>
          <Trash2 className="size-4" aria-hidden /> Delete
        </Button>
      ) : (
        <span />
      )}
      <Button type="submit" form={formId} loading={saving}>Save</Button>
    </div>
  );
}

/** Shared save/delete plumbing for every catalogue sheet. */
function useCatalogForm(tab: CatalogTab, onDone: () => void, label: string) {
  const save = useCatalogSave();
  const del = useCatalogDelete();
  const toast = useToast();

  function submit(row: Record<string, unknown>) {
    save.mutate({ tab, row }, { onSuccess: () => { toast(`${label} saved`); onDone(); } });
  }

  function remove(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone from the app.`)) return;
    del.mutate({ tab, id }, { onSuccess: () => { toast(`${label} deleted`); onDone(); } });
  }

  const error = save.error ?? del.error;
  return { submit, remove, saving: save.isPending, deleting: del.isPending, error };
}

// ---------- Category ----------

export function CategorySheet({ category, onClose }: { category: Category | null | 'new'; onClose: () => void }) {
  const existing = category && category !== 'new' ? category : null;
  const [name, setName] = useState(existing?.name ?? '');
  const form = useCatalogForm('Categories', onClose, 'Category');

  return (
    <Sheet
      open={category !== null}
      title={existing ? 'Edit category' : 'New category'}
      onClose={onClose}
      footer={<SheetFooter formId="category-form" saving={form.saving} deleting={form.deleting} onDelete={existing ? () => form.remove(existing.id, existing.name) : undefined} />}
    >
      <form id="category-form" onSubmit={(e: FormEvent) => { e.preventDefault(); form.submit({ id: existing?.id, name }); }} className="space-y-4">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Martial Arts" error={fieldError(form.error, 'name')} />
        {form.error && !fieldError(form.error, 'name') && <Alert>{errorMessage(form.error)}</Alert>}
      </form>
    </Sheet>
  );
}

// ---------- Course (with batches) ----------

export function CourseSheet({ course, defaultCategoryId, onClose }: { course: Course | null | 'new'; defaultCategoryId?: string; onClose: () => void }) {
  const tables = useCoreTables();
  const labels = useLabels();
  const existing = course && course !== 'new' ? course : null;
  const [values, setValues] = useState({
    name: existing?.name ?? '',
    category_id: existing?.category_id ?? defaultCategoryId ?? '',
    monthly_fee: str(existing?.monthly_fee),
    classes_per_week: str(existing?.classes_per_week),
    description: existing?.description ?? '',
    active: existing ? bool(existing.active) : true,
  });
  const form = useCatalogForm('Courses', onClose, labels.course);
  const set = (k: keyof typeof values) => (v: string | boolean) => setValues((s) => ({ ...s, [k]: v }));
  const categories = [...(tables?.Categories ?? [])].sort((a, b) => num(a.sort_order) - num(b.sort_order));
  const feeErr = fieldError(form.error, 'monthly_fee');
  const knownField = ['name', 'category_id', 'monthly_fee', 'classes_per_week'].some((f) => fieldError(form.error, f));

  return (
    <Sheet
      open={course !== null}
      title={existing ? `Edit ${labels.course.toLowerCase()}` : `New ${labels.course.toLowerCase()}`}
      onClose={onClose}
      wide={!!existing}
      footer={<SheetFooter formId="course-form" saving={form.saving} deleting={form.deleting} onDelete={existing ? () => form.remove(existing.id, existing.name) : undefined} />}
    >
      <form
        id="course-form"
        onSubmit={(e) => {
          e.preventDefault();
          form.submit({ id: existing?.id, ...values });
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="Name" value={values.name} onChange={(e) => set('name')(e.target.value)} error={fieldError(form.error, 'name')} className="sm:col-span-2" />
        <SelectField label="Category" value={values.category_id} onChange={(e) => set('category_id')(e.target.value)} error={fieldError(form.error, 'category_id')}>
          <option value="">Choose…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <Field
          label="Monthly fee (₹)"
          inputMode="numeric"
          value={values.monthly_fee}
          onChange={(e) => set('monthly_fee')(e.target.value.replace(/[^\d.]/g, ''))}
          error={feeErr}
          hint={values.monthly_fee === '' ? 'Leave blank until the fee is decided' : undefined}
        />
        <Field label="Classes per week" inputMode="numeric" value={values.classes_per_week} onChange={(e) => set('classes_per_week')(e.target.value.replace(/\D/g, ''))} error={fieldError(form.error, 'classes_per_week')} />
        <div className="flex items-end">
          <Toggle checked={values.active} onChange={set('active')} label={values.active ? 'Active: open for admissions' : 'Inactive: hidden from admissions'} />
        </div>
        <TextAreaField label="Description (optional)" value={values.description} onChange={(e) => set('description')(e.target.value)} className="sm:col-span-2" rows={2} />
        {form.error && !knownField && <div className="sm:col-span-2"><Alert>{errorMessage(form.error)}</Alert></div>}
      </form>

      {existing && <BatchList course={existing} />}
    </Sheet>
  );
}

function BatchList({ course }: { course: Course }) {
  const tables = useCoreTables();
  const labels = useLabels();
  const batches = (tables?.Batches ?? []).filter((b) => b.course_id === course.id).sort((a, b) => a.name.localeCompare(b.name));
  const [editing, setEditing] = useState<Batch | 'new' | null>(null);

  return (
    <section className="mt-6 border-t border-line pt-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold">{labels.batch}es</h3>
        <Button type="button" variant="secondary" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden /> Add {labels.batch.toLowerCase()}
        </Button>
      </div>
      {batches.length === 0 ? (
        <p className="text-sm text-muted">Optional. Add {labels.batch.toLowerCase()}es like “Mon/Wed 5pm” to split attendance rosters.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {batches.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => setEditing(b)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left hover:bg-primary-soft">
                <span>
                  <span className="block text-sm font-medium">{b.name}</span>
                  {b.schedule_note && <span className="block text-xs text-muted">{b.schedule_note}</span>}
                </span>
                {!bool(b.active) && <StatusBadge status="Inactive" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <BatchSheet key={editing === 'new' ? 'new' : editing.id} batch={editing} courseId={course.id} onClose={() => setEditing(null)} />}
    </section>
  );
}

function BatchSheet({ batch, courseId, onClose }: { batch: Batch | 'new'; courseId: string; onClose: () => void }) {
  const labels = useLabels();
  const existing = batch !== 'new' ? batch : null;
  const [values, setValues] = useState({
    name: existing?.name ?? '',
    schedule_note: existing?.schedule_note ?? '',
    capacity: str(existing?.capacity),
    active: existing ? bool(existing.active) : true,
  });
  const form = useCatalogForm('Batches', onClose, labels.batch);

  return (
    <Sheet
      open
      title={existing ? `Edit ${labels.batch.toLowerCase()}` : `New ${labels.batch.toLowerCase()}`}
      onClose={onClose}
      footer={<SheetFooter formId="batch-form" saving={form.saving} deleting={form.deleting} onDelete={existing ? () => form.remove(existing.id, existing.name) : undefined} />}
    >
      <form id="batch-form" onSubmit={(e) => { e.preventDefault(); form.submit({ id: existing?.id, course_id: courseId, ...values }); }} className="space-y-4">
        <Field label="Name" placeholder="e.g. Evening batch" value={values.name} onChange={(e) => setValues((s) => ({ ...s, name: e.target.value }))} error={fieldError(form.error, 'name')} />
        <Field label="Schedule (optional)" placeholder="e.g. Mon/Wed/Fri 5–6pm" value={values.schedule_note} onChange={(e) => setValues((s) => ({ ...s, schedule_note: e.target.value }))} />
        <Field label="Capacity (optional)" inputMode="numeric" value={values.capacity} onChange={(e) => setValues((s) => ({ ...s, capacity: e.target.value.replace(/\D/g, '') }))} error={fieldError(form.error, 'capacity')} />
        <Toggle checked={values.active} onChange={(v) => setValues((s) => ({ ...s, active: v }))} label={values.active ? 'Active' : 'Inactive'} />
        {form.error && !fieldError(form.error, 'name') && !fieldError(form.error, 'capacity') && <Alert>{errorMessage(form.error)}</Alert>}
      </form>
    </Sheet>
  );
}

// ---------- Fee plan ----------

const FREQUENCIES: { value: FeePlan['frequency']; label: string; months: number }[] = [
  { value: 'Monthly', label: 'Monthly', months: 1 },
  { value: 'Quarterly', label: 'Quarterly', months: 3 },
  { value: 'HalfYearly', label: 'Half-yearly', months: 6 },
  { value: 'Annual', label: 'Annual', months: 10 },
];

export function FeePlanSheet({ plan, onClose }: { plan: FeePlan | null | 'new'; onClose: () => void }) {
  const { locale } = useTenant();
  const existing = plan && plan !== 'new' ? plan : null;
  const [values, setValues] = useState({
    name: existing?.name ?? '',
    frequency: existing?.frequency ?? 'Monthly',
    months_covered: str(existing?.months_covered ?? 1),
    discount_pct: str(existing?.discount_pct ?? 0),
    active: existing ? bool(existing.active) : true,
  });
  const form = useCatalogForm('FeePlans', onClose, 'Fee plan');
  const example = describePlanAmount(1000, { ...values, months_covered: num(values.months_covered, 1), discount_pct: num(values.discount_pct) } as FeePlan, locale.currencySymbol);
  const knownField = ['name', 'frequency', 'months_covered', 'discount_pct', 'active'].some((f) => fieldError(form.error, f));

  return (
    <Sheet
      open={plan !== null}
      title={existing ? 'Edit fee plan' : 'New fee plan'}
      onClose={onClose}
      footer={<SheetFooter formId="plan-form" saving={form.saving} deleting={form.deleting} onDelete={existing ? () => form.remove(existing.id, existing.name) : undefined} />}
    >
      <form id="plan-form" onSubmit={(e) => { e.preventDefault(); form.submit({ id: existing?.id, ...values }); }} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" placeholder="e.g. Annual (10 months)" value={values.name} onChange={(e) => setValues((s) => ({ ...s, name: e.target.value }))} error={fieldError(form.error, 'name')} className="sm:col-span-2" />
        <SelectField
          label="Billed"
          value={values.frequency}
          onChange={(e) => {
            const f = FREQUENCIES.find((x) => x.value === e.target.value)!;
            setValues((s) => ({ ...s, frequency: f.value, months_covered: existing ? s.months_covered : String(f.months) }));
          }}
        >
          {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </SelectField>
        <Field label="Months covered per payment" inputMode="numeric" value={values.months_covered} onChange={(e) => setValues((s) => ({ ...s, months_covered: e.target.value.replace(/\D/g, '') }))} error={fieldError(form.error, 'months_covered')} />
        <Field label="Discount %" inputMode="decimal" value={values.discount_pct} onChange={(e) => setValues((s) => ({ ...s, discount_pct: e.target.value.replace(/[^\d.]/g, '') }))} error={fieldError(form.error, 'discount_pct')} />
        <div className="flex items-end">
          <Toggle checked={values.active} onChange={(v) => setValues((s) => ({ ...s, active: v }))} label={values.active ? 'Active' : 'Inactive'} />
        </div>
        <div className="sm:col-span-2">
          <Alert tone="info">Example: a {locale.currencySymbol}1,000/month course on this plan is billed {example}.</Alert>
        </div>
        {fieldError(form.error, 'active') && <div className="sm:col-span-2"><Alert>{fieldError(form.error, 'active')}</Alert></div>}
        {form.error && !knownField && <div className="sm:col-span-2"><Alert>{errorMessage(form.error)}</Alert></div>}
      </form>
    </Sheet>
  );
}

// ---------- One-time charge ----------

export function ChargeSheet({ charge, onClose }: { charge: ChargeItem | null | 'new'; onClose: () => void }) {
  const existing = charge && charge !== 'new' ? charge : null;
  const [values, setValues] = useState({
    name: existing?.name ?? '',
    default_amount: str(existing?.default_amount),
    applies_to: existing?.applies_to ?? 'Any',
    active: existing ? bool(existing.active) : true,
  });
  const form = useCatalogForm('ChargeItems', onClose, 'Charge');

  return (
    <Sheet
      open={charge !== null}
      title={existing ? 'Edit one-time charge' : 'New one-time charge'}
      onClose={onClose}
      footer={<SheetFooter formId="charge-form" saving={form.saving} deleting={form.deleting} onDelete={existing ? () => form.remove(existing.id, existing.name) : undefined} />}
    >
      <form id="charge-form" onSubmit={(e) => { e.preventDefault(); form.submit({ id: existing?.id, ...values }); }} className="space-y-4">
        <Field label="Name" placeholder="e.g. Admission fee, Uniform, Belt grading" value={values.name} onChange={(e) => setValues((s) => ({ ...s, name: e.target.value }))} error={fieldError(form.error, 'name')} />
        <Field label="Default amount (₹)" inputMode="numeric" value={values.default_amount} onChange={(e) => setValues((s) => ({ ...s, default_amount: e.target.value.replace(/[^\d.]/g, '') }))} error={fieldError(form.error, 'default_amount')} hint="Can be changed each time it is charged" />
        <SelectField label="Typically charged" value={values.applies_to} onChange={(e) => setValues((s) => ({ ...s, applies_to: e.target.value as ChargeItem['applies_to'] }))}>
          <option value="Admission">At admission</option>
          <option value="Course">For a specific course</option>
          <option value="Any">Any time</option>
        </SelectField>
        <Toggle checked={values.active} onChange={(v) => setValues((s) => ({ ...s, active: v }))} label={values.active ? 'Active' : 'Inactive'} />
        {form.error && !fieldError(form.error, 'name') && !fieldError(form.error, 'default_amount') && <Alert>{errorMessage(form.error)}</Alert>}
      </form>
    </Sheet>
  );
}
