/**
 * Receipt HTML built on the device from cached tables, matching backend/core/ReceiptPdf.js, so a
 * receipt opens, prints and becomes a PDF without a server round trip.
 */
import type { CoreTables, Payment, Settings } from '../data/types';
import { byId, groupBy } from './indexes';
import { isOpenDue } from './ledger';
import { num } from './values';

const esc = (v: unknown) => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function money(n: number, settings: Settings) {
  const symbol = String(settings.currency || 'INR') === 'INR' ? 'Rs. ' : '';
  const value = Math.round(Number(n) || 0);
  const s = String(Math.abs(value));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${symbol}${rest ? `${rest},` : ''}${last3}`;
}

function formatDate(iso: string) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
}

export const brandColor = (value: unknown, fallback: string) => (/^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim() : fallback);

export function receiptFileName(payment: Payment) {
  return `${String(payment.receipt_no || payment.id).replace(/\//g, '-')}${payment.status === 'Cancelled' ? '-CANCELLED' : ''}.pdf`;
}

/** The academy logo when it is a plain https link (the PDF builder swaps in a data URI when it can). */
export function receiptLogoUrl(settings: Settings) {
  return /^https:\/\/\S+$/.test(String(settings.logo_url || '')) ? String(settings.logo_url) : '';
}

export function receiptData(t: CoreTables, payment: Payment) {
  const dues = byId(t.FeeDues);
  const students = byId(t.Students);
  const enrollments = byId(t.Enrollments);
  const courses = byId(t.Courses);
  const lines = (groupBy(t.PaymentAllocations, 'payment_id').get(payment.id) ?? [])
    .filter((a) => a.due_id)
    .map((a) => {
      const due = dues.get(a.due_id);
      const enrollment = due ? enrollments.get(due.enrollment_id) : undefined;
      const course = enrollment ? courses.get(enrollment.course_id) : undefined;
      return {
        student: students.get(due?.student_id ?? a.student_id)?.name ?? '',
        item: course ? course.name : due?.period_label ?? '',
        period: course ? due?.period_label ?? '' : '',
        amount: num(a.amount),
      };
    });
  const advance = Math.max(0, num(payment.amount) - lines.reduce((s, l) => s + l.amount, 0));
  const outstanding = (groupBy(t.FeeDues, 'parent_id').get(payment.parent_id) ?? [])
    .filter(isOpenDue)
    .reduce((s, d) => s + num(d.balance), 0);
  const parent = byId(t.Parents).get(payment.parent_id);
  return { parent, lines, advance, outstanding };
}

/** Full HTML document of a receipt. `logo` overrides the logo source (a data URI for the PDF). */
export function receiptHtml(t: CoreTables, settings: Settings, payment: Payment, logo = receiptLogoUrl(settings)) {
  const { parent, lines, advance, outstanding } = receiptData(t, payment);
  const cancelled = payment.status === 'Cancelled';
  const name = settings.academy_name || 'Academy';
  const primary = brandColor(settings.brand_primary, '#0B1F3A');
  const accent = brandColor(settings.brand_accent, '#C9A227');
  const contactLine = [settings.contact_person, settings.academy_phone].filter(Boolean).join(' · ');
  const m = (n: number) => money(n, settings);
  const rows = lines.map((l) => `
    <tr><td>${esc(l.student)}</td><td>${esc(l.item)}</td><td>${esc(l.period)}</td><td class="r">${m(l.amount)}</td></tr>`).join('');
  const advanceRow = advance > 0 ? `<tr><td colspan="3">Advance (adjusted against future fees)</td><td class="r">${m(advance)}</td></tr>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    html { background: #fff; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1c2433; font-size: 12px; margin: 28px; position: relative; }
    .muted { color: #6b7280; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid #e5e1d8; }
    th { background: #f4f1ea; font-size: 11px; text-transform: uppercase; }
    .r { text-align: right; }
    table.head { margin: 0; }
    .head td { border: none; padding: 0; vertical-align: middle; }
    .head .logo { width: 84px; }
    .badge { width: 64px; height: 64px; border-radius: 12px; background: ${primary}; color: ${accent}; font-size: 34px; font-weight: bold; text-align: center; line-height: 64px; }
    .name { font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: bold; letter-spacing: 1px; color: ${primary}; }
    .tag { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 12px; color: ${primary}; margin-top: 2px; }
    .head .contact { text-align: right; font-size: 11px; color: #4b5563; line-height: 1.5; }
    .rule { height: 3px; background: ${accent}; margin: 10px 0 0; }
    h2 { font-size: 15px; letter-spacing: 3px; margin: 18px 0 8px; color: ${primary}; }
    .total td { font-weight: bold; font-size: 14px; border-top: 2px solid ${primary}; }
    .meta td { border: none; padding: 2px 0; }
    .stamp { position: absolute; top: 260px; left: 18%; font-size: 72px; color: rgba(185,28,28,0.25); transform: rotate(-24deg); font-weight: bold; }
    .band { margin-top: 28px; background: ${primary}; color: #ffffff; padding: 10px 14px; font-size: 11px; line-height: 1.6; border-top: 3px solid ${accent}; }
    .band b { color: ${accent}; }
    .foot { margin-top: 8px; font-size: 10px; text-align: center; }
  </style></head><body>
    ${cancelled ? '<div class="stamp">CANCELLED</div>' : ''}
    <table class="head"><tr>
      <td class="logo">${logo ? `<img src="${esc(logo)}" width="72" height="72" alt="">` : `<div class="badge">${esc(name.charAt(0))}</div>`}</td>
      <td>
        <div class="name">${esc(name.toUpperCase())}</div>
        ${settings.academy_tagline ? `<div class="tag">${esc(settings.academy_tagline)}</div>` : ''}
      </td>
      <td class="contact">
        ${settings.academy_phone ? `${esc(settings.academy_phone)}<br>` : ''}
        ${settings.academy_email ? `${esc(settings.academy_email)}<br>` : ''}
        ${settings.gstin ? `GSTIN: ${esc(settings.gstin)}` : ''}
      </td>
    </tr></table>
    <div class="rule"></div>
    <h2>FEE RECEIPT</h2>
    <table class="meta">
      <tr><td><b>Receipt no:</b> ${esc(payment.receipt_no)}</td><td class="r"><b>Date:</b> ${formatDate(payment.paid_at)}</td></tr>
      <tr><td><b>Received from:</b> ${esc(parent?.guardian_name)} (${esc(parent?.phone)})</td><td class="r"><b>Mode:</b> ${esc(payment.mode)}</td></tr>
    </table>
    <table>
      <thead><tr><th>Student</th><th>Course / item</th><th>Period</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}${advanceRow}
        <tr class="total"><td colspan="3">Total received</td><td class="r">${m(num(payment.amount))}</td></tr>
      </tbody>
    </table>
    <p><b>Balance outstanding for the family:</b> ${m(outstanding)}</p>
    ${cancelled ? `<p style="color:#b91c1c"><b>This receipt was cancelled:</b> ${esc(payment.cancel_reason)}</p>` : ''}
    ${payment.notes ? `<p class="muted">Note: ${esc(payment.notes)}</p>` : ''}
    ${settings.academy_address || contactLine ? `<div class="band">
      ${settings.academy_address ? `<div><b>Address:</b> ${esc(settings.academy_address)}</div>` : ''}
      ${contactLine ? `<div><b>Contact:</b> ${esc(contactLine)}</div>` : ''}
    </div>` : ''}
    <div class="foot muted">${settings.receipt_footer ? `${esc(settings.receipt_footer)}<br>` : ''}This is a computer-generated receipt and needs no signature.</div>
  </body></html>`;
}
