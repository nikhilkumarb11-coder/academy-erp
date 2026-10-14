import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/errors';
import { useToast } from '../components/Toast';
import { useTenant } from '../tenant/TenantContext';
import { applyChanges, type Changes } from './merge';
import { beginSave, endSave } from './pending';
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

export interface InstantOptions<R> {
  /** Rows to show at once: new rows and edited versions of existing ones. */
  show: Changes;
  /** Versions of edited rows from before the edit, put back when the save fails. */
  previous?: Changes;
  /** Start of the error message, e.g. "Expense not saved". */
  failure: string;
  onSuccess?: (result: R) => void;
  onError?: (error: unknown) => void;
}

/**
 * A save that does not make the user wait: the rows appear at once (marked pending), the request
 * runs in the background, and the server's rows replace them when it answers. On failure the screen
 * goes back to how it was and a toast explains why.
 */
export function useInstantWrite<P = Record<string, unknown>, R extends WriteResult = WriteResult>(action: string) {
  const { api } = useAuth();
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const toast = useToast();

  return useCallback((payload: P, options: InstantOptions<R>) => {
    const key = coreKey(tenant.slug);
    const update = (fn: (old: CoreData) => CoreData) => queryClient.setQueryData<CoreData>(key, (old) => (old ? fn(old) : old));

    const shown: Changes = {};
    const undo: Changes = {};
    const ids: string[] = [];
    Object.entries(options.show).forEach(([tab, rows]) => {
      if (!rows?.length) return;
      const before = new Map((options.previous?.[tab] ?? []).map((r) => [r.id, r]));
      shown[tab] = rows.map((r) => ({ ...r, _pending: true }));
      undo[tab] = rows.map((r) => before.get(r.id) ?? { id: r.id, deleted: true });
      ids.push(...rows.map((r) => r.id));
    });

    beginSave(ids);
    update((old) => applyChanges(old, shown));
    api<R>(action, payload).then(
      (result) => {
        endSave(ids);
        update((old) => applyChanges(applyChanges(old, undo), result.changes));
        options.onSuccess?.(result);
      },
      (error: unknown) => {
        endSave(ids);
        update((old) => applyChanges(old, undo));
        toast(`${options.failure}: ${errorMessage(error)}`, 'error');
        options.onError?.(error);
      },
    );
  }, [api, queryClient, tenant.slug, toast, action]);
}
