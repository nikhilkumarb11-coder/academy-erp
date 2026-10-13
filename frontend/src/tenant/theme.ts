import { assetUrl } from './loadTenant';
import type { TenantConfig } from './types';

/** Applies tenant branding as CSS variables, loads its fonts, and links its PWA manifest. */
export function applyTenantBranding(tenant: TenantConfig) {
  const root = document.documentElement;
  const t = tenant.theme;
  root.style.setProperty('--tenant-primary', t.primary);
  root.style.setProperty('--tenant-accent', t.accent);
  root.style.setProperty('--tenant-background', t.background);
  root.style.setProperty('--tenant-surface', t.surface);
  root.style.setProperty('--tenant-font-heading', `"${t.fontHeading}"`);
  root.style.setProperty('--tenant-font-body', `"${t.fontBody}"`);

  document.title = tenant.name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.primary);

  loadGoogleFonts([t.fontHeading, t.fontBody]);
  linkManifest(tenant.slug);
  if (tenant.icons) {
    const dir = assetUrl(tenant.icons.endsWith('/') ? tenant.icons : `${tenant.icons}/`);
    setLink('icon', `${dir}icon-192.png`, 'image/png');
    setLink('apple-touch-icon', `${dir}apple-touch-icon.png`);
    setMeta('apple-mobile-web-app-title', tenant.shortName || tenant.name);
  }
}

function setLink(rel: string, href: string, type?: string) {
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  if (type) link.type = type;
  else link.removeAttribute('type');
  link.href = href;
}

function setMeta(name: string, content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function loadGoogleFonts(families: string[]) {
  const id = 'tenant-fonts';
  if (document.getElementById(id)) return;
  const query = [...new Set(families)]
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
    .join('&');
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  document.head.appendChild(link);
}

function linkManifest(slug: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  link.href = `${import.meta.env.BASE_URL}manifests/${slug}.webmanifest`;
}
