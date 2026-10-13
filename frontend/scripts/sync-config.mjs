/**
 * Copies ../tenants/*.json and ../presets/*.json into public/ (git-ignored copies) and
 * writes one PWA manifest per tenant so each academy installs with its own name and colours.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

mkdirSync(join(pub, 'manifests'), { recursive: true });
for (const f of tenants) {
  const t = JSON.parse(readFileSync(join(repo, 'tenants', f), 'utf8'));
  const manifest = {
    name: t.name,
    short_name: t.shortName || t.name,
    start_url: `../${t.slug}/`,
    scope: `../${t.slug}/`,
    display: 'standalone',
    background_color: t.theme?.background || '#FAF7F0',
    theme_color: t.theme?.primary || '#0B1F3A',
    icons: [{ src: '../icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
  writeFileSync(join(pub, 'manifests', `${t.slug}.webmanifest`), JSON.stringify(manifest, null, 2));
}

console.log(`sync-config: ${tenants.length} tenant(s): ${tenants.map((f) => f.replace('.json', '')).join(', ')}`);
