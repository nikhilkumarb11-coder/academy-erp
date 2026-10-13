import clsx from 'clsx';
import { Check, ChevronLeft, MessageCircle, RotateCcw, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { Button, Card } from '../../components/ui';
import type { TemplateType } from '../../data/types';
import { useLogMessages } from '../../data/useMessages';
import { formatPhone } from '../../lib/phone';
import { whatsappUrl } from '../../lib/whatsapp';

export interface QueueItem {
  parentId: string;
  name: string;
  phone: string;
  subtitle: string;
  amount?: string;
  text: string;
}

type Outcome = 'sent' | 'skipped';

/**
 * S13 reminder queue: one family at a time, one tap opens WhatsApp with the message ready,
 * logs it and moves to the next. The list is a snapshot so sending never reshuffles it.
 */
export function MessageQueue({ items, type, templateId, onExit }: { items: QueueItem[]; type: TemplateType; templateId?: string; onExit: () => void }) {
  const logMessages = useLogMessages();
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});

  const item = items[index];
  const sent = Object.values(outcomes).filter((o) => o === 'sent').length;
  const skipped = Object.values(outcomes).filter((o) => o === 'skipped').length;
  const textOf = (i: QueueItem) => edits[i.parentId] ?? i.text;

  function next(outcome: Outcome) {
    setOutcomes((prev) => ({ ...prev, [item.parentId]: outcome }));
    setIndex((i) => i + 1);
  }

  function send() {
    const text = textOf(item);
    window.open(whatsappUrl(item.phone, text), '_blank', 'noopener');
    logMessages([{ type, parent_id: item.parentId, template_id: templateId, preview: text }]);
    next('sent');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onExit} className="inline-flex min-h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-primary hover:bg-primary-soft">
          <ChevronLeft className="size-4" aria-hidden /> Back to list
        </button>
        <p className="text-sm text-muted tabular-nums">{sent} sent · {skipped} skipped</p>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full bg-accent transition-all" style={{ width: `${(Math.min(index, items.length) / items.length) * 100}%` }} />
      </div>

      {item ? (
        <Card className="border-primary/30">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted tabular-nums">{index + 1} of {items.length}</p>
              <p className="truncate text-lg font-semibold">{item.name}</p>
              <p className="truncate text-sm text-muted">{item.subtitle}</p>
              <p className="text-xs text-muted">{formatPhone(item.phone)}</p>
            </div>
            {item.amount && <p className="shrink-0 text-lg font-semibold tabular-nums">{item.amount}</p>}
          </div>
          <label className="block">
            <span className="sr-only">Message</span>
            <textarea
              rows={7}
              value={textOf(item)}
              onChange={(e) => setEdits((prev) => ({ ...prev, [item.parentId]: e.target.value }))}
              className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>
          <div className="mt-3 flex gap-2">
            {index > 0 && (
              <Button variant="ghost" className="px-3" aria-label="Previous" onClick={() => setIndex((i) => i - 1)}>
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
            )}
            <Button variant="secondary" onClick={() => next('skipped')}><SkipForward className="size-4" aria-hidden /> Skip</Button>
            <Button className="flex-1" onClick={send} disabled={!item.phone || !textOf(item).trim()}>
              <MessageCircle className="size-4" aria-hidden /> Open WhatsApp
            </Button>
          </div>
          {!item.phone && <p className="mt-2 text-xs text-danger">No phone number saved for this family.</p>}
        </Card>
      ) : (
        <Card className="text-center">
          <Check className="mx-auto mb-2 size-10 rounded-full bg-success/10 p-2 text-success" aria-hidden />
          <p className="text-lg font-semibold">All done</p>
          <p className="mb-4 text-sm text-muted">{sent} sent, {skipped} skipped.</p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={() => setIndex(0)}><RotateCcw className="size-4" aria-hidden /> Go through again</Button>
            <Button onClick={onExit}>Finish</Button>
          </div>
        </Card>
      )}

      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {items.map((it, i) => {
          const outcome = outcomes[it.parentId];
          return (
            <li key={it.parentId}>
              <button type="button" onClick={() => setIndex(i)}
                className={clsx('flex w-full items-center gap-3 px-4 py-2.5 text-left', i === index && 'bg-primary-soft')}>
                <span className="w-6 shrink-0 text-xs text-muted tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.name}</span>
                {it.amount && <span className="text-sm tabular-nums text-muted">{it.amount}</span>}
                {outcome && (
                  <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', outcome === 'sent' ? 'bg-success/10 text-success' : 'bg-line text-muted')}>
                    {outcome === 'sent' ? 'Sent' : 'Skipped'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
