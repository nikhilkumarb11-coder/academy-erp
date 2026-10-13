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

/** One IndexedDB entry per tenant so academies sharing a browser never see each other's data. */
export function idbPersister(slug: string): Persister {
  const key = `erp:${slug}:query-cache`;
  return {
    persistClient: (client: PersistedClient) => set(key, client),
    restoreClient: () => get<PersistedClient>(key),
    removeClient: () => del(key),
  };
}
