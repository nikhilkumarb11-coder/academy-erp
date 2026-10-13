import { Eye, EyeOff, Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/errors';
import { Alert, Button, Card } from '../components/ui';
import { useTenant } from '../tenant/TenantContext';

export function LoginPage() {
  const tenant = useTenant();
  const { login, logoutReason } = useAuth();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-primary px-4 py-10">
      <div className="mb-8 text-center">
        {tenant.logo ? (
          <img src={tenant.logo} alt="" className="mx-auto mb-4 size-20 rounded-2xl object-contain" />
        ) : (
          <div className="mx-auto mb-4 grid size-20 place-items-center rounded-2xl bg-accent font-heading text-4xl font-bold text-primary">
            {tenant.shortName.charAt(0)}
          </div>
        )}
        <h1 className="text-3xl font-semibold text-white">{tenant.name}</h1>
        <p className="mt-1 text-sm text-white/60">Management console</p>
      </div>

      <Card className="w-full max-w-sm">
        <form onSubmit={onSubmit} className="space-y-4">
          {logoutReason && !error && <Alert tone="info">{logoutReason}</Alert>}
          {error && <Alert>{error}</Alert>}
          {tenant.apiUrl === 'mock' && !error && <Alert tone="info">Demo mode. The password is <strong>demo1234</strong>.</Alert>}

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Password</span>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-line bg-surface pl-9 pr-11 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-primary"
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>

          <Button type="submit" loading={busy} className="w-full" disabled={!password}>
            Log in
          </Button>
        </form>
      </Card>
    </div>
  );
}
