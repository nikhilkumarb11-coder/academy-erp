/**
 * Normalizes an Indian-style (or any) phone number to E.164 without spaces, e.g. "+919876543210".
 * Returns "" when the input has too few digits to be a phone number.
 */
export function normalizePhone(input: string, countryCode = '91'): string {
  const raw = (input || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const len = LOCAL_LENGTH[countryCode];
  const localOk = (local: string) => (len ? local.length === len : local.length >= 6 && local.length <= 12);

  if (raw.startsWith('+') || digits.startsWith('00')) {
    const intl = raw.startsWith('+') ? digits : digits.slice(2);
    if (intl.startsWith(countryCode)) return localOk(intl.slice(countryCode.length)) ? `+${intl}` : '';
    return intl.length >= 8 && intl.length <= 15 ? `+${intl}` : '';
  }

  const local = digits.replace(/^0+/, '');
  if (localOk(local)) return `+${countryCode}${local}`;
  if (local.startsWith(countryCode) && localOk(local.slice(countryCode.length))) return `+${local}`;
  return '';
}

/** Digits after the country code, where the length is fixed (India: 10-digit mobile numbers). Mirrors backend Validate.phone. */
export const LOCAL_LENGTH: Record<string, number> = { '91': 10 };

/** Message for a phone being typed that can no longer become valid (too many digits), or is complete-length but wrong. */
export function phoneProblem(input: string, countryCode = '91'): string | undefined {
  const digits = phoneDigits(input);
  const len = LOCAL_LENGTH[countryCode];
  if (!len || !digits || normalizePhone(input, countryCode)) return undefined;
  if (digits.replace(/^0+/, '').length >= len) return `Enter a ${len}-digit mobile number`;
  return undefined;
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
