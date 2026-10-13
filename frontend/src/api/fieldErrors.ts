import { ApiError } from './errors';

/** The field a VALIDATION/CONFLICT error points at (details.field), e.g. "students.0.name". */
export function errorField(error: unknown): string | undefined {
  if (error instanceof ApiError && error.details && typeof error.details === 'object' && 'field' in error.details) {
    return String((error.details as { field: unknown }).field);
  }
  return undefined;
}

/** Message to show under a given field, if the error is about that field. */
export function fieldError(error: unknown, field: string): string | undefined {
  return errorField(error) === field && error instanceof ApiError ? error.message : undefined;
}
