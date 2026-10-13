# API Contract (Apps Script web app)

## Transport

- `POST <apiUrl>` with `Content-Type: text/plain;charset=utf-8`. The body is JSON. (`text/plain` avoids the CORS pre-flight request, which Apps Script cannot answer.)
- `GET <apiUrl>` returns `{ ok, data: { service, apiVersion } }`, which is enough for an "is it up?" check.

```json
// request
{ "action": "students.list", "token": "<session token>", "device": "Pixel 7 / Chrome", "payload": { } }

// success
{ "ok": true, "data": { } }

// failure
{ "ok": false, "error": { "code": "VALIDATION", "message": "Missing: phone", "details": { "missing": ["phone"] } } }
```

### Error codes
| Code | Meaning | Client behaviour |
|---|---|---|
| `AUTH` | Missing, expired or revoked session | Clear the token and show the login screen |
| `LOCKED` | Too many failed logins | Show the message and disable login for 15 minutes |
| `VALIDATION` | Bad input | Highlight the fields in `details` |
| `NOT_FOUND` | Record missing | Refresh the cache |
| `CONFLICT` | Duplicate (phone, receipt, gateway id) or stale write | Show the message and re-fetch |
| `BUSY` | Lock timeout (another device is saving) | Retry automatically with back-off (3 tries) |
| `SCHEMA` / `CONFIG` | Tenant not set up correctly | Show "Contact support" |
| `SERVER` | Unexpected error | Retry once, then show an error |

## Actions

Status: ✅ implemented (phase 0) · ⏳ planned (phase shown).

### System and auth
| Action | Auth | Payload | Returns | Status |
|---|---|---|---|---|
| `system.ping` | public | – | apiVersion, schemaVersion, serverTime | ✅ |
| `auth.login` | public | password | token, expiresAt | ✅ |
| `auth.changePassword` | ✓ | current, next | new token (other devices logged out) | ✅ |
| `system.bootstrap` | ✓ | – | settings + all `BOOTSTRAP_TABS` rows | ✅ |
| `system.sync` | ✓ | since (ISO) | settings + rows changed since then | ✅ |
| `system.migrate` | ✓ | – | migration report | ✅ |
| `system.seed` | ✓ | preset, force? | counts | ✅ |
| `settings.update` | ✓ | {key: value} | settings | ✅ |
| `system.backup` | ✓ | – | `{ backup: { id, url, name, at, kind }, status }` | ✅ |
| `system.backupStatus` | ✓ | – | `{ last, count, keep }` | ✅ |
| `import.students` | ✓ | see phase 6 | `{ results, summary, changes? }` | ✅ |

### Catalogue (phase 2)
`categories.save`, `courses.save`, `courses.setActive`, `batches.save`, `feePlans.save`, `chargeItems.save`, `customFields.save`.
Each `save` inserts when `id` is missing and updates otherwise. Each returns the saved row.

### Admissions (phase 2)
| Action | Payload | Notes |
|---|---|---|
| `parents.findByPhone` | phone | For the duplicate warning |
| `admissions.create` | parent (new or existing id), students[], enrollments[], advance? | One lock and one audit entry. Creates dues for the first period. |
| `students.save` | student | |
| `students.setStatus` | id, status, reason | Ends active enrollments when the student is Dropped or Completed |
| `enrollments.save` / `enrollments.setStatus` | | |
| `students.profile` | id | Enrollments, dues, payments, attendance summary |

### Attendance (phase 3)
| Action | Payload |
|---|---|
The roster comes from cached enrollments on the device; attendance rows are not cached (they grow fastest).

| Action | Payload |
|---|---|
| `attendance.day` | course_id, date → `{ marks }` |
| `attendance.save` | course_id, batch_id?, date (not in the future), marks[{student_id, status ('' clears), remarks?}] (upsert per date+course+student, ≤500) → `{ marks }` |
| `attendance.report` | month, course_id?, student_id? → `{ month, rows }` (the app summarises) |
| `holidays.save` / `holidays.delete` | id?, date, course_id ('' = all courses), reason. Conflict on the same date and scope. |

### Fees (phase 3)
Dues, payments, allocations, receipts and holidays are cached on the device (bootstrap tabs). Writes return `{ changes }`.

| Action | Payload |
|---|---|
| `dues.generate` | month (`yyyy-MM`), dryRun? → `{ changes, month, created, total, skipped[] }`. Idempotent: never bills a period already covered. |
| `dues.addCharge` | student_id, charge_item_id? or label, amount?, due_date?, note? |
| `dues.adjust` | id, note (required), and any of amount_due (marks prorated), discount, adjustment (absolute values), waive |
| `dues.remove` | id, note. Refused once anything is paid against the due. |
| `payments.record` | parent_id, amount, mode (Cash/UPI/Bank), paid_at (≤ today), allocations[{due_id, amount}]? (default: oldest dues first, rest becomes advance), notes?, client_ref? (retry-safe) → `{ changes, payment_id, receipt_no }` |
| `payments.cancel` | id, reason. Reverses allocations; the receipt is kept and stamped CANCELLED. |
| `receipts.get` | payment_id, withFile? → `{ changes, receipt_no, url, file? {name, mimeType, base64} }`. Creates the Drive PDF on first use. |

`admissions.create` also accepts `students[i].charges[{charge_item_id, amount}]` (e.g. the admission fee) and bills the first period of each new enrolment. Re-activating a student or enrolment bills the current period.

