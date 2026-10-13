import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../api/errors';
import { useToast } from '../../components/Toast';
import type { CoreData, CoreTables, Payment } from '../../data/types';
import { applyChanges, type Changes } from '../../data/merge';
import { coreKey, useCoreData } from '../../data/useCoreData';
import { formatMoney } from '../../lib/fees';
import { dueTitle, isOpenDue } from '../../lib/ledger';
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
 * A tab is opened before the request because browsers block pop-ups opened after an await.
 */
export function useReceiptActions() {
  const tenant = useTenant();
  const { api } = useAuth();
  const { data } = useCoreData();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const isDemo = tenant.apiUrl === 'mock';

  async function fetchReceipt(paymentId: string, withFile = false) {
    const res = await api<ReceiptResult>('receipts.get', { payment_id: paymentId, withFile });
    if (res.changes) queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? applyChanges(old, res.changes) : old));
    return res;
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
      const res = await fetchReceipt(payment.id);
      const phone = data?.tables.Parents.find((p) => p.id === payment.parent_id)?.phone ?? '';
      const url = whatsappUrl(phone, message(payment, link(payment.id, res.url)));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      toast(errorMessage(err), 'error');
    }
  }

  /** Native share sheet with the PDF attached (phones); falls back to WhatsApp with the link. */
  async function share(payment: Payment) {
    const canShareFiles = !isDemo && typeof navigator.canShare === 'function';
    if (!canShareFiles) return sendWhatsApp(payment);
    try {
      const res = await fetchReceipt(payment.id, true);
      const file = res.file && fileFrom(res.file);
      if (file && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: message(payment, res.url), title: `Receipt ${res.receipt_no}` });
        return;
      }
      await navigator.share({ text: message(payment, res.url) });
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
      const res = await fetchReceipt(payment.id);
      if (tab) tab.location.href = res.url;
      else window.location.href = res.url;
    } catch (err) {
      tab?.close();
      toast(errorMessage(err), 'error');
    }
  }

  return { share, sendWhatsApp, open };
}

/** WhatsApp fee reminder for a family's open dues. */
export function reminderUrl(t: CoreTables, settings: Record<string, string>, academy: string, parentId: string): string | null {
  const parent = t.Parents.find((p) => p.id === parentId);
  if (!parent) return null;
  const open = t.FeeDues.filter((d) => d.parent_id === parentId && isOpenDue(d));
  if (!open.length) return null;
  const titles = open.map((d) => dueTitle(t, d));
  const students = [...new Set(open.map((d) => t.Students.find((s) => s.id === d.student_id)?.name).filter(Boolean))];
  const months = [...new Set(titles.map((x) => x.period).filter(Boolean))];
  const balance = open.reduce((s, d) => s + num(d.balance), 0);
  return whatsappUrl(parent.phone, fillMessage(templateText(t.MessageTemplates, 'FeeReminder'), {
    parent: parent.guardian_name,
    student: students.join(', '),
    course: [...new Set(titles.map((x) => x.title))].join(', '),
    month: months.join(', ') || monthLabel(todayIso().slice(0, 7)),
    amount: amountText(balance),
    balance: amountText(balance),
    academy: settings.academy_name || academy,
  }));
}