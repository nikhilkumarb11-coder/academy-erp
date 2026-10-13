import { describe, expect, it } from 'vitest';
import { describePlanAmount, formatMoney, monthlyFeeFor, planAmount } from './fees';
import type { FeePlan } from '../data/types';

const plan = (months: number, discount: number) => ({ months_covered: months, discount_pct: discount }) as FeePlan;

describe('planAmount', () => {
  it('PRD §10: annual enrolment of a ₹1,000/month course is ₹8,500', () => {
    expect(planAmount(1000, plan(10, 15))).toBe(8500);
  });

  it('monthly plan is the monthly fee', () => {
    expect(planAmount(1200, plan(1, 0))).toBe(1200);
  });

  it('rounds to the nearest rupee', () => {
    expect(planAmount(999, plan(3, 5))).toBe(2847); // 2847.15
  });

  it('treats blank values safely', () => {
    expect(planAmount(500, { months_covered: '', discount_pct: '' } as unknown as FeePlan)).toBe(500);
  });
});

describe('monthlyFeeFor', () => {
  it('prefers the enrolment override, including an explicit zero', () => {
    expect(monthlyFeeFor({ monthly_fee: 1000 }, { monthly_fee_override: 800 })).toBe(800);
    expect(monthlyFeeFor({ monthly_fee: 1000 }, { monthly_fee_override: 0 })).toBe(0);
    expect(monthlyFeeFor({ monthly_fee: 1000 }, { monthly_fee_override: '' })).toBe(1000);
  });

  it('returns null when the course fee is not set yet', () => {
    expect(monthlyFeeFor({ monthly_fee: '' })).toBeNull();
  });
});

describe('describePlanAmount', () => {
  it('describes monthly and multi-month plans', () => {
    expect(describePlanAmount(1000, { ...plan(1, 0), name: 'Monthly' } as FeePlan)).toBe('₹1,000/month');
    expect(describePlanAmount(1000, plan(10, 15))).toBe('₹8,500 for 10 months (15% off)');
    expect(describePlanAmount(null, plan(1, 0))).toBe('Fee not set');
  });

  it('formats Indian digit grouping', () => {
    expect(formatMoney(125000)).toBe('₹1,25,000');
  });
});
