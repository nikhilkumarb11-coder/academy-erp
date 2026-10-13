import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { todayIso } from '../lib/dates';
import { useTenant } from '../tenant/TenantContext';
import { attendanceDayQuery, defaultAttendanceCourse } from './attendance';
import { useCoreData } from './useCoreData';

/** Fetches today's attendance for the usual course in the background, once per app start, so the screen opens filled. */
export function useWarmData(enabled: boolean) {
  const tenant = useTenant();
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const { data } = useCoreData();
  const done = useRef(false);
  const tables = data?.tables;

  useEffect(() => {
    if (!enabled || !tables || done.current || tenant.modules.attendance === false) return;
    const courseId = defaultAttendanceCourse(tables, tenant.slug);
    if (!courseId) return;
    const timer = setTimeout(() => {
      done.current = true;
      queryClient.prefetchQuery(attendanceDayQuery(api, tenant.slug, courseId, todayIso())).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [enabled, tables, tenant.slug, tenant.modules.attendance, api, queryClient]);
}
