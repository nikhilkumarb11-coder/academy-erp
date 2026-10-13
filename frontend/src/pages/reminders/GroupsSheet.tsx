import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/errors';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Button, EmptyState, Field } from '../../components/ui';
import { useCoreTables } from '../../data/useCoreData';
import { useWrite } from '../../data/useWrite';
import { formatDate } from '../../lib/dates';

/** The academy's WhatsApp groups, kept only so the owner can see when each last got a message. */
export function GroupsSheet({ onClose }: { onClose: () => void }) {
  const t = useCoreTables();
  const toast = useToast();
  const save = useWrite('catalog.save');
  const remove = useWrite('catalog.delete');
  const [name, setName] = useState('');
  const groups = [...(t?.WhatsAppGroups ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate({ tab: 'WhatsAppGroups', row: { name: name.trim() } }, {
      onSuccess: () => setName(''),
      onError: (err) => toast(errorMessage(err), 'error'),
    });
  }

  return (
    <Sheet open title="WhatsApp groups" onClose={onClose} footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Done</Button></div>}>
      <form onSubmit={add} className="mb-4 flex items-end gap-2">
        <Field label="Group name" className="flex-1" placeholder="e.g. Karate parents" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <Button type="submit" loading={save.isPending} disabled={!name.trim()}><Plus className="size-4" aria-hidden /> Add</Button>
      </form>
      {groups.length === 0 ? (
        <EmptyState title="No groups yet">Add the WhatsApp groups you post announcements in.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{g.name}</p>
                <p className="text-xs text-muted">{g.last_sent_at ? `Last message ${formatDate(g.last_sent_at.slice(0, 10))}` : 'No messages yet'}</p>
              </div>
              <button type="button" aria-label={`Delete ${g.name}`} disabled={remove.isPending}
                onClick={() => remove.mutate({ tab: 'WhatsAppGroups', id: g.id }, { onError: (err) => toast(errorMessage(err), 'error') })}
                className="grid size-10 place-items-center rounded-xl text-muted hover:bg-danger/10 hover:text-danger">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
