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
