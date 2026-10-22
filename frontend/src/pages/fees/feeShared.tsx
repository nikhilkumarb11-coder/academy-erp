import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../api/errors';
import { useToast } from '../../components/Toast';
import { Card } from '../../components/ui';
import type { CoreData, CoreTables, Payment, Settings } from '../../data/types';
import { applyChanges, type Changes } from '../../data/merge';
import { coreKey, useCoreData } from '../../data/useCoreData';
import { useLogMessages } from '../../data/useMessages';
import { formatMoney } from '../../lib/fees';
import { byId, groupBy } from '../../lib/indexes';
import { byDueOrder, dueTitle, isOpenDue } from '../../lib/ledger';
import { receiptFileName, receiptHtml, receiptLogoUrl } from '../../lib/receipt';
import { buildReceiptPdf, fileToBase64, logoDataUri } from '../../lib/receiptPdf';
import { tenantBasePath } from '../../tenant/loadTenant';
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

interface ReceiptResult {
  changes: Changes;
  receipt_no: string;
  url: string;
}

interface PreparedPdf {
  promise: Promise<File>;
  file?: File;
}

/** PDFs built on this device, per payment version, so a later tap shares without waiting. */
const pdfs = new Map<string, PreparedPdf>();
/** Drive links being created, per payment version, so one payment never uploads twice. */
const links = new Map<string, Promise<string>>();

const receiptStatus = (payment: Payment) => (payment.status === 'Cancelled' ? 'Cancelled' : 'Active');

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
 * Receipt actions (PRD §6.5). The receipt and its PDF are made on this device from cached data, so
 * opening and sharing need no server call. Only "Send link" needs a Drive copy: it is uploaded once
 * (ahead of time from the payment sheet) and its link is kept in the Receipts table.
 * Browsers only allow pop-ups and the share sheet straight after a tap: the WhatsApp tab is opened
 * before any wait, and the PDF is usually ready before the tap.
 */
export function useReceiptActions() {
  const tenant = useTenant();
  const { api } = useAuth();
  const { data } = useCoreData();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const logMessages = useLogMessages();
  const isDemo = tenant.apiUrl === 'mock';

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

  /** The receipt's Drive link: from the Receipts table when uploaded already, else uploads this device's PDF. */
  function linkFor(payment: Payment): Promise<string> {
    if (isDemo) return Promise.resolve(`${window.location.origin}${tenantBasePath(tenant.slug)}/receipts/${payment.id}`);
    const stored = data?.tables.Receipts.find((r) => r.payment_id === payment.id && r.status === receiptStatus(payment) && r.drive_url);
    if (stored) return Promise.resolve(stored.drive_url);
    const key = versionKey(payment);
    let pending = links.get(key);
    if (!pending) {
      pending = (async () => {
        const pdf = await fileToBase64(await pdfEntry(payment).promise);
        const res = await api<ReceiptResult>('receipts.get', { payment_id: payment.id, pdf });
        if (res.changes) queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? applyChanges(old, res.changes) : old));
        return res.url;
      })();
      pending.catch(() => links.delete(key));
      links.set(key, pending);
    }
    return pending;
  }

  function message(payment: Payment, receiptLink: string) {
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
      receipt_link: receiptLink,
      academy: data?.settings.academy_name || tenant.name,
    });
  }

  async function sendWhatsApp(payment: Payment) {
    const tab = window.open('', '_blank');
    try {
      const url = await linkFor(payment);
      const phone = data?.tables.Parents.find((p) => p.id === payment.parent_id)?.phone ?? '';
      const text = message(payment, url);
      const wa = whatsappUrl(phone, text);
      logMessages([{ type: 'Receipt', parent_id: payment.parent_id, preview: text }]);
      if (tab) tab.location.href = wa;
      else window.location.href = wa;
    } catch (err) {
      tab?.close();
      toast(errorMessage(err), 'error');
    }
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

  /** Shares the PDF itself (no Drive link); where files cannot be shared, downloads it instead. */
  async function shareNow(payment: Payment, file: File) {
    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: message(payment, ''), title: `Receipt ${payment.receipt_no}` });
      return;
    }
    saveFile(file);
    toast('Receipt PDF downloaded. Attach it in WhatsApp to send.', 'success');
  }

  /**
   * Shares the receipt as a PDF file. The PDF takes well under a second on the device; should the
   * browser still refuse the share sheet after the wait, the PDF is kept and the next tap shares it.
   */
  async function share(payment: Payment) {
    try {
      const entry = pdfEntry(payment);
      if (entry.file) {
        await shareNow(payment, entry.file);
        return;
      }
      const file = await entry.promise;
      try {
        await shareNow(payment, file);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          toast('Receipt is ready. Tap Share again to send it.', 'success');
          return;
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
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

  /** Builds the PDF ahead of a likely Share tap, then uploads it so "Send link" is instant too. */
  function warmUp(payment: Payment) {
    const run = () => {
      try {
        pdfEntry(payment).promise.then(() => linkFor(payment)).catch(() => {});
      } catch {
        // data still loading: the tap builds it
      }
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1500 });
    else setTimeout(run, 300);
  }

  return { share, sendWhatsApp, open, download, warmUp };
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
