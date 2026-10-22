import clsx from 'clsx';
import { useNavigate } from 'react-router';
import { errorMessage } from '../../api/errors';
import { useToast } from '../../components/Toast';
import { Card } from '../../components/ui';
import type { CoreTables, FeeDue, Payment, Settings } from '../../data/types';
import { useCoreData } from '../../data/useCoreData';
import { useLogMessages } from '../../data/useMessages';
import { formatMoney } from '../../lib/fees';
import { byId, groupBy } from '../../lib/indexes';
import { byDueOrder, dueTitle, isOpenDue } from '../../lib/ledger';
import { receiptFileName, receiptHtml, receiptLogoUrl } from '../../lib/receipt';
import { buildReceiptPdf, logoDataUri } from '../../lib/receiptPdf';
import { useTenant } from '../../tenant/TenantContext';
import { amountText, fillMessage, templateText, whatsappUrl } from '../../lib/whatsapp';
import { monthLabel, todayIso } from '../../lib/dates';
import { num } from '../../lib/values';

export function useMoney() {
  const { locale } = useTenant();
  return (n: number) => formatMoney(n, locale.currencySymbol);
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <Card className="p-3 sm:p-4">
      <p className="text-[11px] leading-tight text-muted sm:text-xs">{label}</p>
      <p className={clsx('mt-1 whitespace-nowrap text-base font-semibold tabular-nums sm:text-xl', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success')}>{value}</p>
    </Card>
  );
}

interface PreparedPdf {
  promise: Promise<File>;
  file?: File;
}

/** PDFs built on this device, per payment version, so a later tap shares without waiting. */
const pdfs = new Map<string, PreparedPdf>();

/** Lines of a payment: which child, course and period it paid. */
export function paymentLines(t: CoreTables, payment: Payment) {
  const dues = byId(t.FeeDues);
  const students = byId(t.Students);
  return (groupBy(t.PaymentAllocations, 'payment_id').get(payment.id) ?? []).filter((a) => a.due_id).map((a) => {
    const due = dues.get(a.due_id);
    const student = students.get(due?.student_id ?? a.student_id);
    const { title, period } = due ? dueTitle(t, due) : { title: 'Due', period: '' };
    return { id: a.id, student: student?.name ?? '', title, period, amount: num(a.amount) };
  });
}

/** Builds the receipt PDF from cached data; the logo is embedded when its host allows it. */
export async function receiptPdf(t: CoreTables, settings: Settings, payment: Payment): Promise<File> {
  const logo = await logoDataUri(receiptLogoUrl(settings));
  return buildReceiptPdf(receiptHtml(t, settings, payment, logo), receiptFileName(payment));
}

/**
 * Receipt actions (PRD §6.5). The receipt PDF is made on this device from cached data.
 * WhatsApp sends the PDF to the parent (share sheet when the browser allows file share;
 * otherwise downloads the PDF and opens the parent's WhatsApp chat). No Drive "Send link".
 */
export function useReceiptActions() {
  const tenant = useTenant();
  const { data } = useCoreData();
  const toast = useToast();
  const navigate = useNavigate();
  const logMessages = useLogMessages();

  const versionKey = (payment: Payment) => `${tenant.slug}:${payment.id}:${payment.status}:${payment.receipt_no}:${payment.updated_at}`;

  function pdfEntry(payment: Payment): PreparedPdf {
    const key = versionKey(payment);
    let entry = pdfs.get(key);
    if (!entry) {
      const tables = data?.tables;
      if (!tables) throw new Error('Data is still loading. Please retry.');
      const created: PreparedPdf = { promise: receiptPdf(tables, data.settings, payment) };
      created.promise.then(
        (file) => { created.file = file; },
        () => { pdfs.delete(key); },
      );
      pdfs.set(key, created);
      entry = created;
    }
    return entry;
  }

  function message(payment: Payment) {
    const t = data?.tables;
    if (!t) return '';
    const parent = byId(t.Parents).get(payment.parent_id);
    const lines = paymentLines(t, payment);
    const balance = (groupBy(t.FeeDues, 'parent_id').get(payment.parent_id) ?? []).filter(isOpenDue).reduce((s, d) => s + num(d.balance), 0);
    return fillMessage(templateText(t.MessageTemplates, 'Receipt'), {
      parent: parent?.guardian_name ?? '',
      student: [...new Set(lines.map((l) => l.student))].join(', '),
      course: [...new Set(lines.map((l) => l.title))].join(', '),
      month: [...new Set(lines.map((l) => l.period).filter(Boolean))].join(', '),
      amount: amountText(num(payment.amount)),
      balance: amountText(balance),
      receipt_no: payment.receipt_no,
      receipt_link: '',
      academy: data?.settings.academy_name || tenant.name,
    });
  }

  function saveFile(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** WhatsApp to the parent with the receipt PDF (no Drive link). */
  async function sendWhatsApp(payment: Payment) {
    try {
      const file = await pdfEntry(payment).promise;
      const phone = data?.tables.Parents.find((p) => p.id === payment.parent_id)?.phone ?? '';
      const text = message(payment);
      logMessages([{ type: 'Receipt', parent_id: payment.parent_id, preview: text }]);
      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text, title: `Receipt ${payment.receipt_no}` });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            toast('Receipt is ready. Tap WhatsApp again to send it.', 'success');
            return;
          }
        }
      }
      saveFile(file);
      window.open(whatsappUrl(phone, text), '_blank', 'noopener');
      toast('Receipt PDF downloaded. Attach it in WhatsApp.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function download(payment: Payment) {
    try {
      saveFile(await pdfEntry(payment).promise);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function open(payment: Payment) {
    navigate(`/receipts/${payment.id}`);
  }

  /** Builds the PDF ahead of a likely WhatsApp / Download tap. */
  function warmUp(payment: Payment) {
    const run = () => {
      try {
        pdfEntry(payment).promise.catch(() => {});
      } catch {
        // data still loading: the tap builds it
      }
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1500 });
    else setTimeout(run, 300);
  }

  return { sendWhatsApp, open, download, warmUp };
}

