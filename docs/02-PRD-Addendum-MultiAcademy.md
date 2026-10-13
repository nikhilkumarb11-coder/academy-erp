# PRD Addendum: Multi-Academy (Replicable) Version

**Applies to:** `Rays_Academy_PRD.md` v1.0
**Status:** Draft for owner review
**Purpose:** Rays Academy stays the first customer, and every Rays requirement still applies. This addendum lists what changes so the same app can be set up for other activity academies without code changes.

Where this document and the original PRD disagree, this document wins.

---

## A1. Scope changes

| PRD item | Change |
|---|---|
| Non-goal: multi-branch | Still a non-goal. Each institution (or branch) is a separate tenant copy. |
| Non-goal: staff logins | Still one login per tenant in v1. The token format has a `role` claim so staff logins can be added later. |
| Non-goal: timetable | Still a non-goal, but an optional **Batch** (for example "Karate – Mon/Wed 5pm") can be set on each enrollment, and attendance rosters can be filtered by batch. |
| Future idea: belt/level tracking | Still out of v1. It is the first candidate for v1.1 because martial-arts academies will pay for it. |

## A2. Things that become configurable

### A2.1 Tenant config (public, read before login): `tenants/<slug>.json`
Branding (name, logo, colours, fonts), labels, locale, enabled modules and the API URL. **Never put secrets here.** See `tenants/_template.json`.

### A2.2 Labels
These words can be renamed per tenant: Course, Batch, Student, Parent/Guardian, Class/Grade.
Example: a dance school may use "Program" and "Batch"; a karate dojo may use "Dojo class".

### A2.3 Fee plans replace the hard-coded Monthly/Annual rule
New tab: `FeePlans`. Each plan has `frequency`, `months_covered` and `discount_pct`.

- The amount for one billing period is `monthly_fee × months_covered × (1 − discount_pct/100)`, rounded to the nearest rupee (rounding rule set in Settings).
- **Rays seed:** `Monthly` (1 month, 0%) and `Annual` (10 months, 15%). A Rs 1,000/month course on the annual plan is therefore Rs 8,500, as PRD §10 requires.
- Other tenants can add `Quarterly` (3 months, 5%), `Half-yearly` and so on without code changes.
- PRD §6.11 "annual discount % and months" is now edited on the fee-plan rows instead of in Settings.
- An enrollment stores `fee_plan_id` instead of `fee_mode`.

### A2.4 One-time charges
New tab: `ChargeItems`, for things like the admission fee, kit or uniform, belt, grading or exam fee, and costumes.

- A one-time charge creates a `FeeDues` row with `kind = OneTime`. It can be added at admission or any time later.
- It is collected, receipted and reminded exactly like a course due.

### A2.5 Custom fields
New tab: `CustomFields`, with fields defined per entity (Student, Parent, Enquiry). The values are stored as JSON in the entity's `extra` column.

- **Rays seed:** `syllabus` (select: SSC, CBSE, ICSE, Other) on Student.
- **Martial-arts preset:** `current_belt`, `blood_group`.
- **Dance/music preset:** `grade_level`, `instrument`.

### A2.6 Sibling discount (optional)
Setting `sibling_discount_pct` (default 0). When set above 0, the user is offered (but not forced) this discount on the second and later children's course dues. It is recorded as the due's `discount` with an explanatory note.

### A2.7 Enquiry trial classes
Enquiry gains `trial_date` and a `Trial` status: New → Follow-up → Trial → Converted / Lost.

### A2.8 Modules
Modules can be switched off per tenant: `attendance`, `onlinePayments`, `enquiries`, `expenses`, `finance`. A disabled module is hidden from the menu and dashboard. Its tabs still exist so it can be switched on later.

### A2.9 Starter presets
`presets/*.json` seed a new tenant with categories, courses, fee plans, charge items, expense categories, custom fields and message templates:
- `multi-activity` (Rays)
- `martial-arts`
- `dance-music`
- `chess-abacus`

## A3. Data-model changes against PRD §5

The full schema is in `03-Data-Schema.md`. Summary:

