import type { Course, Enrollment, FeePlan } from '../data/types';
import { num } from './values';

/** Monthly fee for an enrollment: the override when set, otherwise the course fee. Null when neither is set. */
export function monthlyFeeFor(course: Pick<Course, 'monthly_fee'> | undefined, enrollment?: Pick<Enrollment, 'monthly_fee_override'>): number | null {
  if (enrollment && enrollment.monthly_fee_override !== '' && enrollment.monthly_fee_override !== undefined) {
    return num(enrollment.monthly_fee_override);
  }
  if (!course || course.monthly_fee === '' || course.monthly_fee === undefined) return null;
  return num(course.monthly_fee);
}

/**
 * Amount billed per plan period (PRD §7 rule 1, generalized by fee plans):
 * monthly fee × months covered × (1 − discount%), rounded to the nearest rupee.
 */
export function planAmount(monthlyFee: number, plan: Pick<FeePlan, 'months_covered' | 'discount_pct'>): number {
  const months = Math.max(1, num(plan.months_covered, 1));
  const discount = Math.min(100, Math.max(0, num(plan.discount_pct, 0)));
  return Math.round(monthlyFee * months * (1 - discount / 100));
}

/** Short description of what a plan bills, e.g. "₹8,500 for 10 months (15% off)". */
export function describePlanAmount(monthlyFee: number | null, plan: FeePlan | undefined, symbol = '₹'): string {
  if (!plan) return '';
  if (monthlyFee === null) return 'Fee not set';
  const months = num(plan.months_covered, 1);
  const discount = num(plan.discount_pct, 0);
  const amount = formatMoney(planAmount(monthlyFee, plan), symbol);
  const period = months === 1 ? '/month' : ` for ${months} months`;
  return `${amount}${period}${discount > 0 ? ` (${discount}% off)` : ''}`;
}

export function formatMoney(amount: number, symbol = '₹'): string {
  return `${symbol}${Math.round(amount).toLocaleString('en-IN')}`;
}
