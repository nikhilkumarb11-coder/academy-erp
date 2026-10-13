/**
 * Click-to-send WhatsApp messages (PRD §6.6): wa.me links prefilled from the academy's templates.
 * Templates use {placeholders}; amounts are inserted without a currency symbol because templates write "₹{amount}".
 */
import type { MessageTemplate } from '../data/types';
import { fillTemplate } from './ledger';
import { phoneDigits } from './phone';
import { bool } from './values';

export const amountText = (n: number) => Math.round(n).toLocaleString('en-IN');

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;
}

const FALLBACK: Record<string, string> = {
  FeeReminder: 'Dear {parent}, the fee of ₹{balance} for {student} ({course}, {month}) is pending.\n\n{academy}',
  Receipt: 'Dear {parent}, we received ₹{amount}. Receipt {receipt_no}: {receipt_link}\nBalance: ₹{balance}\n\n{academy}',
  Absent: 'Dear {parent}, {student} missed {course} today ({date}).\n\n{academy}',
};

export function templateText(templates: MessageTemplate[], type: string): string {
  return templates.find((t) => t.type === type && bool(t.active))?.text ?? FALLBACK[type] ?? '';
}

/** Online payment links arrive in phase 4; until then drop the "Pay here" part rather than send a blank link. */
export function fillMessage(text: string, values: Record<string, string | number>): string {
  const withoutLink = values.payment_link ? text : text.replace(/\s*Pay here:\s*\{payment_link\}\.?/i, '').replace(/\{payment_link\}/g, '');
  return fillTemplate(withoutLink, values).replace(/\n{3,}/g, '\n\n');
}
