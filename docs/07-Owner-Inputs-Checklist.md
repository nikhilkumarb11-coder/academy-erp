# Owner Inputs Checklist: Rays Academy

Send this to the owner. Items marked **blocking** hold up the phase shown. Everything else can arrive later.

## Branding
- [ ] Logo (PNG or SVG, transparent background, at least 512 px). Needed for receipts in phase 3.
- [ ] Receipt header text: legal name, address, phone, email, and GSTIN if any. Phase 3, **blocking**.
- [ ] Confirm the colours (navy `#0B1F3A`, gold `#C9A227`) or provide brand colours.
- [ ] Screenshots or a link to the **"Madeena Fireworks"** reference app. Phase 1 UI polish.

## Courses and fees (phase 2, **blocking**)
| Category | Course | Monthly fee (₹) | Classes/week | Batches (name, days, time) |
|---|---|---|---|---|
| Arts | Drawing | | | |
| Martial Arts | Karate | | | |
| Martial Arts | Kalari | | | |
| Skills | Abacus | | | |
| Skills | Chess | | | |
| Skills | Vedic Maths | | | |
| Skills | Spoken English | | | |
| Academics | Tuitions (by class group?) | | | |
| Foundation | IIT Foundation | | | |
| Foundation | NEET Foundation | | | |

- [ ] Confirm the category grouping above. We put Chess, Abacus, Vedic Maths and Spoken English under **"Skills"**, which is not in the PRD.
- [ ] Do Tuitions fees differ by class (for example 1–5, 6–8, 9–10)? If so, they become separate courses.
- [ ] One-time charges: admission fee amount? Uniform, kit, books or exam fees?
- [ ] Annual plan confirmed as **10 months at 15% off**? Should it also apply to Tuitions and Foundation?
- [ ] Sibling discount: yes or no, and what %?
- [ ] Fee due day of the month (default the 5th). Is there a late fee? (Not in v1; noted for later.)

## Policies (confirm the proposed answers in `02-PRD-Addendum-MultiAcademy.md` §A5)
- [ ] G1 Refunds / cancelled payments
- [ ] G2 Dropping out mid-way through an annual plan
- [ ] G3 Course or fee changes mid-period
- [ ] G4 Academic-year start month (for attendance archiving)
- [ ] Financial-year start (default April)

## Payments (phase 4, **blocking**)
- [ ] Razorpay business account: KYC complete and live mode enabled.
- [ ] API Key ID and Key Secret (shared securely, never on WhatsApp in plain text).
- [ ] Should the gateway fee be recorded as an expense automatically? (default: yes)

## Communication
- [ ] Approve or edit the default WhatsApp templates (`presets/multi-activity.json`).
- [ ] The academy WhatsApp number used to send messages.
- [ ] Names of the parent WhatsApp groups (for the optional Groups list).

## Data migration (phase 6)
- [ ] Current student register (Excel, photos of pages, or a notebook) with parent name, phone, child name, class and courses.
- [ ] Current pending dues per student (as of the go-live date).
- [ ] Opening balances: cash in hand, bank balance, equipment value, deposits, loans.

## Access
- [ ] Agree on the dedicated Google account (for example `rays.erp@gmail.com`) that owns the data.
- [ ] The owner's personal Google account (for view access to the Drive folder).
