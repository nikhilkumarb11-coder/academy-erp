import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTenant } from '../tenant/TenantContext';
import { applyChanges, type Changes } from './merge';
import type { CoreData, MessageLogRow, TemplateType } from './types';
import { coreKey } from './useCoreData';

export const messagesKey = (slug: string) => ['messages', slug] as const;

/** Messages sent in the last `days` days, newest first. */
export function useRecentMessages(days = 60) {
  const tenant = useTenant();
  const { api } = useAuth();
  return useQuery({
    queryKey: [...messagesKey(tenant.slug), days],
    queryFn: async () => (await api<{ rows: MessageLogRow[] }>('messages.recent', { days })).rows,
    staleTime: 60_000,
  });
}

export interface LogEntry {
  type: TemplateType;
  preview: string;
  parent_id?: string;
  student_id?: string;
  template_id?: string;
  group_id?: string;
  channel?: 'WhatsApp' | 'Copy';
}

/**
 * Records messages the user just sent. Fire-and-forget: the message has already left through
 * WhatsApp, so a failed log must never interrupt the user.
 */
export function useLogMessages() {
  const tenant = useTenant();
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useCallback((entries: LogEntry[]) => {
    api<{ logged: MessageLogRow[]; changes: Changes }>('messages.log', { entries })
      .then((res) => {
        queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? applyChanges(old, res.changes) : old));
        queryClient.setQueriesData<MessageLogRow[]>({ queryKey: messagesKey(tenant.slug) }, (old) => (old ? [...[...res.logged].reverse(), ...old] : old));
      })
      .catch(() => undefined);
  }, [api, queryClient, tenant.slug]);
}
