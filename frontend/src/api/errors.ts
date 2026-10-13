export type ApiErrorCode =
  | 'AUTH'
  | 'LOCKED'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSY'
  | 'SCHEMA'
  | 'CONFIG'
  | 'SERVER'
  | 'UNKNOWN_ACTION'
  | 'BAD_REQUEST'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'NOT_CONFIGURED';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  /** Worth retrying automatically without user action. */
  get transient(): boolean {
    return this.code === 'BUSY' || this.code === 'NETWORK' || this.code === 'TIMEOUT';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK') return 'You appear to be offline. Changes will sync when you reconnect.';
    if (error.code === 'TIMEOUT') return 'The server took too long to respond. Please retry.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}
