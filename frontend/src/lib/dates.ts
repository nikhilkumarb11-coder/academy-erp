const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Local date as yyyy-mm-dd. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return todayIso(new Date(y, m - 1, d + days));
}

/** yyyy-mm (+n months). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** "Oct 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "13 Oct 2026" (or the input when it is not a date). */
export function formatDate(value: unknown): string {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Whole days from a to b (b − a), both yyyy-mm-dd. */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function weekdayShort(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short' });
}
