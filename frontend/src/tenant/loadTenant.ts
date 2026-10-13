import type { TenantConfig } from './types';

const BASE = import.meta.env.BASE_URL; // always ends with '/'

/** First path segment after the deploy base, e.g. /rays/students -> "rays". */
export function slugFromLocation(pathname: string = window.location.pathname): string | null {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '');
  const slug = rest.split('/')[0]?.toLowerCase() ?? '';
  return /^[a-z0-9-]{2,40}$/.test(slug) ? slug : null;
}

export function tenantBasePath(slug: string): string {
  return `${BASE}${slug}`;
}

export async function loadTenant(slug: string): Promise<TenantConfig> {
  const res = await fetch(`${BASE}tenants/${slug}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(res.status === 404 ? 'NOT_FOUND' : `HTTP_${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) throw new Error('NOT_FOUND');
  const config = (await res.json()) as TenantConfig;
  if (config.slug !== slug) throw new Error('NOT_FOUND');
  return config;
}