### Online payments (phase 4)
| Action | Auth | Notes |
|---|---|---|
| `paymentLinks.create` | ✓ | parent_id, due_ids[]. Calls the Razorpay Payment Links API. |
| `paymentLinks.regenerate` | ✓ | link_id |
| `payments.webhook` | forwardToken | Called only by the Worker. Confirms through the Razorpay API, then records the payment idempotently. |
| `notifications.list` / `notifications.markRead` | ✓ | Polled every 30–60 seconds |

### WhatsApp messages (phase 4)
Messages leave the phone through wa.me links; the server only keeps templates, groups and a log.

| Action | Auth | Notes |
|---|---|---|
| `catalog.save` / `catalog.delete` with `tab: "MessageTemplates"` | ✓ | type (FeeReminder, Receipt, Absent, Event, NewCourse, Custom), name, text, active |
| `catalog.save` / `catalog.delete` with `tab: "WhatsAppGroups"` | ✓ | name, notes. `WhatsAppGroups` is cached on devices. |
| `messages.log` | ✓ | entries[{type, channel?, parent_id?, student_id?, template_id?, group_id?, preview}] (max 50) → `{ logged, changes: { WhatsAppGroups } }`. Stamps the group's last_sent_at. |
| `messages.recent` | ✓ | days? (default 60) → `{ rows }` newest first. The log is not cached on devices. |

The reminder queue is built on the device from cached dues; it skips families reminded in the last 3 days using `messages.recent`.

### Enquiries, expenses, finance (phase 5)
Enquiries, Expenses, RecurringExpenses and BalanceItems are cached on the device, so the follow-up lists, P&L, cash flow, balance sheet, dashboard and CSV exports are computed in the browser (`frontend/src/lib/finance.ts`). There are no report actions.

| Action | Payload | Returns |
|---|---|---|
| `enquiries.save` | `{ row: { id?, name, phone, course_interested ("CRS-1,CRS-2"), source, enquiry_date?, next_followup_date?, trial_date?, status, lost_reason (required when Lost), notes } }` | `{ changes: { Enquiries } }` |
| `enquiries.delete` | `{ id }` | `{ changes: { Enquiries } }` (soft delete) |
| `admissions.create` | existing payload plus optional `enquiry_id` | also marks the enquiry `Converted` with `converted_student_id` and returns it in `changes.Enquiries` |
| `expenses.save` | `{ row: { id?, date?, category_id, amount, mode (Cash/UPI/Bank/Card), payee?, notes?, ref_id? } }` | `{ changes: { Expenses } }`. `ref_id` = `"<RecurringExpense id>:<yyyy-MM>"` records a recurring expense by hand; a second one for the same month is a `CONFLICT`. |
| `expenses.delete` | `{ id }` | `{ changes: { Expenses } }` |
| `catalog.save` / `catalog.delete` | tab `ExpenseCategories`, `RecurringExpenses` (category_id, amount, payee, day_of_month 1–28, auto_create, active, notes) or `BalanceItems` (type Asset/Liability, name, amount, as_of_date, notes) | as for other catalogue tabs. A category used by expenses cannot be deleted. |

Recurring expenses with `auto_create` are added once a month on their day, by `createRecurringExpenses` and lazily on `system.bootstrap`/`system.sync` (at most once a day, `_meta.recurring_run_on`). Deleting an auto-added expense does not bring it back. The balance sheet counts fees received less expenses from `settings.opening_balances_date` (blank = all time).

### Backups, import and export (phase 6)
- **Backups.** `system.backup` copies the whole spreadsheet into the Drive folder in Script Property `BACKUP_FOLDER_ID` (created as "<Academy> - Backups" on first use). The newest 30 copies are kept and older ones go to the Drive trash. The list lives in `_meta.backups` (JSON). `dailyBackup` runs at 02:00 and skips when the last backup is under 20 hours old.
- **Import.** `import.students { rows, commit, bill_current_month?, opening_due_date? }`, at most 500 rows. One row is one student: `guardian_name, phone, alt_phone, email, address, student_name, class, dob, gender, join_date, courses ("Karate; Abacus", matched by name), fee_plan (name; default the first active Monthly plan), opening_due, opening_due_note, notes`. Rows sharing a phone become one family. A phone already in Parents adds to that family, and a student name already in the family is a `duplicate`. Without `commit` nothing is written and each row gets `new_family | existing_family | duplicate | error` plus a message. With `commit`, valid rows are inserted under one lock. `opening_due` becomes a one-time due labelled "Opening balance" (or the note) on `opening_due_date` (default today). `bill_current_month` also bills this month's course fees. Custom fields are not imported.
- **Export.** Done on the device from cached tables (`frontend/src/lib/exports.ts`): students, families, enrolments, fee dues, payments, expenses, enquiries and courses as CSV. Reports print to PDF through the browser's print dialog.

## Time-driven triggers

| Function | Schedule | Phase |
|---|---|---|
| `generateMonthlyDues` | 1st of the month, 06:00 | 3 |
| `reconcilePaymentLinks` | Every 15 minutes | 4 |
| `dailyBackup` | Daily, 02:00 | 6 |
| `createRecurringExpenses` | Daily, 07:00 | 5 |

`installTriggers()` (run from the editor) installs every active trigger and removes stale ones.

## Versioning

- Bump `API_VERSION` in `Schema.js` only for breaking contract changes. Additive actions and fields don't need a bump.
- The frontend reads `expectedApiVersion` from the tenant config and compares it with `system.ping`. On a mismatch it shows "Update available, please refresh".
