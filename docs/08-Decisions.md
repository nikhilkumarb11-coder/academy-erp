# Decision Log

Short records of architecture decisions. Add new ones at the bottom; never edit accepted ones, supersede them instead.

---

### D1. Google Sheets + Apps Script, one copy per tenant
**Status:** Accepted (2026-10-13)
**Context:** We need zero hosting cost, data owned by each academy, a solo developer, and fewer than 15 tenants in the first year.
**Decision:** Each tenant gets its own Google account, spreadsheet and standalone Apps Script project, all running one shared codebase.
**Consequences:** Updates must be pushed to each tenant (`deploy-all`). Schema drift is controlled by `Schema.js` and `Migrate`. Revisit this decision at about 10–15 tenants or about 1,000 students in one tenant.

### D2. All sheet access through `Db`, mapped by header name
**Status:** Accepted
**Decision:** No other module calls `SpreadsheetApp` for data. Rows are objects keyed by header, and column order does not matter.
**Consequences:** Columns can be appended safely, and a later move to a database touches one module.

### D3. Stateless HMAC session tokens
**Status:** Accepted
**Decision:** The token is `base64url(payload).hmac`, with `role`, `sv` (session version) and `exp`. There is no session storage. A password change bumps `SESSION_VERSION`, which logs out every device.
**Consequences:** One device can't be logged out on its own (acceptable with a single shared login).

### D4. Cloudflare Worker for Razorpay webhooks
**Status:** Accepted
**Context:** Apps Script can't read headers (so no signature check) and answers with a 302, which Razorpay treats as a failure.
**Decision:** The Worker verifies the signature, replies 200, and forwards to the tenant with a per-tenant forward token. The tenant still confirms the payment through the Razorpay API, and reconciliation runs every 15 minutes.

### D5. Fee plans as data
**Status:** Accepted
**Decision:** `FeePlans` (months_covered, discount_pct) replaces the hard-coded Monthly/Annual rule. Rays' Annual plan = 10 months at 15%.

### D6. Payment allocations instead of comma-separated due IDs
**Status:** Accepted
**Decision:** A `PaymentAllocations` tab. An allocation with a blank `due_id` is an unapplied advance credit.
**Consequences:** Exact parent-level payments, advances, cancellations and balance-sheet figures.

### D7. Frontend: Vite + React + TypeScript + Tailwind, PWA, one build for all tenants
**Status:** Proposed (confirm at the start of phase 1)
**Decision:** One static build on GitHub Pages. The tenant is resolved from the URL path (`/rays`). `tenants/<slug>.json` supplies the branding, labels, modules and API URL. TanStack Query with IndexedDB persistence handles caching, offline use and optimistic updates.

### D8. Backend in plain Apps Script JavaScript (no bundler)
**Status:** Accepted
**Decision:** Files are pushed as-is with clasp. Modules are IIFE objects (`const Db = (() => {...})()`), and route registration is lazy so file load order never matters. Business logic that needs unit tests (the fee engine) lives in pure functions with no Apps Script calls, so Node can test them.