export interface FamilyReminder {
  parentId: string;
  phone: string;
  text: string;
  url: string;
}

/** WhatsApp fee reminder for a family's open dues; `template` defaults to the active FeeReminder template. */
export function familyReminder(t: CoreTables, settings: Record<string, string>, academy: string, parentId: string, template?: string): FamilyReminder | null {
  const parent = byId(t.Parents).get(parentId);
  if (!parent) return null;
  const open = (groupBy(t.FeeDues, 'parent_id').get(parentId) ?? []).filter(isOpenDue).sort(byDueOrder);
  if (!open.length) return null;
  const students = byId(t.Students);
  const titles = open.map((d) => dueTitle(t, d));
  const names = [...new Set(open.map((d) => students.get(d.student_id)?.name).filter(Boolean))];
  const months = [...new Set(titles.map((x) => x.period).filter(Boolean))];
  const balance = open.reduce((s, d) => s + num(d.balance), 0);
  const text = fillMessage(template ?? templateText(t.MessageTemplates, 'FeeReminder'), {
    parent: parent.guardian_name,
    student: names.join(', '),
    course: [...new Set(titles.map((x) => x.title))].join(', '),
    month: months.join(', ') || monthLabel(todayIso().slice(0, 7)),
    amount: amountText(balance),
    balance: amountText(balance),
    academy: settings.academy_name || academy,
    academy_phone: settings.academy_phone ?? '',
  });
  return { parentId, phone: parent.phone, text, url: whatsappUrl(parent.phone, text) };
}

/** WhatsApp reminder for a single open due (Fees → By month rows). */
export function dueReminder(t: CoreTables, settings: Record<string, string>, academy: string, due: FeeDue, template?: string): FamilyReminder | null {
  if (!isOpenDue(due)) return null;
  const parent = byId(t.Parents).get(due.parent_id);
  if (!parent) return null;
  const student = byId(t.Students).get(due.student_id);
  const { title, period } = dueTitle(t, due);
  const balance = num(due.balance);
  const text = fillMessage(template ?? templateText(t.MessageTemplates, 'FeeReminder'), {
    parent: parent.guardian_name,
    student: student?.name ?? '',
    course: title,
    month: period || monthLabel(todayIso().slice(0, 7)),
    amount: amountText(balance),
    balance: amountText(balance),
    academy: settings.academy_name || academy,
    academy_phone: settings.academy_phone ?? '',
  });
  return { parentId: parent.id, phone: parent.phone, text, url: whatsappUrl(parent.phone, text) };
}
