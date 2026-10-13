import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTenant } from '../tenant/TenantContext';
import { applyDelta, fromSnapshot } from './merge';
import { CORE_TABS, type CoreData, type CoreSnapshot } from './types';

export const coreKey = (slug: string) => ['core', slug] as const;
const FULL_RELOAD_MS = 6 * 3600_000;

/**
 * Core data (students, parents, courses, ...) cached on the device.
 * First load: system.bootstrap. Afterwards: system.sync with the last server time, merged into the cache.
 * Screens render from cache instantly; refresh happens in the background every 60 s and on focus.
 */
export function useCoreData() {
  const tenant = useTenant();
  const { api, session } = useAuth();
  const queryClient = useQueryClient();
  const key = coreKey(tenant.slug);

  const query = useQuery({
    queryKey: key,
    enabled: !!session,
    refetchInterval: 60_000,
    queryFn: async (): Promise<CoreData> => {
      const cached = queryClient.getQueryData<CoreData>(key);
      // A cache from an older build may lack newer tabs; a delta would only bring their recent rows.
      // An old cache is reloaded in full as a safety net for edits a delta cannot see.
      const fresh = !!cached?.loadedAt && Date.now() - cached.loadedAt < FULL_RELOAD_MS;
      if (cached?.syncedAt && fresh && CORE_TABS.every((t) => Array.isArray(cached.tables[t]))) {
        const delta = await api<CoreSnapshot>('system.sync', { since: cached.syncedAt });
        return applyDelta(cached, delta);
      }
      return fromSnapshot(await api<CoreSnapshot>('system.bootstrap'));
    },
  });

  /** Discards the cache and reloads everything (Settings → Refresh all data). */
  const fullReload = useCallback(async () => {
    const snapshot = await api<CoreSnapshot>('system.bootstrap');
    queryClient.setQueryData(key, fromSnapshot(snapshot));
  }, [api, queryClient, key]);

  return { ...query, fullReload };
}

/** Convenience selectors over cached core data. */
export function useCoreTables() {
  const { data } = useCoreData();
  return useMemo(() => data?.tables, [data]);
}
