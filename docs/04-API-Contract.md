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
| `system.backup` | ✓ | – | Drive URL of the copy | ⏳ 6 |

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

### Communication, enquiries, expenses, finance (phases 4–5)
`templates.save`, `messages.log`, `reminders.queue` (filters), `enquiries.save`, `enquiries.followups`, `enquiries.convert`, `expenses.save`, `expenseCategories.save`, `recurringExpenses.save`, `balanceItems.save`, `reports.dashboard`, `reports.pnl`, `reports.cashflow`, `reports.balanceSheet`, `export.csv`.

## Time-driven triggers

| Function | Schedule | Phase |
|---|---|---|
| `generateMonthlyDues` | 1st of the month, 06:00 | 3 |
| `reconcilePaymentLinks` | Every 15 minutes | 4 |
| `dailyBackup` | Daily, 02:00 | 6 |
| `createRecurringExpenses` | Daily, 03:00 | 5 |

## Versioning

- Bump `API_VERSION` in `Schema.js` only for breaking contract changes. Additive actions and fields don't need a bump.
- The frontend reads `expectedApiVersion` from the tenant config and compares it with `system.ping`. On a mismatch it shows "Update available, please refresh".
