import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/errors';
import { fieldError } from '../../api/fieldErrors';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Alert, Button, Card, Field, SelectField, StatusBadge, Toggle } from '../../components/ui';
import type { MessageTemplate, TemplateType } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { useWrite } from '../../data/useWrite';
import { bool } from '../../lib/values';
import { fillMessage, TEMPLATE_TYPES, templateTypeLabel } from '../../lib/whatsapp';
import { useTenant } from '../../tenant/TenantContext';

const SAMPLE: Record<string, string> = {
  parent: 'Ravi Kumar',
  student: 'Aarav',
  course: 'Karate',
  month: 'Oct 2026',
  amount: '1,000',
  balance: '1,000',
  receipt_no: 'RA/2026-27/0001',
  receipt_link: 'https://drive.google.com/…',
  date: '13 Oct 2026',
  event: 'Annual day',
  details: 'Venue: academy hall, 5 pm.',
  message: 'Classes are off on Monday for Diwali.',
};

/** Settings → WhatsApp templates (PRD §6.6: editable, with {placeholders}). */
export function TemplatesSettings() {
  const { data } = useCoreData();
  const [editing, setEditing] = useState<Partial<MessageTemplate> | null>(null);
  const templates = [...(data?.tables.MessageTemplates ?? [])].sort((a, b) =>
    TEMPLATE_TYPES.findIndex((x) => x.type === a.type) - TEMPLATE_TYPES.findIndex((x) => x.type === b.type) || a.name.localeCompare(b.name));

  return (
    <Card>
      <div id="templates" className="mb-4 flex scroll-mt-20 flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">WhatsApp templates</h2>
          <p className="text-sm text-muted">Words in {'{braces}'} are filled in automatically.</p>
        </div>
        <Button variant="secondary" onClick={() => setEditing({ type: 'Custom', active: true })}><Plus className="size-4" aria-hidden /> Add template</Button>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {templates.map((tpl) => (
          <li key={tpl.id} className="flex items-center gap-3 px-3 py-2.5">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(tpl)}>
              <p className="break-words font-medium">{tpl.name}</p>
              <p className="truncate text-xs text-muted">{templateTypeLabel(tpl.type)} · {tpl.text.replace(/\s+/g, ' ')}</p>
            </button>
            {!bool(tpl.active) && <StatusBadge status="Inactive" />}
            <button type="button" aria-label={`Edit ${tpl.name}`} onClick={() => setEditing(tpl)} className="grid size-10 place-items-center rounded-xl text-muted hover:bg-primary-soft hover:text-primary">
              <Pencil className="size-4" aria-hidden />
            </button>
          </li>
        ))}
        {templates.length === 0 && <li className="px-3 py-4 text-sm text-muted">No templates yet. Built-in wording is used until you add some.</li>}
      </ul>
      {editing && <TemplateSheet template={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TemplateSheet({ template, onClose }: { template: Partial<MessageTemplate>; onClose: () => void }) {
  const tenant = useTenant();
  const toast = useToast();
  const { data } = useCoreData();
  const save = useWrite('catalog.save');
  const remove = useWrite('catalog.delete');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [type, setType] = useState<TemplateType>(template.type ?? 'Custom');
  const [name, setName] = useState(template.name ?? '');
  const [text, setText] = useState(template.text ?? '');
  const [active, setActive] = useState(template.active === undefined ? true : bool(template.active));
  const placeholders = TEMPLATE_TYPES.find((x) => x.type === type)?.placeholders ?? [];
  const preview = fillMessage(text, {
    ...SAMPLE,
    academy: data?.settings.academy_name || tenant.name,
    academy_phone: data?.settings.academy_phone || '98765 43210',
  });

  function insert(token: string) {
    const el = textRef.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    const next = `${text.slice(0, at)}{${token}}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length + 2, at + token.length + 2);
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ tab: 'MessageTemplates', row: { id: template.id, type, name: name.trim(), text, active } }, { onSuccess: onClose });
  }

  function onDelete() {
    if (!template.id || !window.confirm(`Delete the template "${template.name}"?`)) return;
    remove.mutate({ tab: 'MessageTemplates', id: template.id }, { onSuccess: onClose, onError: (err) => toast(errorMessage(err), 'error') });
  }

  return (
    <Sheet open wide title={template.id ? 'Edit template' : 'New template'} onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          {template.id ? <Button variant="ghost" className="text-danger" onClick={onDelete} loading={remove.isPending}><Trash2 className="size-4" aria-hidden /> Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="template-form" loading={save.isPending} disabled={!name.trim() || !text.trim()}>Save</Button>
          </div>
        </div>
      }>
      <form id="template-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} error={fieldError(save.error, 'name')} />
        <SelectField label="Used for" value={type} onChange={(e) => setType(e.target.value as TemplateType)}>
          {TEMPLATE_TYPES.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
        </SelectField>
        <div className="sm:col-span-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Message</span>
            <textarea ref={textRef} rows={7} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
          </label>
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Insert a placeholder">
            {placeholders.map((p) => (
              <button key={p} type="button" onClick={() => insert(p)} className="min-h-8 rounded-full border border-line bg-canvas px-2.5 text-xs font-medium text-primary hover:bg-primary-soft">
                {`{${p}}`}
              </button>
            ))}
          </div>
          {type === 'FeeReminder' && <p className="mt-2 text-xs text-muted">{'{payment_link}'} is left out until online payments are switched on.</p>}
        </div>
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium">Preview</p>
          <p className="whitespace-pre-wrap rounded-xl bg-[#DCF8C6] px-3 py-2 text-sm text-[#111B21]">{preview || ' '}</p>
        </div>
        <div className="sm:col-span-2">
          <Toggle checked={active} onChange={setActive} label="Active" />
          <p className="text-xs text-muted">When several templates of one kind are active, the first is the default and the others can be picked when sending.</p>
        </div>
        {save.error && !fieldError(save.error, 'name') && <div className="sm:col-span-2"><Alert>{errorMessage(save.error)}</Alert></div>}
      </form>
    </Sheet>
  );
}
