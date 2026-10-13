import clsx from 'clsx';
import { ChevronRight, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Card, EmptyState, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import type { Category, ChargeItem, Course, FeePlan } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { describePlanAmount, formatMoney, monthlyFeeFor } from '../../lib/fees';
import { bool, num } from '../../lib/values';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { bySortOrder } from './catalogHooks';
import { CategorySheet, ChargeSheet, CourseSheet, FeePlanSheet } from './CatalogSheets';

type TabKey = 'courses' | 'plans' | 'charges';

export function CourseMasterPage() {
  const labels = useLabels();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) || 'courses';
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'courses', label: labels.courses },
    { key: 'plans', label: 'Fee plans' },
    { key: 'charges', label: 'One-time charges' },
  ];

  return (
    <>
      <PageHeader title={`${labels.course} master`} subtitle={`${labels.courses}, fees, ${labels.batch.toLowerCase()}es and fee plans`} />
      <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams(t.key === 'courses' ? {} : { tab: t.key }, { replace: true })}
            className={clsx('min-h-10 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition', tab === t.key ? 'bg-primary text-white' : 'text-muted hover:text-primary')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'courses' && <CoursesTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'charges' && <ChargesTab />}
    </>
  );
}

function CoursesTab() {
  const labels = useLabels();
  const { locale } = useTenant();
  const { data, isPending } = useCoreData();
  const [category, setCategory] = useState<Category | 'new' | null>(null);
  const [course, setCourse] = useState<{ course: Course | 'new'; categoryId?: string } | null>(null);

  const groups = useMemo(() => {
    if (!data) return [];
    const t = data.tables;
    const active = new Set(t.Students.filter((s) => s.status === 'Active').map((s) => s.id));
    const enrolled = (courseId: string) => t.Enrollments.filter((e) => e.course_id === courseId && e.status === 'Active' && active.has(e.student_id)).length;
    return [...t.Categories].sort(bySortOrder).map((cat) => ({
      category: cat,
      courses: t.Courses.filter((c) => c.category_id === cat.id).sort(bySortOrder).map((c) => ({
        course: c,
        students: enrolled(c.id),
        batches: t.Batches.filter((b) => b.course_id === c.id && bool(b.active)).length,
      })),
    }));
  }, [data]);

  if (isPending) return <Spinner />;
  const missingFees = groups.flatMap((g) => g.courses).filter((c) => bool(c.course.active) && monthlyFeeFor(c.course) === null).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {missingFees > 0 ? (
          <p className="text-sm text-warning">{missingFees} active {labels.courses.toLowerCase()} have no fee set yet.</p>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCategory('new')}>
            <Plus className="size-4" aria-hidden /> Category
          </Button>
          <Button onClick={() => setCourse({ course: 'new' })} disabled={groups.length === 0}>
            <Plus className="size-4" aria-hidden /> {labels.course}
          </Button>
        </div>
      </div>

      {groups.length === 0 && (
        <Card>
          <EmptyState title="No categories yet">Create a category first (e.g. “Martial Arts”), or load the starter setup from Settings.</EmptyState>
        </Card>
      )}

      <div className="space-y-5">
        {groups.map(({ category: cat, courses }) => (
          <Card key={cat.id} className="p-0 sm:p-0">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="text-lg font-semibold">{cat.name}</h2>
              <div className="flex gap-1">
                <Button variant="ghost" className="min-h-9 px-2" onClick={() => setCategory(cat)} aria-label={`Edit category ${cat.name}`}>
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <Button variant="ghost" className="min-h-9 px-2" onClick={() => setCourse({ course: 'new', categoryId: cat.id })} aria-label={`Add ${labels.course} to ${cat.name}`}>
                  <Plus className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            {courses.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">No {labels.courses.toLowerCase()} in this category.</p>
            ) : (
              <ul className="divide-y divide-line">
                {courses.map(({ course: c, students, batches }) => {
                  const fee = monthlyFeeFor(c);
                  return (
                    <li key={c.id}>
                      <button type="button" onClick={() => setCourse({ course: c })} className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left hover:bg-primary-soft">
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-medium">{c.name}</span>
                            {!bool(c.active) && <StatusBadge status="Inactive" />}
                          </span>
                          <span className="block text-xs text-muted">
                            {[
                              num(c.classes_per_week) ? `${c.classes_per_week} classes/week` : '',
                              batches ? `${batches} ${labels.batch.toLowerCase()}${batches > 1 ? 'es' : ''}` : '',
                              `${students} active ${students === 1 ? labels.student.toLowerCase() : labels.students.toLowerCase()}`,
                            ].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className={clsx('text-right text-sm font-semibold tabular-nums', fee === null ? 'text-warning' : 'text-primary')}>
                          {fee === null ? 'Set fee' : `${formatMoney(fee, locale.currencySymbol)}/mo`}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))}
      </div>

      {category && <CategorySheet key={category === 'new' ? 'new' : category.id} category={category} onClose={() => setCategory(null)} />}
      {course && (
        <CourseSheet
          key={course.course === 'new' ? `new-${course.categoryId ?? ''}` : course.course.id}
          course={course.course}
          defaultCategoryId={course.categoryId}
          onClose={() => setCourse(null)}
        />
      )}
    </>
  );
}

function PlansTab() {
  const { locale } = useTenant();
  const { data, isPending } = useCoreData();
  const [plan, setPlan] = useState<FeePlan | 'new' | null>(null);
  if (isPending) return <Spinner />;
  const plans = [...(data?.tables.FeePlans ?? [])].sort(bySortOrder);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setPlan('new')}><Plus className="size-4" aria-hidden /> Fee plan</Button>
      </div>
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-line">
          {plans.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setPlan(p)} className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left hover:bg-primary-soft">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {!bool(p.active) && <StatusBadge status="Inactive" />}
                  </span>
                  <span className="block text-xs text-muted">
                    {num(p.months_covered, 1)} month{num(p.months_covered, 1) > 1 ? 's' : ''} per payment
                    {num(p.discount_pct) > 0 ? ` · ${num(p.discount_pct)}% off` : ''} · e.g. {locale.currencySymbol}1,000/mo course → {describePlanAmount(1000, p, locale.currencySymbol)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {plan && <FeePlanSheet key={plan === 'new' ? 'new' : plan.id} plan={plan} onClose={() => setPlan(null)} />}
    </>
  );
}

function ChargesTab() {
  const { locale } = useTenant();
  const { data, isPending } = useCoreData();
  const [charge, setCharge] = useState<ChargeItem | 'new' | null>(null);
  if (isPending) return <Spinner />;
  const charges = [...(data?.tables.ChargeItems ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const when = { Admission: 'At admission', Course: 'Per course', Any: 'Any time' } as const;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Admission fee, uniforms, kits, exam or grading fees. They are billed in phase 3.</p>
        <Button onClick={() => setCharge('new')}><Plus className="size-4" aria-hidden /> Charge</Button>
      </div>
      <Card className="p-0 sm:p-0">
        {charges.length === 0 ? (
          <EmptyState title="No one-time charges" />
        ) : (
          <ul className="divide-y divide-line">
            {charges.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setCharge(c)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-primary-soft">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {!bool(c.active) && <StatusBadge status="Inactive" />}
                    </span>
                    <span className="block text-xs text-muted">{when[c.applies_to] ?? c.applies_to}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-primary">
                    {c.default_amount === '' ? 'Amount varies' : formatMoney(num(c.default_amount), locale.currencySymbol)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {charge && <ChargeSheet key={charge === 'new' ? 'new' : charge.id} charge={charge} onClose={() => setCharge(null)} />}
    </>
  );
}
