import clsx from 'clsx';
import { Copy, MessageCircle, Send, Settings2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useToast } from '../../components/Toast';
import { Alert, Button, Card, EmptyState, Field, PageHeader, SelectField, Spinner, Toggle } from '../../components/ui';
import type { CoreData, TemplateType } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { useLogMessages, useRecentMessages } from '../../data/useMessages';
import { formatDate, todayIso } from '../../lib/dates';
import { familySummaries, fillTemplate } from '../../lib/ledger';
import { bool, isDeleted } from '../../lib/values';
import { activeTemplates, BROADCAST_TYPES, placeholdersIn, templateTypeLabel, whatsappUrl } from '../../lib/whatsapp';
import { useLabels, useTenant } from '../../tenant/TenantContext';
import { familyReminder, useMoney } from '../fees/feeShared';
import { GroupsSheet } from './GroupsSheet';
import { MessageQueue, type QueueItem } from './MessageQueue';

type Tab = 'fees' | 'announce' | 'sent';
const TABS: { key: Tab; label: string }[] = [
  { key: 'fees', label: 'Fee reminders' },
  { key: 'announce', label: 'Announcements' },
  { key: 'sent', label: 'Sent' },
];
const RECENT_DAYS = 3;

export function RemindersPage() {
  const { data, isPending } = useCoreData();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'fees') as Tab;

  if (isPending || !data) return <Spinner />;
  return (
    <>
      <PageHeader
        title="Reminders"
        subtitle="WhatsApp messages, one tap each"
        actions={
          <Link to="/settings#templates" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-primary hover:bg-primary-soft">
            <Settings2 className="size-4" aria-hidden /> Templates
          </Link>
        }
      />
      <div className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => setParams((p) => { if (t.key === 'fees') p.delete('tab'); else p.set('tab', t.key); return p; }, { replace: true })}
            className={clsx('min-h-9 rounded-lg px-3 text-sm font-medium sm:px-4', tab === t.key ? 'bg-primary text-white' : 'text-muted')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'fees' && <FeeRemindersTab data={data} />}
      {tab === 'announce' && <AnnounceTab data={data} />}
      {tab === 'sent' && <SentTab data={data} />}
    </>
  );
}

