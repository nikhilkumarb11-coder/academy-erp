/**
 * Copies ../tenants/*.json and ../presets/*.json into public/ (git-ignored copies) and
 * writes one PWA manifest per tenant so each academy installs with its own name and colours.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const pub = join(root, 'public');

function copyJsonDir(name, filter = () => true) {
  const src = join(repo, name);
  const dest = join(pub, name);
  mkdirSync(dest, { recursive: true });
  const files = readdirSync(src).filter((f) => f.endsWith('.json') && filter(f));
  for (const f of files) {
    const json = JSON.parse(readFileSync(join(src, f), 'utf8'));
    writeFileSync(join(dest, f), JSON.stringify(json));
  }
  return files;
}

const tenants = copyJsonDir('tenants', (f) => !f.startsWith('_'));
copyJsonDir('presets');

// Logos and app icons (tenants/branding/<slug>/) are served as branding/<slug>/.
const branding = join(repo, 'tenants', 'branding');
if (existsSync(branding)) cpSync(branding, join(pub, 'branding'), { recursive: true });

function iconsFor(t) {
  const dir = t.icons ? t.icons.replace(/^\/|\/$/g, '') : '';
  const has = (file) => dir && existsSync(join(pub, dir, file));
  if (!has('icon-192.png') || !has('icon-512.png')) {
    return [{ src: '../icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];
  }
  const icons = [
    { src: `../${dir}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `../${dir}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
  ];
  if (has('maskable-512.png')) icons.push({ src: `../${dir}/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  return icons;
}

mkdirSync(join(pub, 'manifests'), { recursive: true });
for (const f of tenants) {
  const t = JSON.parse(readFileSync(join(repo, 'tenants', f), 'utf8'));
  const manifest = {
    name: t.name,
    short_name: t.shortName || t.name,
    description: t.tagline || `${t.name} management app`,
    id: `../${t.slug}/`,
    start_url: `../${t.slug}/`,
    // No trailing slash: the dashboard's URL is /<slug>, and anything outside the scope shows the browser bar.
    scope: `../${t.slug}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: t.theme?.background || '#FAF7F0',
    theme_color: t.theme?.primary || '#0B1F3A',
    icons: iconsFor(t),
  };
  writeFileSync(join(pub, 'manifests', `${t.slug}.webmanifest`), JSON.stringify(manifest, null, 2));
}

console.log(`sync-config: ${tenants.length} tenant(s): ${tenants.map((f) => f.replace('.json', '')).join(', ')}`);
