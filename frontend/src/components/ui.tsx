import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:opacity-95 shadow-sm',
  secondary: 'bg-surface text-primary border border-line hover:bg-primary-soft',
  ghost: 'text-primary hover:bg-primary-soft',
  danger: 'bg-danger text-white hover:opacity-95',
};

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      className={clsx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
        buttonStyles[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_3px_rgba(11,31,58,0.06)] sm:p-5', className)}>{children}</div>;
}

export function Field({
  label,
  hint,
  error,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <input
        className={clsx(
          'min-h-11 w-full rounded-xl border bg-surface px-3 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15',
          error ? 'border-danger' : 'border-line',
        )}
        aria-invalid={error ? true : undefined}
        {...input}
      />
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const controlClass = (error?: string) =>
  clsx(
    'w-full rounded-xl border bg-surface px-3 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:bg-canvas disabled:text-muted',
    error ? 'border-danger' : 'border-line',
  );

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <select className={clsx(controlClass(error), 'min-h-11 pr-8')} aria-invalid={error ? true : undefined} {...select}>
        {children}
      </select>
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  ...area
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <textarea rows={3} className={clsx(controlClass(error), 'py-2')} aria-invalid={error ? true : undefined} {...area} />
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-success' : 'bg-line')}
      >
        <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
      <span className="text-sm">{label}</span>
    </label>
  );
}

const STATUS_TONES: Record<string, string> = {
  Active: 'bg-success/10 text-success',
  'On hold': 'bg-warning/10 text-warning',
  Dropped: 'bg-danger/10 text-danger',
  Completed: 'bg-primary-soft text-primary',
  Inactive: 'bg-line text-muted',
  Pending: 'bg-warning/10 text-warning',
  Partial: 'bg-warning/10 text-warning',
  Overdue: 'bg-danger/10 text-danger',
  Paid: 'bg-success/10 text-success',
  Waived: 'bg-line text-muted',
  Recorded: 'bg-success/10 text-success',
  Cancelled: 'bg-danger/10 text-danger',
  New: 'bg-primary-soft text-primary',
  'Follow-up': 'bg-warning/10 text-warning',
  Trial: 'bg-accent-soft text-primary',
  Converted: 'bg-success/10 text-success',
  Lost: 'bg-line text-muted',
  Present: 'bg-success/10 text-success',
  Absent: 'bg-danger/10 text-danger',
  Leave: 'bg-warning/10 text-warning',
  Holiday: 'bg-primary-soft text-primary',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_TONES[status] ?? 'bg-line text-muted')}>{status}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'warning' | 'success' | 'info'; children: ReactNode }) {
  const tones = {
    danger: 'border-danger/30 bg-danger/5 text-danger',
    warning: 'border-warning/30 bg-warning/5 text-warning',
    success: 'border-success/30 bg-success/5 text-success',
    info: 'border-primary/20 bg-primary-soft text-primary',
  };
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('rounded-xl border px-3 py-2 text-sm', tones[tone])}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function FullScreenMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <h1 className="mb-2 text-2xl font-semibold">{title}</h1>
        <div className="text-sm text-muted">{children}</div>
      </Card>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
