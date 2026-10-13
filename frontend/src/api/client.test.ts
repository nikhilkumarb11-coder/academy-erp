import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiEnvelope, type Transport } from './client';
import { ApiError } from './errors';

const tenant = { apiUrl: 'https://example.test/exec', slug: 't', preset: 'p', name: 'Test Academy' };

function client(transport: Transport, onAuthError = vi.fn()) {
  return {
    call: createApiClient({ tenant, getToken: () => 'tok', onAuthError, transport, retryDelaysMs: [0, 0, 0] }),
    onAuthError,
  };
}

const ok = (data: unknown): ApiEnvelope => ({ ok: true, data });
const fail = (code: string, message = code): ApiEnvelope => ({ ok: false, error: { code: code as never, message } });

describe('createApiClient', () => {
  it('sends action, token and payload, and unwraps data', async () => {
    const transport = vi.fn<Transport>(async () => ok({ hello: 'world' }));
    const { call } = client(transport);
    await expect(call('system.ping', { a: 1 })).resolves.toEqual({ hello: 'world' });
    expect(transport.mock.calls[0][0]).toMatchObject({ action: 'system.ping', token: 'tok', payload: { a: 1 } });
  });

  it('retries BUSY (lock contention) and then succeeds', async () => {
    const transport = vi.fn<Transport>().mockResolvedValueOnce(fail('BUSY')).mockResolvedValueOnce(fail('BUSY')).mockResolvedValueOnce(ok(42));
    const { call } = client(transport);
    await expect(call('x')).resolves.toBe(42);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('gives up after the retry budget', async () => {
    const transport = vi.fn<Transport>(async () => fail('BUSY'));
    const { call } = client(transport);
    await expect(call('x')).rejects.toMatchObject({ code: 'BUSY' });
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('does not retry validation errors', async () => {
    const transport = vi.fn<Transport>(async () => fail('VALIDATION', 'Missing: phone'));
    const { call } = client(transport);
    await expect(call('x')).rejects.toBeInstanceOf(ApiError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('logs out on AUTH errors, except for a failed login attempt', async () => {
    const transport = vi.fn<Transport>(async () => fail('AUTH'));
    const { call, onAuthError } = client(transport);
    await expect(call('auth.login')).rejects.toMatchObject({ code: 'AUTH' });
    expect(onAuthError).not.toHaveBeenCalled();
    await expect(call('system.bootstrap')).rejects.toMatchObject({ code: 'AUTH' });
    expect(onAuthError).toHaveBeenCalledOnce();
  });

  it('reports a missing backend clearly', async () => {
    const call = createApiClient({ tenant: { ...tenant, apiUrl: '' }, getToken: () => null, onAuthError: () => {} });
    await expect(call('system.ping')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
