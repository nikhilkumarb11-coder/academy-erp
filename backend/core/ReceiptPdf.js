/**
 * Receipt PDFs (PRD §6.5): HTML rendered to PDF by Apps Script, stored in a Drive folder and shared
 * as "anyone with the link" (an unguessable URL). The folder is created on first use and remembered
 * in the RECEIPTS_FOLDER_ID Script Property.
 */
const ReceiptPdf = (() => {
  const esc = (v) => String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function money(n) {
    const symbol = String(Db.getMap('Settings').currency || 'INR') === 'INR' ? 'Rs. ' : '';
    const value = Math.round(Number(n) || 0);
    const s = String(Math.abs(value));
    // Indian grouping: 12,34,567
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return `${value < 0 ? '-' : ''}${symbol}${rest ? `${rest},` : ''}${last3}`;
  }

  function formatDate(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return d && m && y ? `${d}/${m}/${y}` : String(iso);
  }

  /** Everything printed on the receipt, gathered from the sheet. */
  function data(payment) {
    const settings = Db.getMap('Settings');
    const parent = Db.find('Parents', payment.parent_id) || {};
    const students = new Map(Db.all('Students', { includeDeleted: true }).map((s) => [s.id, s]));
    const enrollments = new Map(Db.all('Enrollments', { includeDeleted: true }).map((e) => [e.id, e]));
    const courses = new Map(Db.all('Courses', { includeDeleted: true }).map((c) => [c.id, c]));
    const dues = new Map(Db.all('FeeDues', { includeDeleted: true }).map((d) => [d.id, d]));

    const lines = [];
    Db.where('PaymentAllocations', (a) => a.payment_id === payment.id && a.due_id).forEach((a) => {
      const amount = Number(a.amount) || 0;
      const due = dues.get(a.due_id) || {};
      const enrollment = enrollments.get(due.enrollment_id);
      const course = enrollment ? courses.get(enrollment.course_id) : null;
      lines.push({
        student: (students.get(due.student_id) || {}).name || '',
        item: course ? course.name : due.period_label,
        period: course ? due.period_label : '',
        amount,
      });
    });
    // Whatever this payment has not (yet) paid off is an advance; credit spent later shows as normal lines.
    const advance = Math.max(0, Number(payment.amount) - lines.reduce((s, l) => s + l.amount, 0));
    const outstanding = Db.where('FeeDues', (d) => d.parent_id === payment.parent_id && Fees.isOpen(d))
      .reduce((s, d) => s + (Number(d.balance) || 0), 0);
    return { settings, parent, lines, advance, outstanding };
  }

  function html(payment) {
    const { settings, parent, lines, advance, outstanding } = data(payment);
    const cancelled = payment.status === 'Cancelled';
    const name = settings.academy_name || 'Academy';
    const contact = [settings.academy_phone, settings.academy_email].filter(Boolean).join(' · ');
    const rows = lines.map((l) => `
      <tr><td>${esc(l.student)}</td><td>${esc(l.item)}</td><td>${esc(l.period)}</td><td class="r">${money(l.amount)}</td></tr>`).join('');
    const advanceRow = advance > 0 ? `<tr><td colspan="3">Advance (adjusted against future fees)</td><td class="r">${money(advance)}</td></tr>` : '';

    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body { font-family: Arial, Helvetica, sans-serif; color: #1c2433; font-size: 12px; margin: 28px; }
      .head { display: flex; justify-content: space-between; border-bottom: 3px solid #0B1F3A; padding-bottom: 10px; }
      .badge { width: 46px; height: 46px; border-radius: 10px; background: #0B1F3A; color: #F5B700; font-size: 26px; font-weight: bold; text-align: center; line-height: 46px; display: inline-block; vertical-align: middle; margin-right: 10px; }
      h1 { font-size: 20px; margin: 0; color: #0B1F3A; display: inline-block; vertical-align: middle; }
      .muted { color: #6b7280; }
      h2 { font-size: 15px; letter-spacing: 2px; margin: 18px 0 8px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid #e5e1d8; }
      th { background: #f4f1ea; font-size: 11px; text-transform: uppercase; }
      .r { text-align: right; }
      .total td { font-weight: bold; font-size: 14px; border-top: 2px solid #0B1F3A; }
      .meta td { border: none; padding: 2px 0; }
      .stamp { position: fixed; top: 38%; left: 18%; font-size: 72px; color: rgba(185,28,28,0.25); transform: rotate(-24deg); font-weight: bold; }
      .foot { margin-top: 28px; font-size: 10px; }
    </style></head><body>
      ${cancelled ? '<div class="stamp">CANCELLED</div>' : ''}
      <div class="head">
        <div><span class="badge">${esc(name.charAt(0))}</span><h1>${esc(name)}</h1>
          <div class="muted" style="margin-top:6px">${esc(settings.academy_address)}</div>
          <div class="muted">${esc(contact)}</div>
          ${settings.gstin ? `<div class="muted">GSTIN: ${esc(settings.gstin)}</div>` : ''}
        </div>
      </div>
      <h2>FEE RECEIPT</h2>
      <table class="meta">
        <tr><td><b>Receipt no:</b> ${esc(payment.receipt_no)}</td><td class="r"><b>Date:</b> ${formatDate(payment.paid_at)}</td></tr>
        <tr><td><b>Received from:</b> ${esc(parent.guardian_name)} (${esc(parent.phone)})</td><td class="r"><b>Mode:</b> ${esc(payment.mode)}</td></tr>
      </table>
      <table>
        <thead><tr><th>Student</th><th>Course / item</th><th>Period</th><th class="r">Amount</th></tr></thead>
        <tbody>${rows}${advanceRow}
          <tr class="total"><td colspan="3">Total received</td><td class="r">${money(payment.amount)}</td></tr>
        </tbody>
      </table>
      <p><b>Balance outstanding for the family:</b> ${money(outstanding)}</p>
      ${cancelled ? `<p style="color:#b91c1c"><b>This receipt was cancelled:</b> ${esc(payment.cancel_reason)}</p>` : ''}
      ${payment.notes ? `<p class="muted">Note: ${esc(payment.notes)}</p>` : ''}
      <div class="foot muted">${esc(settings.receipt_footer || '')}<br>This is a computer-generated receipt and needs no signature.</div>
    </body></html>`;
  }

  function render(payment) {
    return HtmlService.createHtmlOutput(html(payment)).getBlob().getAs('application/pdf')
      .setName(`${String(payment.receipt_no).replace(/\//g, '-')}${payment.status === 'Cancelled' ? '-CANCELLED' : ''}.pdf`);
  }

  function folder() {
    const id = Util.prop('RECEIPTS_FOLDER_ID');
    if (id) {
      try {
        return DriveApp.getFolderById(id);
      } catch (e) {
        // folder deleted or no access: create a new one below
      }
    }
    const created = DriveApp.createFolder(`${Db.getMap('Settings').academy_name || 'Academy'} - Receipts`);
    Util.setProp('RECEIPTS_FOLDER_ID', created.getId());
    return created;
  }

  /** Saves the PDF and makes it viewable by link. Returns { id, url }. */
  function save(blob) {
    const file = folder().createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      console.warn('Could not share receipt by link', e && e.message);
    }
    return { id: file.getId(), url: file.getUrl() };
  }

  function load(fileId) {
    return DriveApp.getFileById(fileId).getBlob();
  }

  return { html, render, save, load };
})();
