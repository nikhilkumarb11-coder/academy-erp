import type { ApiCall } from '../api/client';
import type { AttendanceMark, CoreTables } from './types';
import { bool, isDeleted } from '../lib/values';

export const LAST_COURSE = 'erp:attendance:course';

export function activeCourses(t: CoreTables) {
  return t.Courses.filter((c) => bool(c.active) && !isDeleted(c)).sort((a, b) => a.name.localeCompare(b.name));
}

/** The course the Attendance screen opens on: the last one saved on this device, else the first. */
export function defaultAttendanceCourse(t: CoreTables, slug: string): string {
  const courses = activeCourses(t);
  const saved = localStorage.getItem(`${LAST_COURSE}:${slug}`) ?? '';
  return courses.some((c) => c.id === saved) ? saved : courses[0]?.id ?? '';
}

export function attendanceDayQuery(api: ApiCall, slug: string, courseId: string, date: string) {
  return {
    queryKey: ['attendance', slug, courseId, date] as const,
    queryFn: () => api<{ marks: AttendanceMark[] }>('attendance.day', { course_id: courseId, date }),
    staleTime: 30_000,
  };
}

export function attendanceMonthQuery(api: ApiCall, slug: string, month: string, courseId = '') {
  return {
    queryKey: ['attendance-report', slug, month, courseId] as const,
    queryFn: () => api<{ rows: AttendanceMark[] }>('attendance.report', { month, course_id: courseId }),
    staleTime: 60_000,
  };
}
