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

/** Site-relative asset paths (logos, icons) resolved against the deploy base; full URLs pass through. */
export function assetUrl(path: string): string {
  if (!path || /^(https?:|data:)/.test(path)) return path;
  return `${BASE}${path.replace(/^\//, '')}`;
}

/** Absolute URL of an asset, for the server (receipt logo) which cannot resolve relative paths. */
export function absoluteAssetUrl(path: string): string {
  return path ? new URL(assetUrl(path), window.location.origin).href : '';
}

const cacheKey = (slug: string) => `erp:${slug}:tenant`;

export async function loadTenant(slug: string): Promise<TenantConfig> {
  const res = await fetch(`${BASE}tenants/${slug}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(res.status === 404 ? 'NOT_FOUND' : `HTTP_${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) throw new Error('NOT_FOUND');
  const config = (await res.json()) as TenantConfig;
  if (config.slug !== slug) throw new Error('NOT_FOUND');
  try {
    localStorage.setItem(cacheKey(slug), JSON.stringify(config));
  } catch {
    // storage full or blocked: the app still works, it just waits for the network next time
  }
  return config;
}

/** The config from the last successful load on this device, so the app can open before the network answers. */
export function cachedTenant(slug: string): TenantConfig | null {
  try {
    const config = JSON.parse(localStorage.getItem(cacheKey(slug)) ?? 'null') as TenantConfig | null;
    return config?.slug === slug ? config : null;
  } catch {
    return null;
  }
}
