import clsx from 'clsx';
import { Download, EllipsisVertical, Share, SquarePlus, X } from 'lucide-react';
import { useState } from 'react';
import { useInstall, type InstallMode } from '../lib/install';
import { useTenant } from '../tenant/TenantContext';
import { AppLogo } from './AppLogo';
import { Sheet } from './Sheet';
import { Button } from './ui';

function GuideSheet({ mode, onClose }: { mode: InstallMode; onClose: () => void }) {
  const tenant = useTenant();
  const steps = mode === 'ios'
    ? [
        { icon: Share, text: <>Tap the <strong>Share</strong> button in Safari (the square with an arrow, at the bottom of the screen).</> },
        { icon: SquarePlus, text: <>Scroll down and tap <strong>Add to Home Screen</strong>.</> },
        { icon: Download, text: <>Tap <strong>Add</strong>. {tenant.shortName} appears on your home screen like any other app.</> },
      ]
    : [
        { icon: EllipsisVertical, text: <>Tap the browser menu <strong>⋮</strong> at the top right.</> },
        { icon: Download, text: <>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</> },
        { icon: SquarePlus, text: <>Confirm. {tenant.shortName} appears on your home screen like any other app.</> },
      ];

  return (
    <Sheet open title={`Install ${tenant.shortName}`} onClose={onClose} footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Got it</Button></div>}>
      <div className="mb-4 flex items-center gap-3">
        <AppLogo className="size-14 rounded-2xl text-2xl" tile />
        <div>
          <p className="font-semibold">{tenant.name}</p>
          <p className="text-sm text-muted">Opens full screen, straight from your home screen.</p>
        </div>
      </div>
      <ol className="space-y-3">
        {steps.map(({ icon: Icon, text }, i) => (
          <li key={i} className="flex gap-3 rounded-xl bg-canvas p-3 text-sm">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-white"><Icon className="size-4" aria-hidden /></span>
            <span className="pt-1.5">{text}</span>
          </li>
        ))}
      </ol>
      {mode === 'ios' && <p className="mt-3 text-xs text-muted">On iPhone this works from Safari. If you opened the link in another app, open it in Safari first.</p>}
    </Sheet>
  );
}

/** "Install app" action: the native dialog where the browser offers one, otherwise step-by-step help. */
export function InstallButton({ className, variant = 'secondary', label = 'Install app' }: { className?: string; variant?: 'primary' | 'secondary' | 'ghost'; label?: string }) {
  const { mode, promptInstall } = useInstall();
  const [guide, setGuide] = useState(false);
  if (mode === 'installed' || mode === 'none') return null;

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => (mode === 'prompt' ? void promptInstall() : setGuide(true))}>
        <Download className="size-4" aria-hidden /> {label}
      </Button>
      {guide && <GuideSheet mode={mode} onClose={() => setGuide(false)} />}
    </>
  );
}

/** Dismissible dashboard card inviting staff to install the app on their phone. */
export function InstallBanner() {
  const tenant = useTenant();
  const { mode } = useInstall();
  const key = `erp:${tenant.slug}:install-dismissed`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(key) === '1');
  if (dismissed || mode === 'installed' || mode === 'none') return null;

  return (
    <div className={clsx('mb-4 flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft p-3 sm:p-4')}>
      <AppLogo className="size-12 rounded-xl text-xl" tile />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Install {tenant.shortName} on this device</p>
        <p className="text-xs text-muted">One tap from your home screen, full screen, works with a weak connection.</p>
      </div>
      <InstallButton variant="primary" label="Install" className="min-h-10 px-3" />
      <button type="button" aria-label="Dismiss" className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/60"
        onClick={() => { localStorage.setItem(key, '1'); setDismissed(true); }}>
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
