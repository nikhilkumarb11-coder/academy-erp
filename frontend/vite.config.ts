import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/** GitHub Pages serves 404.html for unknown paths; a copy of index.html makes deep links like /rays/students work. */
function spaFallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    closeBundle() {
      const out = resolve(import.meta.dirname, 'dist');
      copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
    },
  };
}

export default defineConfig({
  // '/' for a custom domain; '/<repo>/' for https://<user>.github.io/<repo>/
  base: process.env.VITE_BASE || '/',
  // The demo backend imports ../backend/*.js as text.
  server: { fs: { allow: ['..'] } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Manifests are per tenant (public/manifests/<slug>.webmanifest), linked at runtime.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/tenants/') || url.pathname.includes('/presets/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'tenant-config' },
          },
        ],
      },
    }),
    spaFallback(),
  ],
  test: {
    environment: 'node',
  },
});
