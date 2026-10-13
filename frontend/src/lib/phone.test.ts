import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['0091 9876543210', '+919876543210'],
    ['+1 415 555 0100', '+14155550100'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('rejects inputs that are too short', () => {
    expect(normalizePhone('12345')).toBe('');
    expect(normalizePhone('')).toBe('');
  });

  it('uses the tenant country code', () => {
    expect(normalizePhone('501234567', '971')).toBe('+971501234567');
  });
});

describe('formatPhone', () => {
  it('groups Indian mobile numbers', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
  });
});
