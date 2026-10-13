# Frontend

Vite + React 19 + TypeScript + Tailwind v4, a PWA. TanStack Query caches data and persists it to IndexedDB.

## Run locally
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173/demo/  (password: demo1234)
npm test           # unit tests
npm run build      # production build into dist/
```
`npm run dev` and `npm run build` first run `scripts/sync-config.mjs`. It copies `../tenants/*.json` and `../presets/*.json` into `public/`, and writes one PWA manifest per tenant.

## How tenants work
- The URL decides the academy: `/<slug>/...`. The root `/` asks for an academy code.
- The app loads `tenants/<slug>.json` and applies the theme colours and fonts as CSS variables. Its labels (for example Course → Program) and module switches are used across the UI.
- `apiUrl` can take three values:
  - The Apps Script `/exec` URL: the real backend.
  - `"mock"`: an in-browser demo backend in `src/api/mock.ts`, seeded from the tenant's preset and stored in localStorage.
  - Empty: shows "not connected yet".

## Data flow
- **Login** gets a signed token, stored in localStorage separately for each academy.
- **Core data** (students, parents, courses, enrollments, settings and so on) comes from `system.bootstrap` once. After that, `system.sync` fetches only changed rows every 60 seconds and on window focus (`src/data/useCoreData.ts`).
- **The cache is saved to IndexedDB for each academy**, so screens render instantly after a reload or while offline.
- **API calls** (`src/api/client.ts`) send `POST` with `text/plain` to avoid a CORS pre-flight request. `BUSY` (lock contention) is retried with back-off. `AUTH` logs the user out.

## Layout
| Path | What |
|---|---|
| `src/tenant/` | Tenant config loading, branding, labels and modules context |
| `src/api/` | API client, errors, mock backend |
| `src/auth/` | Session storage, `AuthProvider` |
| `src/data/` | Row types (mirroring `backend/Schema.js`), delta merge, query client, `useCoreData` |
| `src/layout/` | App shell (desktop sidebar, mobile bottom tabs), global search, sync status, version banner |
| `src/pages/` | Screens. Unfinished ones render `ComingSoonPage`. |
| `src/components/ui.tsx` | Shared UI pieces: buttons, cards, fields, alerts |

## Deploy
`.github/workflows/deploy-frontend.yml` builds and publishes to GitHub Pages on every push to `main`. For a project site, the base path defaults to `/<repo>/`. For a custom domain, set the repository variable `PAGES_BASE` to `/`.
