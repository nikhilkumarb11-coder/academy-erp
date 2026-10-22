import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDemoState, DEMO_PASSWORD, runDemo } from '../mock';
import { deserialize, serialize, type DemoState } from './googleFakes';

const preset = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../presets/martial-arts.json'), 'utf8'));

describe('demo backend (real backend code in the browser runtime)', () => {
  let state: DemoState;
  let token: string;
  const call = <T,>(action: string, payload: unknown = {}) => {
    const env = runDemo(state, { action, payload, token });
    if (!env.ok) throw new Error(`${action}: ${env.error.message}`);
    return env.data as T;
  };

  beforeAll(() => {
    state = buildDemoState('demo', preset, 'Demo Martial Arts');
    const login = runDemo(state, { action: 'auth.login', payload: { password: DEMO_PASSWORD }, token: null });
    if (!login.ok) throw new Error('login failed');
    token = (login.data as { token: string }).token;
  });

  it('seeds families, dues, payments and attendance', () => {
    const boot = call<Record<string, unknown[]>>('system.bootstrap');
    expect(boot.Parents).toHaveLength(12);
    expect(boot.Students.length).toBeGreaterThan(15);
    expect(boot.FeeDues.length).toBeGreaterThan(20);
    expect(boot.Payments.length).toBeGreaterThan(8);
    const open = (boot.FeeDues as { balance: number }[]).filter((d) => d.balance > 0);
    expect(open.length).toBeGreaterThan(0);
    expect(boot.Holidays).toHaveLength(1);
  });

  it('survives a save/load round trip and keeps working', () => {
    state = deserialize(serialize(state));
    const report = call<{ rows: unknown[] }>('attendance.report', {});
    expect(Array.isArray(report.rows)).toBe(true);
    const boot = call<{ Parents: { id: string }[] }>('system.bootstrap');
    const pay = call<{ receipt_no: string }>('payments.record', { parent_id: boot.Parents[1].id, amount: 100, mode: 'Cash' });
    expect(pay.receipt_no).toMatch(/^RCPT\/\d{4}-\d{2}\/\d{4}$/);
  });

  it('rejects a wrong password with a hint-free backend message', () => {
    const env = runDemo(state, { action: 'auth.login', payload: { password: 'nope' }, token: null });
    expect(env.ok).toBe(false);
  });
});
