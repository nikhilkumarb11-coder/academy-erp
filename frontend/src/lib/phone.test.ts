import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone, phoneProblem } from './phone';

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

  it('rejects Indian numbers that are not exactly 10 digits', () => {
    expect(normalizePhone('12345')).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('987654321')).toBe('');
    expect(normalizePhone('98765432101')).toBe('');
    expect(normalizePhone('8888888888888888')).toBe('');
    expect(normalizePhone('+91 98765 432101')).toBe('');
  });

  it('explains the problem once enough digits are typed', () => {
    expect(phoneProblem('98765')).toBeUndefined();
    expect(phoneProblem('9876543210')).toBeUndefined();
    expect(phoneProblem('98765432101')).toBe('Enter a 10-digit mobile number');
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
