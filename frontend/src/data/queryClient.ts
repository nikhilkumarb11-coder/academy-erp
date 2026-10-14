import { QueryClient } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';
import { ApiError } from '../api/errors';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 7 * 24 * 3600_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => error instanceof ApiError && error.transient && count < 2,
        networkMode: 'offlineFirst',
      },
      mutations: {
        networkMode: 'offlineFirst',
      },
    },
  });
}

const PERSIST_THROTTLE_MS = 1000;

/**
 * One IndexedDB entry per tenant so academies sharing a browser never see each other's data.
 * Every query update asks to persist; writing the whole cache each time stalls the main thread, so
 * writes are throttled to the latest state once a second, and flushed when the app is hidden.
 */
export function idbPersister(slug: string): Persister {
  const key = `erp:${slug}:query-cache`;
  let latest: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const client = latest;
    latest = null;
    if (client) set(key, client).catch(() => {});
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  return {
    persistClient: (client: PersistedClient) => {
      latest = client;
      timer ??= setTimeout(flush, PERSIST_THROTTLE_MS);
    },
    restoreClient: () => get<PersistedClient>(key),
    removeClient: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      latest = null;
      return del(key);
    },
  };
}
