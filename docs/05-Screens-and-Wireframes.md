# Screen Inventory and Low-Fidelity Wireframes

Theme: PRD §4 colours and fonts by default, with the values taken from the tenant config (`theme`).
UI words come from the tenant config (`labels`). Wireframes are mobile-first; the desktop changes are noted under each.
**Pending:** "Madeena Fireworks" reference screenshots. Revisit layout conventions when they arrive.

## Navigation

| Mobile bottom tabs | Desktop sidebar |
|---|---|
| Dashboard · Students · Attendance · Fees · More | Dashboard, Students, Admissions, Attendance, Fees & Dues, Payments, Reminders, Enquiries, Expenses, Reports, Settings |

"More" contains Enquiries, Expenses, Reports, Reminders and Settings. Global search (student, parent, phone) sits in the top bar on every screen.

## Screen list (by phase)

| # | Screen | Phase | Key acceptance target |
|---|---|---|---|
| S1 | Login | 1 | |
| S2 | App shell + global search | 1 | Cached screens open in under 1 second |
| S3 | Course master (categories, courses, batches, fee plans, charges) | 2 | |
| S4 | New admission (parent + siblings + courses) | 2 | 2 children × 2 courses in under 2 minutes |
| S5 | Students list (filters: course, status, dues) | 2 | |
| S6 | Student profile (tabs: Details, Courses, Fees, Payments, Attendance) | 2–3 | |
| S7 | Attendance marking | 3 | 25 students in under 30 seconds |
| S8 | Attendance reports | 3 | |
| S9 | Fees & dues (parent-wise, ageing) | 3 | |
| S10 | Collect payment (sheet) | 3 | |
| S11 | Receipt view and share | 3 | |
| S12 | Payments feed (notifications) | 4 | |
| S13 | Reminder queue | 4 | 30 parents, one tap each |
| S14 | Broadcast composer (events, new course) | 4 | |
| S15 | Enquiries pipeline and quick-add | 5 | |
| S16 | Expenses | 5 | |
| S17 | Reports: P&L, cash flow, balance sheet | 5 | |
| S18 | Dashboard | 5 | |
| S19 | Settings (profile, templates, password, backup, opening balances) | 1–6 | |

## Key wireframes

### S4 New admission (mobile, full-screen sheet)
```text
┌─────────────────────────────────┐
│ ←  New admission           Save │
├─────────────────────────────────┤
│ PARENT                          │
│ Phone*      [+91 98xxxxxxx   ]  │  ← on blur: "Existing parent: Ravi K. Use?" [Use] [New]
│ Guardian*   [               ]   │
│ Address     [               ]   │
├─────────────────────────────────┤
│ CHILD 1                     ✕   │
│ Name*  [          ] Class [ 5 ] │
│ Syllabus [CBSE ▾]  (custom fld) │
│ Courses  ▸ Martial Arts         │
│   [✓ Karate] [  Kalari]         │
│          ▸ Skills               │
│   [✓ Abacus] [  Chess] ...      │
│ Per course: Plan [Monthly ▾]    │
│   Start [13 Oct]  Prorate? [ ]  │
│   First due ₹ [ 650 ] (suggest) │
├─────────────────────────────────┤
│ [ + Add sibling ]               │
├─────────────────────────────────┤
│ Admission fee ₹[500]  [✓]       │
│ Advance paid now?  ₹[    ] Mode │
├─────────────────────────────────┤
│ Total due now ₹ 2,950           │
│ [        Save admission       ] │  ← sticky primary button
└─────────────────────────────────┘
```
Desktop: two columns (parent on the left, children stacked on the right) with the total in a side panel.

### S7 Attendance marking (mobile)
```text
┌─────────────────────────────────┐
│ Attendance                      │
│ [Karate ▾] [Mon/Wed 5pm ▾]      │
│ [◀ 13 Oct 2026 ▶]   ☐ Holiday   │
├─────────────────────────────────┤
│ [ ✓ Mark all present ]   25/25  │
├─────────────────────────────────┤
│ Aarav S.            [P][A][L]   │  ← tap cycles; big 44px targets
│ Diya R.             [P][A][L]   │
│ ...                             │
├─────────────────────────────────┤
│ Synced ✓   (or "Saving…", "Retry")│
│ [ Save ]  [ WhatsApp absentees ]│
└─────────────────────────────────┘
```
The screen updates instantly (optimistic) and syncs in the background. The badge shows unsynced changes.

### S9 Fees & dues (mobile)
```text
┌─────────────────────────────────┐
│ Fees & dues          [Filter ⚙] │
│ Due ₹48,200 │ Overdue ₹21,500   │
│ 1-7 ₹8k  8-15 ₹6k  16-30 ₹4k  30+ ₹3.5k │
├─────────────────────────────────┤
│ Ravi K. (2 children)   ₹3,400 ▸ │
│  Aarav – Karate Nov  ₹1,000 🔴  │
│  Diya – Abacus Nov   ₹  800 🟠  │
│  [Collect] [Pay link] [Remind]  │
├─────────────────────────────────┤
│ ...                             │
└─────────────────────────────────┘
```
Desktop: a table with parent rows that expand to show dues, plus a filter bar.

### S10 Collect payment (sheet)
```text
Parent: Ravi K.       Credit available ₹0
☑ Aarav – Karate – Nov 2026     ₹1,000
☑ Diya – Abacus – Nov 2026      ₹  800
☐ Diya – Abacus – Dec 2026      ₹  800
Amount ₹[1,800]   Mode [Cash|UPI|Bank]
Date [13 Oct]  Notes [        ]
[ Record payment ]  → receipt preview → [Share on WhatsApp]
```

### S13 Reminder queue
```text
Filter: [Overdue ▾] [All courses ▾]   12 parents
┌─────────────────────────────────┐
│ 3 / 12   Ravi K.  ₹3,400        │
│ "Dear Ravi, this is a gentle…"  │
│ [ Skip ]   [ Open WhatsApp ▶ ]  │  ← opens wa.me, logs MessageLog, advances
└─────────────────────────────────┘
```

### S18 Dashboard (desktop, 3-column grid; single column on mobile)
```text
[Active students 196] [Collected Oct ₹1.2L / ₹1.6L 75%] [Pending ₹48k] [Net profit Oct ₹52k]
[Course-wise enrolment donut ] [Collection vs expected bars ] [Ageing bars     ]
[Admissions vs dropouts line ] [Enquiries: 8 new · 5 due today · 32% conv]
[Today's attendance 84%      ] [Low attendance list] [Recent payments feed]
```
