# Academy ERP: Development and Execution Plan

**Product:** a management app for activity academies (martial arts, dance, music, chess, abacus, multi-activity centres and tuition), sold to many institutions.
**First customer (tenant #1):** Rays Academy. See `../Rays_Academy_PRD.md`.
**Builder:** one developer, with AI assistance.
**Approach:** Google Sheets + Apps Script, with **one copy per institution** (tenant), one shared frontend, and one shared codebase.

---

## 1. Architecture

```text
                 ┌──────────────────────────────┐
 Browser/PWA ──► │ One frontend (GitHub Pages)  │  app.<brand>.in/rays
                 │ loads tenants/rays.json      │  → branding, labels, modules, apiUrl
                 └──────────────┬───────────────┘
                                │ POST, Content-Type: text/plain, JSON body
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
 Rays: Apps Script +      Academy B: Apps Script +   Academy C: ...
 Sheet + Drive folder     Sheet + Drive folder
        ▲
        │ verified webhook, forwarded
 ┌──────┴────────────────────────────┐
 │ Cloudflare Worker (free tier)     │ ◄── Razorpay webhooks: /rzp/{tenant}
 │ checks signature, replies 200     │
 └───────────────────────────────────┘
```

### Ground rules
1. **One codebase.** Never fork the code for a customer. Customer differences live in `tenants/<slug>.json` (public: branding and API URL), in the Sheet's `Settings` tab (business rules), and in the seed data from `presets/`.
2. **One Google account per tenant.** Apps Script quotas are counted per account, so this keeps them separate, and the institution can take its data if it leaves.
3. **Standalone Apps Script project per tenant.** The project points at the tenant's spreadsheet through the `SPREADSHEET_ID` Script Property. Updates are pushed with `clasp`, always reusing the same deployment ID so the web app URL never changes.
4. **Schema sync and migrations.** `backend/Schema.js` is the single source of truth for tabs and columns. `migrate()` adds missing tabs and columns (it never removes any) and runs pending data migrations. Running it repeatedly is safe.
5. **Secrets live only in Script Properties** (and Worker secrets). Nothing secret goes in git or in the frontend.
6. **All sheet access goes through `backend/core/Db.js`**, which reads and writes in batches under `LockService`. This also keeps a later move to a database contained.

---

## 2. Phases (one developer)

| Phase | Weeks | Deliverables | Exit criteria |
|---|---|---|---|
| 0. Setup and decisions | 1 | Plan, PRD addendum, schema, API contract, screen list, owner-input checklist, repository skeleton, `demo` tenant config | Docs approved; owner inputs requested |
| 1. Foundation | 2.5 | API router, auth with session token, Db layer and locking, migrations, tenant config and theming, app shell (sidebar on desktop, bottom tabs on mobile), IndexedDB cache, bootstrap and delta sync | Log in on the demo tenant from a phone and a desktop, then see the empty shell |
| 2. Core records | 2 | Categories, courses, batches, fee plans; parent with siblings; students; enrollments; student profile; global search | Admit 2 children × 2 courses in under 2 minutes on a phone |
| 3. Operations | 3 | Attendance; dues engine (monthly, annual, one-time charges, advances, partial payments, waivers); manual payments; receipt PDFs and sharing | Annual plan on Rs 1,000/month = Rs 8,500; 25-student attendance in under 30 seconds |
| 4. Payments and WhatsApp | 2 | Razorpay links, webhook Worker, reconciliation, payments feed, templates, reminder queue | Test payment updates the due automatically; a duplicate webhook is ignored |
| 5. Business | 2 | Enquiries, expenses, P&L, cash flow, balance sheet, dashboard | Reports reconcile with the Payments and Expenses tabs |
| 6. Rays go-live | 1.5 | Import from registers, testing on real devices, owner training, short period running alongside paper | Rays uses the app daily |
| 7. Replication kit | 2–3 | `new-tenant`, `deploy-all` and `health` scripts; presets; Excel student import; onboarding runbook; demo site | New academy live in under 2 hours |
| 8. Second academy | ongoing | Onboard an academy of a different type and turn its feedback into settings | Second tenant live with no code fork |

**Total:** about 17–19 weeks. Rays Academy goes live around week 12.

---

## 3. Release process (once there is more than one tenant)

1. Merge to `main`, then `deploy` to the **demo** tenant and run the smoke test.
2. Run `deploy-all`. For each tenant, it runs `clasp push`, then `clasp deploy -i <deploymentId>`, then the `system.migrate` action, then a smoke test (`system.ping` checks `apiVersion` and `schemaVersion`).
3. Publish the frontend. If the backend's `apiVersion` doesn't match what the frontend expects, the frontend shows "Update available, please refresh".
4. The frontend must stay compatible with one previous backend version, so tenants can be updated one at a time.

---

## 4. Quality gates

- **Fee engine unit tests.** Pure JavaScript, so they run in Node without Apps Script.
- **Idempotency test:** posting the same webhook twice records one payment.
- **Migration test:** `migrate()` on an up-to-date sheet changes nothing.
- **Smoke test** against every tenant after each deploy.
- **Playwright tests** at a mobile screen size for each acceptance criterion in PRD §10 (phase 6 onwards).

---

## 5. Known limits and when to rethink the architecture

- Protect header rows. Only migrations may change columns; manual edits to columns cause tenants to drift.
- Archive attendance for finished academic years to keep reads fast.
- Revisit the architecture (move to Postgres) at about 10–15 tenants, or when one tenant passes about 1,000 students.
