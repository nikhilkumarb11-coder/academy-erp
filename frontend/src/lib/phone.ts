/**
 * Normalizes an Indian-style (or any) phone number to E.164 without spaces, e.g. "+919876543210".
 * Returns "" when the input has too few digits to be a phone number.
 */
export function normalizePhone(input: string, countryCode = '91'): string {
  const raw = (input || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (raw.startsWith('+')) return digits.length >= 8 ? `+${digits}` : '';
  if (digits.startsWith('00')) return digits.length >= 10 ? `+${digits.slice(2)}` : '';

  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) return `+${countryCode}${digits}`;
  if (digits.startsWith(countryCode) && digits.length === countryCode.length + 10) return `+${digits}`;
  return digits.length >= 8 ? `+${countryCode}${digits}` : '';
}

/** Digits only, for wa.me links and search matching. */
export function phoneDigits(input: string): string {
  return (input || '').replace(/\D/g, '');
}

/** "+919876543210" -> "+91 98765 43210" for display. */
export function formatPhone(e164: string, countryCode = '91'): string {
  const digits = phoneDigits(e164);
  if (digits.startsWith(countryCode) && digits.length === countryCode.length + 10) {
    const local = digits.slice(countryCode.length);
    return `+${countryCode} ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  return e164;
}