- **Every entity tab** uses `id` as its key, plus `created_at` and `updated_at`. Entity tabs also have a soft-delete `deleted` column (PRD rule 7). Log tabs (AuditLog, MessageLog, Notifications) are append-only.
- **New tabs:** `_meta`, `Counters`, `FeePlans`, `Batches`, `ChargeItems`, `PaymentAllocations`, `CustomFields`, `MessageLog`, `WhatsAppGroups`, `Notifications`, `RecurringExpenses`.
- **Payments ↔ dues:** the PRD's comma-separated `due_id(s)` is replaced by the `PaymentAllocations` tab (payment_id, due_id, amount).
  - **Advances** are allocations with an empty `due_id`, which gives the parent a credit. The credit is applied to the earliest open dues automatically when dues are generated (PRD §6.3).
  - This makes parent-level combined payments and balance-sheet reconciliation exact.
- **FeeDues** gains `kind`, `parent_id`, `charge_item_id`, `period_start`, `period_end`, `amount_paid` and `adjustment`.
- **Sessions** are not stored. The token is signed with HMAC and expires on its own. Changing the password increments `SESSION_VERSION`, which logs out every device.

## A4. Payment webhook (replaces PRD §6.4 point 5, first bullet)

Apps Script can't read request headers, so it can't verify Razorpay's signature. It also replies with a 302 redirect, which Razorpay treats as a failed delivery.

**Change:** a Cloudflare Worker (free tier) receives `POST /rzp/<tenant>` and works as follows:
1. It verifies `X-Razorpay-Signature` (HMAC-SHA256 of the raw body, using the tenant's webhook secret).
2. It replies `200` immediately.
3. It forwards the event to the tenant's Apps Script with a per-tenant `FORWARD_TOKEN`.

The Apps Script side still **fetches the payment from the Razorpay API** before recording it, stays idempotent on `gateway_payment_id`, and the 10–15-minute reconciliation job remains.

## A5. Gaps in the original PRD, with proposed answers (owner to confirm)

| # | Gap | Proposed answer |
|---|---|---|
| G1 | Refunds or cancelled payments | A payment can be **Cancelled** with a reason. Its allocations are reversed, dues reopen, and the receipt is marked "CANCELLED" (never deleted). Gateway refunds are done in the Razorpay dashboard and recorded here as a cancellation. |
| G2 | Student drops out mid-way through an annual plan | No automatic refund. The owner records a manual adjustment or refund expense. Unused months stay as deferred income until written off. |
| G3 | Course or fee change mid-period | Close the old enrollment (`end_date`) and open a new one. Fee changes apply from the next generated due; existing dues are never silently changed. |
| G4 | Academic-year rollover | Year-end utility: archive Attendance (and optionally MessageLog) to a new spreadsheet, and carry forward open dues and credits unchanged. |
| G5 | Importing from paper registers | Excel/CSV import for Parents, Students and Enrollments, with a preview and duplicate-phone detection (phase 6). |
| G6 | Receipt numbering | `<prefix>/<FY>/<sequence>`, for example `RA/2026-27/0001`, from the `Counters` tab under a lock. It restarts each financial year. |
| G7 | Cash-basis P&L versus deferred income on the balance sheet | The P&L stays cash basis (as the PRD says). The balance sheet shows "Advance fees received (deferred)" as a liability: annual-plan and advance money for months not yet covered. Both figures come from `PaymentAllocations` and `FeeDues`, so they reconcile. |
| G8 | Dues for annual plans | One `FeeDues` row per annual purchase (`period_key = A-2026-06`, covering 10 months). Monthly generation skips an enrollment while a paid annual due covers that month (PRD rule 4). |
| G9 | Missing "Madeena Fireworks" reference | Blocks final UI polish, but not phases 1–3. The theme in PRD §4 is used until then. |

## A6. Acceptance criteria added for replication

- A new tenant can be set up from a preset in **under 2 hours** by following `06-Tenant-Provisioning-Runbook.md`, with **no code changes**.
- Running `migrate()` on a tenant that is already up to date makes no changes.
- A backend deploy across all tenants finishes, with a smoke test per tenant, in a single command.
- Renaming a label (for example Course → Program) in the tenant config changes it on every screen.
