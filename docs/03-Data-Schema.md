# Data Schema (Google Sheets)

**Source of truth:** `backend/Schema.js`. This document explains it; if they ever differ, the code wins.
**One spreadsheet per tenant.** One tab per entity, with row 1 as the header row.

## Conventions

| Rule | Detail |
|---|---|
| Keys | Every entity row has `id`, generated as `<PREFIX>-<time36>-<random6>` (for example `STU-lx2k9a-4f3c1b`). Never use row numbers as keys. |
| Timestamps | `created_at` and `updated_at` are ISO strings with an offset (`2026-10-13T18:05:00+05:30`). Dates are `yyyy-MM-dd`. |
| Text columns | Columns matching `TEXT_COLUMN_PATTERN` (ids, dates, phones, period keys, receipt numbers) use the plain-text format, so Sheets never converts them. |
| Soft delete | Entity tabs have `deleted` (TRUE/FALSE). Nothing is physically deleted (PRD rule 7). |
| Append-only | `AuditLog`, `MessageLog`, `Notifications`. |
| JSON columns | `extra` stores custom-field values, for example `{"syllabus":"CBSE"}`. |
| Money | Whole rupees (numbers) unless `Settings.rounding` says otherwise. |
| Column changes | Append only. Never rename or remove a column, because other tenants' sheets depend on it. |

## Tabs

### System
| Tab | Purpose |
|---|---|
| `_meta` | `schema_version`, `api_version`, `last_migrated_at`, `preset`, `seeded_at` |
| `Settings` | Key/value business settings (see `DEFAULT_SETTINGS` in `Schema.js`) |
| `Counters` | Atomic sequences, for example `receipt:2026-27` |
| `AuditLog` | timestamp, action, entity, entity_id, summary, device |

### People
| Tab | Columns (beyond id, extra, deleted, timestamps) |
|---|---|
| `Parents` | guardian_name, phone (normalized `+91…`, unique among non-deleted rows), alt_phone, email, address, notes |
| `Students` | parent_id, name, class, dob, gender, join_date, status (Active / On hold / Dropped / Completed), status_reason, notes |

### Catalogue
| Tab | Columns |
|---|---|
| `Categories` | name, sort_order |
| `Courses` | category_id, name, monthly_fee, classes_per_week, description, active, sort_order |
| `Batches` | course_id, name, schedule_note, capacity, active |
| `FeePlans` | name, frequency (Monthly / Quarterly / HalfYearly / Annual), months_covered, discount_pct, active, sort_order |
| `ChargeItems` | name, default_amount, applies_to (Admission / Course / Any), active |
| `CustomFields` | entity (Student / Parent / Enquiry), key, label, type (text / number / date / select), options (separated by `\|`), required, sort_order, active |

### Enrollment and attendance
| Tab | Columns |
|---|---|
| `Enrollments` | student_id, course_id, batch_id, fee_plan_id, start_date, end_date, monthly_fee_override, discount_note, status, status_reason |
| `Attendance` | date, course_id, batch_id, student_id, status (Present / Absent / Leave), remarks. One row per student per course per date. Upsert by (date, course_id, student_id). |
| `Holidays` | date, course_id (blank = all courses), reason |

### Money in
| Tab | Columns |
|---|---|
| `FeeDues` | kind (Recurring / OneTime), enrollment_id, student_id, parent_id, charge_item_id, period_key, period_label, period_start, period_end, amount_due, discount, adjustment, amount_paid, balance, prorated, due_date, status (Pending / Partial / Paid / Waived), notes |
| `Payments` | parent_id, amount, mode (Gateway / Cash / UPI / Bank), paid_at, gateway_payment_id (unique when set), link_id, receipt_no, status (Recorded / Cancelled), cancel_reason, notes |
| `PaymentAllocations` | payment_id, due_id (**blank = unapplied advance credit**), student_id, amount |
| `PaymentLinks` | parent_id, due_ids (comma-separated, for display only), amount, gateway_link_id, short_url, status, expires_at |
| `Receipts` | receipt_no, payment_id, drive_file_id, drive_url, status |

### Money out and finance
| Tab | Columns |
|---|---|
| `ExpenseCategories` | name, sort_order |
| `Expenses` | date, category_id, amount, mode, payee, notes, source (Manual / Gateway / Recurring), ref_id |
| `RecurringExpenses` | category_id, amount, payee, day_of_month, auto_create, active, notes |
| `BalanceItems` | type (Asset / Liability), name, amount, as_of_date, notes |

### Communication and pipeline
| Tab | Columns |
|---|---|
| `Enquiries` | name, phone, course_interested, source, enquiry_date, next_followup_date, trial_date, status (New / Follow-up / Trial / Converted / Lost), lost_reason, notes, converted_student_id |
| `MessageTemplates` | type (FeeReminder / Receipt / Absent / Event / NewCourse / Custom), name, text, active |
| `MessageLog` | sent_at, type, parent_id, student_id, template_id, channel (WhatsApp / Copy), preview |
| `WhatsAppGroups` | name, notes, last_sent_at |
| `Notifications` | type, title, body, ref_entity, ref_id, read, created_at |

## Relationships

```text
Parents 1─* Students 1─* Enrollments *─1 Courses *─1 Categories
                              │   └─*1 FeePlans, Batches
                              └─* FeeDues ─* PaymentAllocations *─1 Payments ─1 Receipts
Parents 1─* Payments, PaymentLinks
ChargeItems 1─* FeeDues (kind = OneTime)
```

## Money invariants (enforced in code and tested)

These hold for every due:

1. `balance = amount_due − discount + adjustment − amount_paid`
2. `amount_paid` = the sum of non-cancelled allocations for that due.
3. `status` is Paid when `balance <= 0`, Partial when `0 < amount_paid` and `balance > 0`, Pending when nothing is paid, and Waived only when set explicitly.

These hold for payments:

4. A payment's `amount` = the sum of its allocations, including any unapplied-credit allocation.
5. A parent's unapplied credit = the sum of their allocations with a blank `due_id`. Credit is consumed by moving it onto the earliest open dues: the blank-due allocation is reduced and a due allocation is added.
6. Each `gateway_payment_id` appears at most once in `Payments` (idempotency).

These hold for reports:

7. Cash-basis income for a month = the sum of non-cancelled `Payments.amount` with `paid_at` in that month.
8. Fees receivable = the sum of `balance` for Pending/Partial dues where `due_date <= today`.
9. Deferred income = the sum of allocations to dues whose `period_end` is in the future, prorated for the months not yet covered, plus unapplied credit.

## Period keys

| Plan | `period_key` | Example |
|---|---|---|
| Monthly | `M-yyyy-MM` | `M-2026-11` |
| Quarterly | `Q-yyyy-MM` (start month) | `Q-2026-11` |
| Half-yearly | `H-yyyy-MM` | `H-2026-06` |
| Annual | `A-yyyy-MM` | `A-2026-06` |
| One-time | `OT-<chargeItemId>-<date>` | `OT-CHG-…-2026-10-13` |

Dues generation is idempotent on (enrollment_id, period_key).

## Performance notes

- About 200 students and 3–4 attendance marks per week each comes to roughly 30–40k attendance rows a year. Archive finished academic years with the year-end utility.
- `Db` reads each tab once per request with `getValues()` and writes in blocks with `setValues()`.
- `BOOTSTRAP_TABS` are cached on the client. Large tabs (Attendance, FeeDues, Payments) are fetched per screen with filters.
