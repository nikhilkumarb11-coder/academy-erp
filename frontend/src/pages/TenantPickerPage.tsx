import { useState, type FormEvent } from 'react';
import { Button, Card, Field } from '../components/ui';

/** Shown at the site root, where no academy code is in the URL. */
export function TenantPickerPage({ notFound }: { notFound?: string }) {
  const [code, setCode] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const slug = code.trim().toLowerCase();
    if (slug) window.location.assign(`${import.meta.env.BASE_URL}${slug}/`);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-primary px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">Academy ERP</h1>
        <p className="mb-5 text-sm text-muted">Enter your academy code to continue.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field
            label="Academy code"
            placeholder="e.g. rays"
            autoCapitalize="none"
            autoCorrect="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={notFound ? `No academy found with code “${notFound}”.` : undefined}
          />
          <Button type="submit" className="w-full" disabled={!code.trim()}>Continue</Button>
        </form>
      </Card>
    </div>
  );
}
