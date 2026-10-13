/** Normalizes Sheets values (true / "TRUE" / "" etc.). */
export function bool(value: unknown): boolean {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

export function num(value: unknown, fallback = 0): number {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseExtra(extra: unknown): Record<string, unknown> {
  if (!extra || typeof extra !== 'string') return {};
  try {
    const parsed = JSON.parse(extra);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function isDeleted(row: object): boolean {
  return bool((row as { deleted?: unknown }).deleted);
}