function FeeRemindersTab({ data }: { data: CoreData }) {
  const t = data.tables;
  const tenant = useTenant();
  const labels = useLabels();
  const money = useMoney();
  const today = todayIso();
  const recent = useRecentMessages();
  const templates = activeTemplates(t.MessageTemplates, 'FeeReminder');
  const [view, setView] = useState<'overdue' | 'due'>('overdue');
  const [courseId, setCourseId] = useState('');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [skipRecent, setSkipRecent] = useState(true);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const template = templates.find((x) => x.id === templateId) ?? templates[0];

  const lastReminded = useMemo(() => {
    const map = new Map<string, number>();
    (recent.data ?? []).forEach((m) => {
      if (m.type !== 'FeeReminder' || !m.parent_id) return;
      const at = Date.parse(m.sent_at);
      if (at > (map.get(m.parent_id) ?? 0)) map.set(m.parent_id, at);
    });
    return map;
  }, [recent.data]);

  const families = useMemo(() => {
    const courseOf = new Map(t.Enrollments.map((e) => [e.id, e.course_id]));
    return familySummaries(t, today).filter((f) => f.outstanding > 0
      && (view === 'due' || f.overdue > 0)
      && (!courseId || f.openDues.some((d) => courseOf.get(d.enrollment_id) === courseId)));
  }, [t, today, view, courseId]);

  const cutoff = Date.now() - RECENT_DAYS * 86400000;
  const isRecent = (parentId: string) => (lastReminded.get(parentId) ?? 0) >= cutoff;
  const recentCount = families.filter((f) => isRecent(f.parentId)).length;
  const toSend = skipRecent ? families.filter((f) => !isRecent(f.parentId)) : families;
  const total = toSend.reduce((s, f) => s + f.outstanding, 0);
  const courses = t.Courses.filter((c) => bool(c.active) && !isDeleted(c)).sort((a, b) => a.name.localeCompare(b.name));

  if (queue) return <MessageQueue items={queue} type="FeeReminder" templateId={template?.id} onExit={() => setQueue(null)} />;

  function start() {
    setQueue(toSend.map((f) => ({
      parentId: f.parentId,
      name: f.guardian,
      phone: f.phone,
      subtitle: f.children.join(', '),
      amount: money(f.outstanding),
      text: familyReminder(t, data.settings, tenant.name, f.parentId, template?.text)?.text ?? '',
    })));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['overdue', 'due'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
            className={clsx('min-h-9 rounded-full border px-3 text-sm font-medium', view === v ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>
            {v === 'overdue' ? 'Overdue' : 'All with dues'}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={labels.course} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">All {labels.courses.toLowerCase()}</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        {templates.length > 1 && (
          <SelectField label="Template" value={template?.id ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </SelectField>
        )}
      </div>
      {recentCount > 0 && (
        <Toggle checked={skipRecent} onChange={setSkipRecent} label={`Skip ${recentCount} ${recentCount === 1 ? 'family' : 'families'} reminded in the last ${RECENT_DAYS} days`} />
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold tabular-nums">{toSend.length} {toSend.length === 1 ? 'family' : 'families'}</p>
          <p className="text-sm text-muted tabular-nums">{money(total)} outstanding</p>
        </div>
        <Button onClick={start} disabled={!toSend.length}><Send className="size-4" aria-hidden /> Start sending</Button>
      </Card>

      {families.length === 0 ? (
        <Card>
          <EmptyState title={view === 'overdue' ? 'Nobody is overdue' : 'Nobody owes fees'}>
            {view === 'overdue' ? 'Switch to "All with dues" to remind families before the due date.' : 'Every family is paid up.'}
          </EmptyState>
        </Card>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {families.map((f) => {
            const last = lastReminded.get(f.parentId);
            return (
              <li key={f.parentId} className={clsx('flex items-center gap-3 px-4 py-3', skipRecent && isRecent(f.parentId) && 'opacity-50')}>
                <Link to={`/fees/${f.parentId}`} className="min-w-0 flex-1">
                  <p className="break-words font-medium hover:text-primary">{f.guardian}</p>
                  <p className="break-words text-xs text-muted">
                    {f.children.join(', ')}{last ? ` · reminded ${formatDate(new Date(last).toISOString().slice(0, 10))}` : ''}
                  </p>
                </Link>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(f.outstanding)}</p>
                  <p className={clsx('text-xs', f.bucket ? 'text-danger' : 'text-muted')}>{f.bucket ? `Overdue ${f.bucket}` : 'Not yet due'}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const AUTO_FIELDS = ['academy', 'academy_phone', 'parent', 'student'];
const BLANK = 'Dear parents,\n\n{message}\n\n{academy}';
const FIELD_HINTS: Record<string, string> = {
  event: 'e.g. Annual day',
  date: 'e.g. Sunday, 20 October, 5 pm',
  details: 'Venue, timing, what to bring…',
  course: 'e.g. Robotics for ages 8–14',
  message: 'Your message',
};

function AnnounceTab({ data }: { data: CoreData }) {
  const t = data.tables;
  const tenant = useTenant();
  const labels = useLabels();
  const toast = useToast();
  const logMessages = useLogMessages();
  const templates = t.MessageTemplates.filter((x) => BROADCAST_TYPES.includes(x.type) && bool(x.active));
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<string | null>(null);
  const [audience, setAudience] = useState<'group' | 'parents'>('group');
  const [groupId, setGroupId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [managing, setManaging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);

  const template = templates.find((x) => x.id === templateId);
  const type: TemplateType = template?.type ?? 'Custom';
  const base = template?.text ?? BLANK;
  const fields = placeholdersIn(base).filter((p) => !AUTO_FIELDS.includes(p));
  const filledValues = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
  const message = custom ?? fillTemplate(base, {
    ...filledValues,
    academy: data.settings.academy_name || tenant.name,
    academy_phone: data.settings.academy_phone ?? '',
  });
  const missing = placeholdersIn(message).filter((p) => !AUTO_FIELDS.includes(p));
  const groups = [...t.WhatsAppGroups].sort((a, b) => a.name.localeCompare(b.name));
  const courses = t.Courses.filter((c) => bool(c.active) && !isDeleted(c)).sort((a, b) => a.name.localeCompare(b.name));

  const families = useMemo(() => {
    const activeStudents = t.Students.filter((s) => s.status === 'Active' && (!courseId
      || t.Enrollments.some((e) => e.student_id === s.id && e.course_id === courseId && e.status === 'Active')));
    const byParent = new Map<string, string[]>();
    activeStudents.forEach((s) => byParent.set(s.parent_id, [...(byParent.get(s.parent_id) ?? []), s.name]));
    return t.Parents.filter((p) => byParent.has(p.id))
      .map((p) => ({ parent: p, children: byParent.get(p.id) ?? [] }))
      .sort((a, b) => a.parent.guardian_name.localeCompare(b.parent.guardian_name));
  }, [t, courseId]);

  if (queue) return <MessageQueue items={queue} type={type} templateId={template?.id} onExit={() => setQueue(null)} />;

  const groupText = fillTemplate(message, { parent: 'parents', student: 'your child' });
  const logGroup = (channel: 'WhatsApp' | 'Copy') =>
    logMessages([{ type, channel, group_id: groupId || undefined, template_id: template?.id, preview: groupText }]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(groupText);
      logGroup('Copy');
      toast('Message copied. Paste it in the WhatsApp group.');
    } catch {
      toast('Could not copy. Select the message and copy it manually.', 'error');
    }
  }

  function openWhatsApp() {
    window.open(whatsappUrl('', groupText), '_blank', 'noopener');
    logGroup('WhatsApp');
  }

  function startParents() {
    setQueue(families.map(({ parent, children }) => ({
      parentId: parent.id,
      name: parent.guardian_name,
      phone: parent.phone,
      subtitle: children.join(', '),
      text: fillTemplate(message, { parent: parent.guardian_name, student: children.join(', ') }),
    })));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4">
        <SelectField label="Template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setCustom(null); }}>
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name} ({templateTypeLabel(x.type)})</option>)}
          <option value="">Blank message</option>
        </SelectField>
        {custom === null && fields.map((f) => (
          <Field key={f} label={f.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())} placeholder={FIELD_HINTS[f]}
            value={values[f] ?? ''} onChange={(e) => setValues((prev) => ({ ...prev, [f]: e.target.value }))} />
        ))}
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-sm font-medium">
            Message
            {custom !== null && (
              <button type="button" className="text-xs font-medium text-primary underline" onClick={() => setCustom(null)}>Reset to template</button>
            )}
          </span>
          <textarea rows={8} value={message} onChange={(e) => setCustom(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
          <span className="mt-1 block text-xs text-muted">{'{parent}'} and {'{student}'} are filled in per family when sending one by one.</span>
        </label>
        {missing.length > 0 && <Alert tone="warning">Still to fill in: {missing.join(', ')}</Alert>}
      </Card>

      <Card className="space-y-4">
        <div className="inline-flex rounded-xl border border-line p-1" role="radiogroup" aria-label="Send to">
          {(['group', 'parents'] as const).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={audience === a} onClick={() => setAudience(a)}
              className={clsx('min-h-9 rounded-lg px-3 text-sm font-medium', audience === a ? 'bg-primary text-white' : 'text-muted')}>
              {a === 'group' ? 'WhatsApp group' : 'Parents one by one'}
            </button>
          ))}
        </div>

        {audience === 'group' ? (
          <>
            <div className="flex items-end gap-2">
              <SelectField label="Group (for your records)" className="flex-1" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Not recorded</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.last_sent_at ? ` · last ${formatDate(g.last_sent_at.slice(0, 10))}` : ''}</option>)}
              </SelectField>
              <Button variant="secondary" className="px-3" aria-label="Manage groups" onClick={() => setManaging(true)}><Users className="size-4" aria-hidden /></Button>
            </div>
            <p className="text-sm text-muted">WhatsApp can't open a group from a link. Copy the message and paste it in the group, or open WhatsApp and pick the group.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="secondary" onClick={copy} disabled={!message.trim()}><Copy className="size-4" aria-hidden /> Copy message</Button>
              <Button onClick={openWhatsApp} disabled={!message.trim()}><MessageCircle className="size-4" aria-hidden /> Open WhatsApp</Button>
            </div>
          </>
        ) : (
          <>
            <SelectField label={`Parents of ${labels.students.toLowerCase()} in`} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">All active {labels.students.toLowerCase()}</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm"><strong className="tabular-nums">{families.length}</strong> {families.length === 1 ? 'family' : 'families'}</p>
              <Button onClick={startParents} disabled={!families.length || !message.trim()}><Send className="size-4" aria-hidden /> Start sending</Button>
            </div>
          </>
        )}
      </Card>

      {managing && <GroupsSheet onClose={() => setManaging(false)} />}
    </div>
  );
}

function SentTab({ data }: { data: CoreData }) {
  const t = data.tables;
  const recent = useRecentMessages();
  const [type, setType] = useState('');

  if (recent.isPending) return <Spinner label="Loading sent messages…" />;
  if (recent.isError) return <Alert>Could not load sent messages. <button type="button" className="underline" onClick={() => recent.refetch()}>Retry</button></Alert>;

  const rows = recent.data.filter((m) => !type || m.type === type);
  const types = [...new Set(recent.data.map((m) => m.type))];
  const recipient = (m: (typeof rows)[number]) =>
    t.Parents.find((p) => p.id === m.parent_id)?.guardian_name
    ?? (m.group_id ? t.WhatsAppGroups.find((g) => g.id === m.group_id)?.name : undefined)
    ?? (m.channel === 'Copy' ? 'Copied' : 'WhatsApp');

  return (
    <div className="space-y-3">
      {types.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {['', ...types].map((k) => (
            <button key={k || 'all'} type="button" aria-pressed={type === k} onClick={() => setType(k)}
              className={clsx('min-h-9 rounded-full border px-3 text-sm font-medium', type === k ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>
              {k ? templateTypeLabel(k) : 'All'}
            </button>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <Card><EmptyState title="Nothing sent in the last 60 days">Messages sent from the app are listed here.</EmptyState></Card>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {rows.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="break-words font-medium">{recipient(m)}</p>
                <p className="shrink-0 text-xs text-muted">
                  {new Date(m.sent_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              <p className="text-xs font-medium text-primary">{templateTypeLabel(m.type)}</p>
              <p className="line-clamp-2 text-sm text-muted">{m.preview}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
