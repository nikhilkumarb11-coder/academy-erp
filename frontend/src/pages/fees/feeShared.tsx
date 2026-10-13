import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../api/errors';
import { useToast } from '../../components/Toast';
import type { CoreData, CoreTables, Payment } from '../../data/types';
import { applyChanges, type Changes } from '../../data/merge';
import { coreKey, useCoreData } from '../../data/useCoreData';
import { useLogMessages } from '../../data/useMessages';
import { formatMoney } from '../../lib/fees';
import { byDueOrder, dueTitle, isOpenDue } from '../../lib/ledger';
import { tenantBasePath } from '../../tenant/loadTenant';
import { useTenant } from '../../tenant/TenantContext';
import { amountText, fillMessage, templateText, whatsappUrl } from '../../lib/whatsapp';
import { monthLabel, todayIso } from '../../lib/dates';
import { num } from '../../lib/values';

export function useMoney() {
  const { locale } = useTenant();
  return (n: number) => formatMoney(n, locale.currencySymbol);
}

interface ReceiptResult {
  changes: Changes;
  receipt_no: string;
  url: string;
  file?: { name: string; mimeType: string; base64: string };
}

function fileFrom(file: NonNullable<ReceiptResult['file']>): File {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  return new File([bytes], file.name, { type: file.mimeType });
}

interface PreparedReceipt {
  promise: Promise<ReceiptResult>;
  result?: ReceiptResult;
}

/** Receipts fetched with their PDF, per payment and status, so a later tap can share without waiting. */
const prepared = new Map<string, PreparedReceipt>();

/** Lines of a payment: which child, course and period it paid. */
export function paymentLines(t: CoreTables, payment: Payment) {
  return t.PaymentAllocations.filter((a) => a.payment_id === payment.id && a.due_id).map((a) => {
    const due = t.FeeDues.find((d) => d.id === a.due_id);
    const student = t.Students.find((s) => s.id === (due?.student_id ?? a.student_id));
    const { title, period } = due ? dueTitle(t, due) : { title: 'Due', period: '' };
    return { id: a.id, student: student?.name ?? '', title, period, amount: num(a.amount) };
  });
}

/**
 * Receipt actions (PRD §6.5). The PDF is created in Drive on first use, so these call receipts.get.
 * Browsers only allow pop-ups and the share sheet straight after a tap, not after a slow request:
 * links open in a tab created before the request, and sharing uses a receipt fetched ahead (prepare).
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

  async function fetchReceipt(paymentId: string, withFile = false) {
    const res = await api<ReceiptResult>('receipts.get', { payment_id: paymentId, withFile });
    if (res.changes) queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? applyChanges(old, res.changes) : old));
    return res;
  }

  const preparedKey = (payment: Payment) => `${tenant.slug}:${payment.id}:${payment.status}`;

  /** Starts fetching the receipt PDF so Share can open the share sheet instantly. */
  function prepare(payment: Payment): PreparedReceipt {
    const key = preparedKey(payment);
    let entry = prepared.get(key);
    if (!entry) {
      const created: PreparedReceipt = { promise: fetchReceipt(payment.id, true) };
      created.promise.then(
        (res) => { created.result = res; },
        () => { prepared.delete(key); },
      );
      prepared.set(key, created);
      entry = created;
    }
    return entry;
  }

  /** The receipt link, reusing a prepared receipt so one payment never creates two PDFs. */
  function receiptFor(payment: Payment) {
    return prepared.get(preparedKey(payment))?.promise ?? fetchReceipt(payment.id);
  }

  function link(paymentId: string, url: string) {
    return isDemo ? `${window.location.origin}${tenantBasePath(tenant.slug)}/receipts/${paymentId}` : url;
  }

  function message(payment: Payment, receiptLink: string) {
    const t = data?.tables;
    if (!t) return '';
    const parent = t.Parents.find((p) => p.id === payment.parent_id);
    const lines = paymentLines(t, payment);
    const balance = t.FeeDues.filter((d) => d.parent_id === payment.parent_id && isOpenDue(d)).reduce((s, d) => s + num(d.balance), 0);
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
      const res = await receiptFor(payment);
      const phone = data?.tables.Parents.find((p) => p.id === payment.parent_id)?.phone ?? '';
      const text = message(payment, link(payment.id, res.url));
      const url = whatsappUrl(phone, text);
      logMessages([{ type: 'Receipt', parent_id: payment.parent_id, preview: text }]);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      toast(errorMessage(err), 'error');
    }
  }

  /** Native share sheet with the PDF attached (phones); falls back to WhatsApp with the link. */
  function shareNow(payment: Payment, res: ReceiptResult) {
    const file = res.file && fileFrom(res.file);
    if (file && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], text: message(payment, res.url), title: `Receipt ${res.receipt_no}` });
    }
    return navigator.share({ text: message(payment, res.url) });
  }

  /**
   * Native share sheet with the PDF attached (phones); falls back to WhatsApp with the link.
   * When the PDF was not ready at the tap, the browser refuses the share sheet; the PDF is then
   * kept and the next tap shares it at once.
   */
  async function share(payment: Payment) {
    const canShareFiles = !isDemo && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
    if (!canShareFiles) return sendWhatsApp(payment);
    const entry = prepare(payment);
    try {
      if (entry.result) {
        await shareNow(payment, entry.result);
        return;
      }
      const res = await entry.promise;
      try {
        await shareNow(payment, res);
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

  async function open(payment: Payment) {
    if (isDemo) {
      navigate(`/receipts/${payment.id}`);
      return;
    }
    const tab = window.open('', '_blank');
    try {
      const res = await receiptFor(payment);
      if (tab) tab.location.href = res.url;
      else window.location.href = res.url;
    } catch (err) {
      tab?.close();
      toast(errorMessage(err), 'error');
    }
  }

  /** Fetches the receipt ahead of a likely Share tap (phones with a share sheet only). */
  function warmUp(payment: Payment) {
    if (!isDemo && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') prepare(payment);
  }

  return { share, sendWhatsApp, open, warmUp };
}

export interface FamilyReminder {
  parentId: string;
  phone: string;
  text: string;
  url: string;
}

/** WhatsApp fee reminder for a family's open dues; `template` defaults to the active FeeReminder template. */
export function familyReminder(t: CoreTables, settings: Record<string, string>, academy: string, parentId: string, template?: string): FamilyReminder | null {
  const parent = t.Parents.find((p) => p.id === parentId);
  if (!parent) return null;
  const open = t.FeeDues.filter((d) => d.parent_id === parentId && isOpenDue(d)).sort(byDueOrder);
  if (!open.length) return null;
  const titles = open.map((d) => dueTitle(t, d));
  const students = [...new Set(open.map((d) => t.Students.find((s) => s.id === d.student_id)?.name).filter(Boolean))];
  const months = [...new Set(titles.map((x) => x.period).filter(Boolean))];
  const balance = open.reduce((s, d) => s + num(d.balance), 0);
  const text = fillMessage(template ?? templateText(t.MessageTemplates, 'FeeReminder'), {
    parent: parent.guardian_name,
    student: students.join(', '),
    course: [...new Set(titles.map((x) => x.title))].join(', '),
    month: months.join(', ') || monthLabel(todayIso().slice(0, 7)),
    amount: amountText(balance),
    balance: amountText(balance),
    academy: settings.academy_name || academy,
    academy_phone: settings.academy_phone ?? '',
  });
  return { parentId, phone: parent.phone, text, url: whatsappUrl(parent.phone, text) };
}