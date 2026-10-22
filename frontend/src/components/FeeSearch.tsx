import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CoreTables } from '../data/types';
import { phoneDigits } from '../lib/phone';
import { useLabels } from '../tenant/TenantContext';

export type FeeSearchSuggestion =
  | { kind: 'course'; id: string; label: string }
  | { kind: 'family'; id: string; label: string; hint: string }
  | { kind: 'student'; id: string; parentId: string; label: string; hint: string };

/** Typeahead for fees screens: courses become a filter chip; families/students open the family page. */
export function FeeSearch({
  tables,
  value,
  courseId,
  courseName,
  onQuery,
  onCourse,
  courses,
  className,
}: {
  tables: CoreTables;
  value: string;
  courseId: string;
  courseName?: string;
  onQuery: (q: string) => void;
  onCourse: (courseId: string) => void;
  courses: { id: string; name: string }[];
  className?: string;
}) {
  const labels = useLabels();
  const navigate = useNavigate();
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const suggestions = useMemo(() => buildSuggestions(tables, courses, value, labels), [tables, courses, value, labels]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => { setActive(0); }, [value]);

  function pick(s: FeeSearchSuggestion) {
    setOpen(false);
    if (s.kind === 'course') {
      onCourse(s.id);
      onQuery('');
      return;
    }
    onQuery('');
    navigate(`/fees/${s.kind === 'family' ? s.id : s.parentId}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, suggestions.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && suggestions[active]) { e.preventDefault(); pick(suggestions[active]); }
    if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={root} className={className}>
      {courseId && (
        <div className="mb-2 flex flex-wrap gap-2">
          <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary bg-primary-soft px-3 text-sm font-medium text-primary">
            {labels.course}: {courseName || courses.find((c) => c.id === courseId)?.name || courseId}
            <button type="button" aria-label="Clear course filter" className="grid size-6 place-items-center rounded-full hover:bg-primary/10" onClick={() => onCourse('')}>
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        </div>
      )}
      <label className="relative block">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          value={value}
          onChange={(e) => { onQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={`Search by name, phone or ${labels.course.toLowerCase()}…`}
          className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        {open && suggestions.length > 0 && (
          <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-lg">
            {suggestions.map((s, i) => (
              <li key={`${s.kind}-${s.id}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start px-3 py-2.5 text-left text-sm ${i === active ? 'bg-primary-soft' : 'hover:bg-primary-soft/60'}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(s)}
                >
                  <span className="font-medium">{s.label}</span>
                  <span className="text-xs text-muted">
                    {s.kind === 'course' ? labels.course : s.kind === 'family' ? `${labels.guardian} · ${s.hint}` : `${labels.student} · ${s.hint}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </label>
    </div>
  );
}

function buildSuggestions(
  t: CoreTables,
  courses: { id: string; name: string }[],
  raw: string,
  labels: { guardian: string; student: string; course: string },
): FeeSearchSuggestion[] {
  const q = raw.trim().toLowerCase();
  if (q.length < 1) return [];
  const qDigits = q.replace(/\D/g, '');
  const out: FeeSearchSuggestion[] = [];

  courses.forEach((c) => {
    if (c.name.toLowerCase().includes(q)) out.push({ kind: 'course', id: c.id, label: c.name });
  });

  const parents = new Map(t.Parents.map((p) => [p.id, p]));
  t.Students.filter((s) => s.status === 'Active').forEach((s) => {
    if (!s.name.toLowerCase().includes(q)) return;
    const p = parents.get(s.parent_id);
    out.push({ kind: 'student', id: s.id, parentId: s.parent_id, label: s.name, hint: p?.guardian_name || labels.guardian });
  });

  t.Parents.forEach((p) => {
    const nameHit = p.guardian_name.toLowerCase().includes(q);
    const phoneHit = qDigits.length >= 3 && phoneDigits(p.phone).includes(qDigits);
    if (!nameHit && !phoneHit) return;
    const kids = t.Students.filter((s) => s.parent_id === p.id && s.status === 'Active').map((s) => s.name).join(', ');
    out.push({ kind: 'family', id: p.id, label: p.guardian_name, hint: kids || p.phone });
  });

  return out.slice(0, 12);
}
