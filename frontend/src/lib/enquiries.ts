import type { CoreTables, Enquiry } from '../data/types';

export const isOpenEnquiry = (q: Enquiry) => q.status !== 'Converted' && q.status !== 'Lost';

/** Open enquiries whose follow-up (or trial) date has arrived; those without a date count from the day they came in. */
export const needsFollowUp = (q: Enquiry, today: string) =>
  isOpenEnquiry(q) && (q.next_followup_date || q.trial_date || q.enquiry_date) <= today;

export function courseNames(t: Pick<CoreTables, 'Courses'>, ids: string): string {
  return ids.split(',').map((id) => t.Courses.find((c) => c.id === id.trim())?.name).filter(Boolean).join(', ');
}
