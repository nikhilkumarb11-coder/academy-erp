/**
 * Demo backend (tenant apiUrl = "mock"): runs the real Apps Script code from backend/ in the browser
 * against fake Google services, with the spreadsheet kept in localStorage. Every action, validation
 * and fee rule is therefore exactly what a real academy gets.
 */
import { del } from 'idb-keyval';
import type { ApiEnvelope, ApiRequest, Transport } from './client';
import { deserialize, emptyState, googleServices, serialize, type DemoState } from './demo/googleFakes';
import { seedDemo } from './demo/seedDemo';

export const DEMO_PASSWORD = 'demo1234';
const LATENCY_MS = 150;

const sources = import.meta.glob('../../../backend/**/*.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Same order as tests/backend/harness.mjs: schema, core (Util first), api, entry points. */
function rank(path: string) {
  if (path.endsWith('/Schema.js')) return 0;
  if (path.endsWith('/core/Util.js')) return 1;
  if (path.includes('/core/')) return 2;
  if (path.includes('/api/')) return 3;
  return 4;
}

const SOURCE = Object.keys(sources)
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  .map((p) => `// ---- ${p}\n${sources[p]}`)
  .join('\n');

type Services = ReturnType<typeof googleServices>;
type Execution = { doPost: (e: unknown) => { getContent(): string }; setupTenant: () => void };
const SERVICE_NAMES = Object.keys(googleServices(emptyState('x'))) as (keyof Services)[];

let compiled: ((...services: unknown[]) => Execution) | null = null;

/** A fresh execution (module state reset), like a new Apps Script invocation. */
function execution(state: DemoState): Execution {
  compiled ??= new Function(...SERVICE_NAMES, `${SOURCE}\n;return { doPost, setupTenant };`) as (...services: unknown[]) => Execution;
  const services = googleServices(state);
  return compiled(...SERVICE_NAMES.map((n) => services[n]));
}

export function runDemo(state: DemoState, request: Omit<ApiRequest, 'device'> & { device?: string }): ApiEnvelope {
  const out = execution(state).doPost({ postData: { contents: JSON.stringify({ device: 'demo', ...request }) } });
  return JSON.parse(out.getContent()) as ApiEnvelope;
}

const storageKey = (slug: string) => `erp:${slug}:demo-backend`;

/** A set-up, fully seeded demo spreadsheet. */
export function buildDemoState(slug: string, preset: { id: string }, academyName: string): DemoState {
  const state = emptyState(`demo-${slug}`);
  state.props.SPREADSHEET_ID = state.spreadsheetId;
  state.props.INITIAL_PASSWORD = DEMO_PASSWORD;
  execution(state).setupTenant();
  seedDemo((action, payload, token) => {
    const env = runDemo(state, { action, payload, token: token ?? null });
    if (!env.ok) throw new Error(`Demo seed failed at ${action}: ${env.error.message}`);
    return env.data;
  }, { preset, academyName, password: DEMO_PASSWORD });
  return state;
}

async function create(slug: string, presetId: string, academyName: string): Promise<DemoState> {
  const res = await fetch(`${import.meta.env.BASE_URL}presets/${presetId}.json`);
  return buildDemoState(slug, await res.json(), academyName);
}

export function createMockTransport(slug: string, presetId: string, academyName: string): Transport {
  let statePromise: Promise<DemoState> | null = null;

  function load() {
    if (!statePromise) {
      localStorage.removeItem(`erp:${slug}:mockdb`); // previous demo format
      const saved = localStorage.getItem(storageKey(slug));
      statePromise = saved
        ? Promise.resolve(deserialize(saved))
        : create(slug, presetId, academyName).then((s) => { save(s); return s; });
    }
    return statePromise;
  }

  function save(state: DemoState) {
    try {
      localStorage.setItem(storageKey(slug), serialize(state));
    } catch {
      // Storage full: the demo keeps working for this session.
    }
  }

  return async (request: ApiRequest): Promise<ApiEnvelope> => {
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    const state = await load();
    const envelope = runDemo(state, request);
    save(state);
    if (!envelope.ok && envelope.error.code === 'AUTH' && request.action === 'auth.login') {
      return { ...envelope, error: { ...envelope.error, message: `${envelope.error.message} (demo password: ${DEMO_PASSWORD})` } };
    }
    return envelope;
  };
}

/** HTML of a receipt "uploaded" by the demo backend (its Drive URLs look like demo-receipt:<id>). */
export function demoReceiptHtml(slug: string, url: string): string | null {
  const saved = localStorage.getItem(storageKey(slug));
  if (!saved || !url.startsWith('demo-receipt:')) return null;
  return deserialize(saved).files[url.slice('demo-receipt:'.length)]?.html ?? null;
}

/** Clears the demo database and the device cache, then reloads so everything re-seeds. */
export async function resetMockDb(slug: string) {
  localStorage.removeItem(storageKey(slug));
  localStorage.removeItem(`erp:${slug}:mockdb`);
  await del(`erp:${slug}:query-cache`);
  window.location.reload();
}
