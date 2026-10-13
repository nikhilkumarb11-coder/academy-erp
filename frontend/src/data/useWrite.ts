import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { useTenant } from '../tenant/TenantContext';
import { applyChanges, type Changes } from './merge';
import type { CoreData } from './types';
import { coreKey } from './useCoreData';

export interface WriteResult {
  changes: Changes;
  [key: string]: unknown;
}

/**
 * Mutation for any write action that returns { changes }. The returned rows are merged into the
 * device cache immediately, so every screen reflects the save without waiting for the next sync.
 */
export function useWrite<P = Record<string, unknown>, R extends WriteResult = WriteResult>(action: string) {
  const { api } = useAuth();
  const tenant = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: P) => api<R>(action, payload),
    onSuccess: (result) => {
      queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? applyChanges(old, result.changes) : old));
    },
  });
}
