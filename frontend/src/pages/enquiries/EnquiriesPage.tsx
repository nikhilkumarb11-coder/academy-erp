import clsx from 'clsx';
import { MessageCircle, Phone, Plus, Search, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ExportButton } from '../../components/ExportButton';
import { EmptyState, PageHeader, Spinner, StatusBadge, Button, Card } from '../../components/ui';
import type { Enquiry } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { formatDate, todayIso } from '../../lib/dates';
import { courseNames, isOpenEnquiry, needsFollowUp } from '../../lib/enquiries';
import { formatPhone } from '../../lib/phone';
import { isDeleted } from '../../lib/values';
import { whatsappUrl } from '../../lib/whatsapp';
import { useTenant } from '../../tenant/TenantContext';
import { EnquirySheet } from './EnquirySheet';

type View = 'followup' | 'open' | 'converted' | 'lost' | 'all';
const VIEWS: { key: View; label: string }[] = [
  { key: 'followup', label: 'Follow up today' },
  { key: 'open', label: 'Open' },
  { key: 'converted', label: 'Converted' },
  { key: 'lost', label: 'Lost' },
  { key: 'all', label: 'All' },
];

export function EnquiriesPage() {
  const { data, isPending } = useCoreData();
  const { locale } = useTenant();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.some((v) => v.key === params.get('view')) ? params.get('view') : 'followup') as View;
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Enquiry | 'new' | null>(null);
  const today = todayIso();

  const all = useMemo(() => (data?.tables.Enquiries ?? []).filter((q) => !isDeleted(q)), [data]);
  const counts = useMemo(() => ({
    followup: all.filter((q) => needsFollowUp(q, today)).length,
    open: all.filter(isOpenEnquiry).length,
    converted: all.filter((q) => q.status === 'Converted').length,
    lost: all.filter((q) => q.status === 'Lost').length,
    all: all.length,
  }), [all, today]);

  if (isPending || !data) return <Spinner />;
  const t = data.tables;

  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const rows = all
    .filter((q) => {
      if (view === 'followup') return needsFollowUp(q, today);
      if (view === 'open') return isOpenEnquiry(q);
      if (view === 'converted') return q.status === 'Converted';
      if (view === 'lost') return q.status === 'Lost';
      return true;
    })
    .filter((q) => !needle || q.name.toLowerCase().includes(needle) || (digits.length >= 3 && q.phone.includes(digits)))
    .sort((a, b) => view === 'followup'
      ? (a.next_followup_date || a.trial_date || a.enquiry_date).localeCompare(b.next_followup_date || b.trial_date || b.enquiry_date)
      : b.enquiry_date.localeCompare(a.enquiry_date) || b.created_at.localeCompare(a.created_at));

  const setView = (v: View) => setParams((p) => { if (v === 'followup') p.delete('view'); else p.set('view', v); return p; }, { replace: true });
  const converted = counts.converted;
  const decided = converted + counts.lost;

  return (
    <>
      <PageHeader
        title="Enquiries"
        subtitle={decided ? `${Math.round((converted / decided) * 100)}% of closed enquiries joined` : 'Track walk-ins and calls until they join'}
        actions={<><ExportButton list="enquiries" /><Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add enquiry</Button></>}
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}
            className={clsx('min-h-9 rounded-full border px-3 text-sm font-medium', view === v.key ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>
            {v.label} <span className={clsx('ml-1 tabular-nums', view === v.key ? 'text-white/80' : 'text-muted')}>{counts[v.key]}</span>
          </button>
        ))}
      </div>

      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or phone" aria-label="Search enquiries"
          className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
      </label>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={view === 'followup' ? 'No follow-ups due' : 'No enquiries here'}
            action={all.length === 0 ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add the first enquiry</Button> : undefined}>
            {view === 'followup' && all.length > 0 ? 'Everyone has been followed up. Nice work.' : undefined}
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((q) => {
            const followOn = q.next_followup_date || q.trial_date;
            const late = isOpenEnquiry(q) && followOn && followOn < today;
            const student = q.converted_student_id ? t.Students.find((s) => s.id === q.converted_student_id) : null;
            return (
              <li key={q.id}>
                <Card className="!p-3 sm:!p-4">
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => setEditing(q)} className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{q.name}</p>
                        <StatusBadge status={q.status} />
                      </div>
                      <p className="text-sm text-muted">{formatPhone(q.phone, locale.countryCode)}{courseNames(t, q.course_interested) && ` · ${courseNames(t, q.course_interested)}`}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {q.source} · came {formatDate(q.enquiry_date)}
                        {isOpenEnquiry(q) && followOn && (
                          <span className={clsx(late && 'font-medium text-danger')}> · {q.trial_date && !q.next_followup_date ? 'trial' : 'follow up'} {formatDate(followOn)}</span>
                        )}
                        {q.status === 'Lost' && q.lost_reason && ` · ${q.lost_reason}`}
                      </p>
                      {q.notes && <p className="mt-1 line-clamp-2 text-sm">{q.notes}</p>}
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <a href={`tel:${q.phone}`} aria-label={`Call ${q.name}`} className="grid size-10 place-items-center rounded-xl text-primary hover:bg-primary-soft">
                        <Phone className="size-4" aria-hidden />
                      </a>
                      <a href={whatsappUrl(q.phone, '')} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${q.name}`} className="grid size-10 place-items-center rounded-xl text-success hover:bg-success/10">
                        <MessageCircle className="size-4" aria-hidden />
                      </a>
                    </div>
                  </div>
                  {isOpenEnquiry(q) && (
                    <div className="mt-2 flex justify-end">
                      <Link to={`/admissions/new?enquiry=${q.id}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary hover:bg-primary-soft">
                        <UserPlus className="size-4" aria-hidden /> Convert to admission
                      </Link>
                    </div>
                  )}
                  {student && (
                    <div className="mt-2 flex justify-end">
                      <Link to={`/students/${student.id}`} className="text-sm font-medium text-primary underline underline-offset-2">Open {student.name}</Link>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {editing && <EnquirySheet enquiry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
