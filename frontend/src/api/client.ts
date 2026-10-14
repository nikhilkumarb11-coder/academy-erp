import { ApiError, type ApiErrorCode } from './errors';
import type { TenantConfig } from '../tenant/types';

export interface ApiClientOptions {
  tenant: Pick<TenantConfig, 'apiUrl' | 'slug' | 'preset' | 'name'>;
  getToken: () => string | null;
  onAuthError: () => void;
  /** Overridable for tests. */
  transport?: Transport;
  retryDelaysMs?: number[];
}

export type Transport = (request: ApiRequest) => Promise<ApiEnvelope>;

export interface ApiRequest {
  action: string;
  token: string | null;
  payload: unknown;
  device: string;
}

export type ApiEnvelope =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: ApiErrorCode; message: string; details?: unknown } };

export type ApiCall = <T>(action: string, payload?: unknown) => Promise<T>;

const TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAYS = [500, 1000, 2000];

export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} / ${browser}`;
}

/** Apps Script transport: text/plain avoids a CORS preflight that Apps Script cannot answer. */
export function httpTransport(apiUrl: string): Transport {
  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(request),
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) throw new ApiError('SERVER', `Server returned HTTP ${res.status}`);
      return (await res.json()) as ApiEnvelope;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') throw new ApiError('TIMEOUT', 'Request timed out');
      throw new ApiError('NETWORK', 'Network unavailable');
    } finally {
      clearTimeout(timer);
    }
  };
}

const WARM_EVERY_MS = 120_000;
let lastWarm = 0;

/**
 * Wakes the Apps Script runtime with a cheap GET (doGet opens no spreadsheet), so the login that
 * follows skips most of the cold start. The response is opaque and ignored.
 */
export function warmServer(apiUrl: string) {
  if (!/^https:\/\//.test(apiUrl) || Date.now() - lastWarm < WARM_EVERY_MS) return;
  lastWarm = Date.now();
  fetch(apiUrl, { method: 'GET', mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createApiClient(options: ApiClientOptions): ApiCall {
  const { tenant, getToken, onAuthError } = options;
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  let transport = options.transport;

  async function resolveTransport(): Promise<Transport> {
    if (transport) return transport;
    if (!tenant.apiUrl) {
      throw new ApiError('NOT_CONFIGURED', 'This academy has not been connected to its server yet.');
    }
    if (tenant.apiUrl === 'mock') {
      const { createMockTransport } = await import('./mock');
      transport = createMockTransport(tenant.slug, tenant.preset, tenant.name);
    } else {
      transport = httpTransport(tenant.apiUrl);
    }
    return transport;
  }

  return async function call<T>(action: string, payload: unknown = {}): Promise<T> {
    const send = await resolveTransport();
    const request: ApiRequest = { action, token: getToken(), payload, device: deviceLabel() };

    for (let attempt = 0; ; attempt++) {
      try {
        const envelope = await send(request);
        if (envelope.ok) return envelope.data as T;
        throw new ApiError(envelope.error.code, envelope.error.message, envelope.error.details);
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : new ApiError('SERVER', String(err));
        if (apiErr.code === 'AUTH' && action !== 'auth.login') onAuthError();
        // Only BUSY (lock contention) is retried: the server rejected before writing, so a retry is safe.
        if (apiErr.code === 'BUSY' && attempt < retryDelays.length) {
          await sleep(retryDelays[attempt]);
          continue;
        }
        throw apiErr;
      }
    }
  };
}
