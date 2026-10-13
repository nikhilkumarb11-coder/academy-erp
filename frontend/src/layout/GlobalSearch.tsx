import clsx from 'clsx';
import { Search, User, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCoreTables } from '../data/useCoreData';
import { formatPhone, phoneDigits } from '../lib/phone';
import { useLabels, useTenant } from '../tenant/TenantContext';

interface Result {
  key: string;
  kind: 'student' | 'parent';
  title: string;
  subtitle: string;
  to: string;
}

const MAX_RESULTS = 8;

/** Searches cached students and parents by name, guardian name or phone (PRD §4: on every screen). */
export function GlobalSearch() {
  const tables = useCoreTables();
  const labels = useLabels();
  const { locale } = useTenant();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!tables || q.length < 2) return [];
    const digits = phoneDigits(q);
    const parentsById = new Map(tables.Parents.map((p) => [p.id, p]));
    const out: Result[] = [];

    for (const s of tables.Students) {
      const parent = parentsById.get(s.parent_id);
      const phoneHit = digits.length >= 3 && phoneDigits(parent?.phone ?? '').includes(digits);
      if (s.name.toLowerCase().includes(q) || phoneHit || parent?.guardian_name.toLowerCase().includes(q)) {
        out.push({
          key: s.id,
          kind: 'student',
          title: s.name,
          subtitle: [s.class && `${labels.class} ${s.class}`, parent?.guardian_name, s.status !== 'Active' && s.status].filter(Boolean).join(' · '),
          to: `/students/${s.id}`,
        });
      }
      if (out.length >= MAX_RESULTS) break;
    }

    if (out.length < MAX_RESULTS) {
      for (const p of tables.Parents) {
        const phoneHit = digits.length >= 3 && phoneDigits(p.phone).includes(digits);
        if (!p.guardian_name.toLowerCase().includes(q) && !phoneHit) continue;
        const firstChild = tables.Students.find((s) => s.parent_id === p.id);
        out.push({
          key: p.id,
          kind: 'parent',
          title: p.guardian_name,
          subtitle: `${labels.guardian} · ${formatPhone(p.phone, locale.countryCode)}`,
          to: firstChild ? `/students/${firstChild.id}` : '/students',
        });
        if (out.length >= MAX_RESULTS) break;
      }
    }
    return out;
  }, [query, tables, labels, locale.countryCode]);

  function go(result: Result) {
    navigate(result.to);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter' && results[active]) go(results[active]);
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={`Search ${labels.students.toLowerCase()}, ${labels.guardians.toLowerCase()}, phone…`}
        aria-label="Global search"
        className="min-h-10 w-full rounded-xl border border-line bg-canvas pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/15"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">No matches for “{query.trim()}”</p>
          ) : (
            <ul role="listbox">
              {results.map((r, i) => {
                const Icon = r.kind === 'student' ? User : Users;
                return (
                  <li key={`${r.kind}-${r.key}`} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(r)}
                      onMouseEnter={() => setActive(i)}
                      className={clsx('flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left', i === active && 'bg-primary-soft')}
                    >
                      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
