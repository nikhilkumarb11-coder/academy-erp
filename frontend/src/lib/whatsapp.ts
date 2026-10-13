/**
 * Click-to-send WhatsApp messages (PRD §6.6): wa.me links prefilled from the academy's templates.
 * Templates use {placeholders}; amounts are inserted without a currency symbol because templates write "₹{amount}".
 */
import type { MessageTemplate, TemplateType } from '../data/types';
import { fillTemplate } from './ledger';
import { phoneDigits } from './phone';
import { bool } from './values';

export const amountText = (n: number) => Math.round(n).toLocaleString('en-IN');

/** Without a phone number WhatsApp asks which chat to send to (used for groups). */
export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;
}

export const TEMPLATE_TYPES: { type: TemplateType; label: string; placeholders: string[] }[] = [
  { type: 'FeeReminder', label: 'Fee reminder', placeholders: ['parent', 'student', 'course', 'month', 'balance', 'academy', 'academy_phone', 'payment_link'] },
  { type: 'Receipt', label: 'Receipt', placeholders: ['parent', 'student', 'course', 'month', 'amount', 'balance', 'receipt_no', 'receipt_link', 'academy'] },
  { type: 'Absent', label: 'Absent today', placeholders: ['parent', 'student', 'course', 'date', 'academy'] },
  { type: 'Event', label: 'Event', placeholders: ['event', 'date', 'details', 'academy', 'academy_phone'] },
  { type: 'NewCourse', label: 'New course', placeholders: ['course', 'details', 'academy', 'academy_phone'] },
  { type: 'Custom', label: 'Other', placeholders: ['parent', 'student', 'message', 'academy', 'academy_phone'] },
];

export const templateTypeLabel = (type: string) => TEMPLATE_TYPES.find((t) => t.type === type)?.label ?? type;

/** Announcement types: sent to groups or to many parents rather than tied to one record. */
export const BROADCAST_TYPES: TemplateType[] = ['Event', 'NewCourse', 'Custom'];

const FALLBACK: Record<string, string> = {
  FeeReminder: 'Dear {parent}, the fee of ₹{balance} for {student} ({course}, {month}) is pending.\n\n{academy}',
  Receipt: 'Dear {parent}, we received ₹{amount}. Receipt {receipt_no}: {receipt_link}\nBalance: ₹{balance}\n\n{academy}',
  Absent: 'Dear {parent}, {student} missed {course} today ({date}).\n\n{academy}',
};

export function activeTemplates(templates: MessageTemplate[], type: string): MessageTemplate[] {
  return templates.filter((t) => t.type === type && bool(t.active));
}

export function templateText(templates: MessageTemplate[], type: string): string {
  return activeTemplates(templates, type)[0]?.text ?? FALLBACK[type] ?? '';
}

/** Distinct {placeholders} in a template, in order of appearance. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

/** Online payment links arrive with Razorpay; until then drop the "Pay … here:" part rather than send a blank link. */
export function fillMessage(text: string, values: Record<string, string | number>): string {
  const withoutLink = values.payment_link
    ? text
    : text.replace(/[^\S\n]*Pay[^.\n{]*:\s*\{payment_link\}\.?/i, '').replace(/\{payment_link\}/g, '');
  return fillTemplate(withoutLink, values).replace(/\n{3,}/g, '\n\n');
}
