import clsx from 'clsx';
import { CloudOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCoreData } from '../data/useCoreData';

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function timeOf(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SyncStatus({ compact }: { compact?: boolean }) {
  const { data, isFetching, isError, refetch } = useCoreData();
  const online = useOnline();

  const state = !online || isError ? 'offline' : isFetching ? 'syncing' : 'synced';
  const text =
    state === 'offline' ? 'Offline · saved data' : state === 'syncing' ? 'Syncing…' : `Synced ${timeOf(data?.syncedAt)}`;
  const Icon = state === 'offline' ? CloudOff : state === 'syncing' ? RefreshCw : CheckCircle2;

  return (
    <button
      type="button"
      onClick={() => void refetch()}
      title="Tap to sync now"
      className={clsx(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition',
        state === 'offline' && 'bg-warning/10 text-warning',
        state === 'syncing' && 'bg-primary-soft text-primary',
        state === 'synced' && 'text-success hover:bg-success/5',
      )}
    >
      <Icon className={clsx('size-4', state === 'syncing' && 'animate-spin')} aria-hidden />
      {!compact && <span>{text}</span>}
      {compact && <span className="sr-only">{text}</span>}
    </button>
  );
}
