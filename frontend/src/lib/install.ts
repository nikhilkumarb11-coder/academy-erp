import { useSyncExternalStore } from 'react';

/** Chrome/Edge/Samsung Internet event that allows showing the native install dialog from a button. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};

// Registered at import (main.tsx) because the event can fire before React mounts.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isMobile(): boolean {
  return typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'manual' | 'none';

/**
 * How this device can install the app: a native dialog ("prompt"), Safari's Share menu ("ios"),
 * the browser menu on other phones ("manual"), or not at all (desktop browsers without support).
 */
export function useInstall() {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );

  const mode: InstallMode = installed || isStandalone() ? 'installed' : deferred ? 'prompt' : isIos() ? 'ios' : isMobile() ? 'manual' : 'none';

  async function promptInstall(): Promise<boolean> {
    if (!deferred) return false;
    const event = deferred;
    deferred = null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    notify();
    return outcome === 'accepted';
  }

  return { mode, promptInstall };
}
