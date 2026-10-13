import clsx from 'clsx';
import { Check, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/errors';
import { errorField, fieldError } from '../../api/fieldErrors';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Alert, Button, Field, SelectField, TextAreaField } from '../../components/ui';
import { ENQUIRY_SOURCES, ENQUIRY_STATUSES, type Enquiry, type EnquiryStatus } from '../../data/types';
import { useCoreTables } from '../../data/useCoreData';
import { useWrite } from '../../data/useWrite';
import { addDaysIso, todayIso } from '../../lib/dates';
import { bool, isDeleted } from '../../lib/values';
import { phoneProblem } from '../../lib/phone';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { bySortOrder } from '../courses/catalogHooks';

const INLINE = ['name', 'phone', 'source', 'enquiry_date', 'next_followup_date', 'trial_date', 'status', 'lost_reason', 'notes'];
const FOLLOW_UP_IN = [1, 3, 7];

/** Quick add on a phone in a few taps; the same sheet updates status, follow-up and notes later. */
export function EnquirySheet({ enquiry, onClose }: { enquiry: Enquiry | null; onClose: () => void }) {
  const t = useCoreTables();
  const labels = useLabels();
  const { locale } = useTenant();
  const toast = useToast();
  const save = useWrite('enquiries.save');
  const remove = useWrite('enquiries.delete');
  const today = todayIso();
  const [v, setV] = useState({
    name: enquiry?.name ?? '',
    phone: enquiry?.phone ?? '',
    courses: (enquiry?.course_interested ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    source: enquiry?.source ?? 'Walk-in',
    enquiry_date: enquiry?.enquiry_date ?? today,
    next_followup_date: enquiry ? enquiry.next_followup_date : addDaysIso(today, 1),
    trial_date: enquiry?.trial_date ?? '',
    status: (enquiry?.status ?? 'New') as EnquiryStatus,
    lost_reason: enquiry?.lost_reason ?? '',
    notes: enquiry?.notes ?? '',
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));
  const courses = (t?.Courses ?? []).filter((c) => bool(c.active) && !isDeleted(c)).sort(bySortOrder);
  const closed = v.status === 'Converted' || v.status === 'Lost';
  const err = save.error ?? remove.error;
  const field = errorField(err);

  function submit(e: FormEvent) {
    e.preventDefault();
    const { courses: ids, ...rest } = v;
    save.mutate({ row: { id: enquiry?.id, ...rest, course_interested: ids.join(',') } }, {
      onSuccess: () => { toast(enquiry ? 'Enquiry updated' : 'Enquiry added'); onClose(); },
    });
  }

  function del() {
    if (!enquiry || !window.confirm(`Delete the enquiry from ${enquiry.name}?`)) return;
    remove.mutate({ id: enquiry.id }, { onSuccess: () => { toast('Enquiry deleted'); onClose(); } });
  }

  const statuses = ENQUIRY_STATUSES.filter((s) => s !== 'Converted' || enquiry?.status === 'Converted');

  return (
    <Sheet
      open
      title={enquiry ? enquiry.name : 'New enquiry'}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          {enquiry ? (
            <Button type="button" variant="ghost" className="text-danger" loading={remove.isPending} onClick={del}><Trash2 className="size-4" aria-hidden /> Delete</Button>
          ) : <span />}
          <Button type="submit" form="enquiry-form" loading={save.isPending}>Save</Button>
        </div>
      }
    >
      <form id="enquiry-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={`${labels.student} name`} value={v.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" error={fieldError(err, 'name')} />
        <Field label="Phone" type="tel" inputMode="tel" placeholder="98765 43210" maxLength={16} value={v.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="off" error={phoneProblem(v.phone, locale.countryCode) ?? fieldError(err, 'phone')} />

        {courses.length > 0 && (
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium">Interested in</p>
            <div className="flex flex-wrap gap-2">
              {courses.map((c) => {
                const on = v.courses.includes(c.id);
                return (
                  <button key={c.id} type="button" aria-pressed={on}
                    onClick={() => set('courses', on ? v.courses.filter((x) => x !== c.id) : [...v.courses, c.id])}
                    className={clsx('inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium', on ? 'border-primary bg-primary text-white' : 'border-line bg-surface hover:border-primary')}>
                    {on && <Check className="size-4 text-accent" aria-hidden />}{c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <SelectField label="Source" value={v.source} onChange={(e) => set('source', e.target.value as Enquiry['source'])} error={fieldError(err, 'source')}>
          {ENQUIRY_SOURCES.map((s) => <option key={s}>{s}</option>)}
        </SelectField>
        {enquiry ? (
          <SelectField label="Status" value={v.status} onChange={(e) => set('status', e.target.value as EnquiryStatus)} error={fieldError(err, 'status')}>
            {statuses.map((s) => <option key={s}>{s}</option>)}
          </SelectField>
        ) : (
          <Field label="Enquiry date" type="date" value={v.enquiry_date} max={today} onChange={(e) => set('enquiry_date', e.target.value)} error={fieldError(err, 'enquiry_date')} />
        )}

        {v.status === 'Lost' && (
          <Field label="Why was it lost?" className="sm:col-span-2" placeholder="e.g. Fees too high, joined elsewhere" value={v.lost_reason} onChange={(e) => set('lost_reason', e.target.value)} error={fieldError(err, 'lost_reason')} />
        )}

        {!closed && (
          <>
            <div>
              <Field label="Next follow-up" type="date" value={v.next_followup_date} onChange={(e) => set('next_followup_date', e.target.value)} error={fieldError(err, 'next_followup_date')} />
              <div className="mt-1.5 flex gap-1.5">
                {FOLLOW_UP_IN.map((d) => (
                  <button key={d} type="button" onClick={() => set('next_followup_date', addDaysIso(today, d))}
                    className="min-h-8 rounded-lg border border-line px-2 text-xs font-medium text-muted hover:border-primary hover:text-primary">
                    {d === 1 ? 'Tomorrow' : `In ${d} days`}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Trial class (optional)" type="date" value={v.trial_date} onChange={(e) => set('trial_date', e.target.value)} error={fieldError(err, 'trial_date')} />
          </>
        )}

        <TextAreaField label="Notes (optional)" className="sm:col-span-2" rows={3} value={v.notes} onChange={(e) => set('notes', e.target.value)} error={fieldError(err, 'notes')} />
        {err && (!field || !INLINE.includes(field)) && <div className="sm:col-span-2"><Alert>{errorMessage(err)}</Alert></div>}
      </form>
    </Sheet>
  );
}
