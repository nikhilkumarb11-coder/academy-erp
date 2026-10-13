import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/errors';
import { Alert, Button, Card, Field, PageHeader } from '../components/ui';
import { coreKey, useCoreData } from '../data/useCoreData';
import type { CoreData, PingResult, Session, Settings } from '../data/types';
import { useTenant } from '../tenant/TenantContext';

const PROFILE_FIELDS: { key: string; label: string; hint?: string; type?: string; inputMode?: 'numeric' | 'tel' }[] = [
  { key: 'academy_name', label: 'Academy name', hint: 'Printed on receipts and messages' },
  { key: 'academy_tagline', label: 'Tagline (optional)', hint: 'Shown under the name on receipts' },
  { key: 'academy_phone', label: 'Academy phone', type: 'tel', inputMode: 'tel' },
  { key: 'contact_person', label: 'Contact person (optional)', hint: 'Receipt footer: "Contact: <name> · <phone>"' },
  { key: 'academy_address', label: 'Address', hint: 'Printed at the bottom of receipts' },
  { key: 'academy_email', label: 'Academy email (optional)', type: 'email' },
  { key: 'gstin', label: 'GSTIN (optional)', hint: 'Shown on receipts when filled' },
  { key: 'receipt_prefix', label: 'Receipt number prefix', hint: 'e.g. RA gives RA/2026-27/0001' },
  { key: 'receipt_footer', label: 'Receipt footer (optional)', hint: 'e.g. Fees once paid are not refundable' },
  { key: 'due_day', label: 'Fee due day of month', hint: 'Monthly dues are due on this day, e.g. 5', inputMode: 'numeric' },
  { key: 'fy_start_month', label: 'Financial year starts in month', hint: '4 = April; receipt numbers restart each year', inputMode: 'numeric' },
  { key: 'country_code', label: 'Default country code', hint: 'Used to format WhatsApp numbers, e.g. 91', inputMode: 'numeric' },
  { key: 'session_hours', label: 'Login session length (hours)', inputMode: 'numeric' },
];

function ProfileSettings() {
  const { api } = useAuth();
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const { data } = useCoreData();
  const [form, setForm] = useState<Settings>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, data.settings[f.key] ?? ''])));
  }, [data]);

  const mutation = useMutation({
    mutationFn: (changes: Settings) => api<Settings>('settings.update', changes),
    onSuccess: (settings) => {
      queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? { ...old, settings } : old));
      setSaved(true);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== (data?.settings[k] ?? '')));
    if (Object.keys(changes).length) mutation.mutate(changes);
    else setSaved(true);
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">Academy profile</h2>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        {PROFILE_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            hint={f.hint}
            type={f.type ?? 'text'}
            inputMode={f.inputMode}
            value={form[f.key] ?? ''}
            onChange={(e) => {
              setSaved(false);
              setForm((prev) => ({ ...prev, [f.key]: e.target.value }));
            }}
          />
        ))}
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" loading={mutation.isPending}>Save changes</Button>
          {saved && <span className="text-sm text-success">Saved</span>}
        </div>
        {mutation.error && <div className="sm:col-span-2"><Alert>{errorMessage(mutation.error)}</Alert></div>}
      </form>
    </Card>
  );
}

function PasswordSettings() {
  const { api, setSession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api<Session>('auth.changePassword', { current, next }),
    onSuccess: (session) => {
      setSession(session);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    },
  });

  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < 8;

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Change password</h2>
      <p className="mb-4 text-sm text-muted">All other devices will be logged out.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setDone(false);
          mutation.mutate();
        }}
        className="grid gap-4 sm:grid-cols-3"
      >
        <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={tooShort ? 'At least 8 characters' : undefined} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? 'Does not match' : undefined} />
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" loading={mutation.isPending} disabled={!current || !next || mismatch || tooShort || confirm !== next}>
            Update password
          </Button>
          {done && <span className="text-sm text-success">Password changed</span>}
        </div>
        {mutation.error && <div className="sm:col-span-3"><Alert>{errorMessage(mutation.error)}</Alert></div>}
      </form>
    </Card>
  );
}

function DataSettings() {
  const tenant = useTenant();
  const { api } = useAuth();
  const { data, fullReload } = useCoreData();
  const ping = useQuery({ queryKey: ['ping', tenant.slug], queryFn: () => api<PingResult>('system.ping'), staleTime: 10 * 60_000 });
  const reload = useMutation({ mutationFn: fullReload });
  const resetDemo = async () => {
    const { resetMockDb } = await import('../api/mock');
    await resetMockDb(tenant.slug);
  };

  const rows: [string, string][] = [
    ['Academy code', tenant.slug],
    ['Last synced', data?.syncedAt ? new Date(data.syncedAt).toLocaleString() : 'Never'],
    ['Server API version', ping.data ? String(ping.data.apiVersion) : '…'],
    ['Server schema version', ping.data ? String(ping.data.schemaVersion) : '…'],
    ['App expects API version', String(tenant.expectedApiVersion)],
  ];

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">Data and sync</h2>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={reload.isPending} onClick={() => reload.mutate()}>
          Refresh all data
        </Button>
        {tenant.apiUrl === 'mock' && (
          <Button variant="ghost" onClick={() => void resetDemo()}>Reset demo data</Button>
        )}
      </div>
      {reload.error && <div className="mt-3"><Alert>{errorMessage(reload.error)}</Alert></div>}
    </Card>
  );
}

interface SeedResult {
  preset: string;
  categories: number;
  courses: number;
}

/** Shown only while the academy has no courses: loads the tenant's preset (categories, courses, plans, templates). */
function StarterSetup() {
  const tenant = useTenant();
  const labels = tenant.labels;
  const { api } = useAuth();
  const { data, fullReload } = useCoreData();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}presets/${tenant.preset}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Starter preset "${tenant.preset}" was not found`);
      const preset = await res.json();
      const currentName = data?.settings.academy_name ?? '';
      if (!currentName || currentName === 'My Academy') {
        preset.settings = { ...preset.settings, academy_name: tenant.name };
      }
      const result = await api<SeedResult>('system.seed', { preset });
      await fullReload();
      return result;
    },
  });

  if (!data || data.tables.Courses.length > 0) return null;

  return (
    <Card className="border-accent">
      <h2 className="mb-1 text-lg font-semibold">Starter setup</h2>
      <p className="mb-4 text-sm text-muted">
        This academy has no {labels.courses.toLowerCase()} yet. Load the starter set of categories, {labels.courses.toLowerCase()},
        fee plans, one-time charges, expense categories and WhatsApp templates. You can edit all of them afterwards.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Load starter setup ({tenant.preset})
        </Button>
      </div>
      {mutation.error && <div className="mt-3"><Alert>{errorMessage(mutation.error)}</Alert></div>}
    </Card>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Academy profile, receipts and branding" />
      <div className="space-y-5">
        <StarterSetup />
        <ProfileSettings />
        <PasswordSettings />
        <DataSettings />
      </div>
    </>
  );
}
