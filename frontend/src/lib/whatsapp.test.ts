import { describe, expect, it } from 'vitest';
import type { MessageTemplate } from '../data/types';
import { amountText, fillMessage, placeholdersIn, templateText, whatsappUrl } from './whatsapp';

const template = (type: string, text: string, active = true): MessageTemplate =>
  ({ id: type, type, name: type, text, active, created_at: '', updated_at: '' }) as unknown as MessageTemplate;

describe('whatsapp', () => {
  it('builds wa.me links from stored phone numbers', () => {
    expect(whatsappUrl('+919876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye');
  });

  it('uses the active template of a type, else the built-in one', () => {
    const list = [template('Receipt', 'old', false), template('Receipt', 'Thanks {parent}')];
    expect(templateText(list, 'Receipt')).toBe('Thanks {parent}');
    expect(templateText([], 'FeeReminder')).toContain('{student}');
  });

  it('drops the payment link sentence until online payments exist', () => {
    const text = 'Dear {parent}, ₹{amount} is due. Pay here: {payment_link}.\n\n{academy}';
    expect(fillMessage(text, { parent: 'Asha', amount: amountText(12500), academy: 'Rays' })).toBe('Dear Asha, ₹12,500 is due.\n\nRays');
    expect(fillMessage(text, { parent: 'Asha', amount: '500', academy: 'Rays', payment_link: 'https://x' })).toContain('Pay here: https://x');
    const preset = 'Fee of ₹{balance} is pending. Pay securely here: {payment_link}\n\nThank you,\n{academy}';
    expect(fillMessage(preset, { balance: '800', academy: 'Rays' })).toBe('Fee of ₹800 is pending.\n\nThank you,\nRays');
  });

  it('drops the receipt link when the PDF itself is shared', () => {
    const text = 'Dear {parent}, we received ₹{amount}. Receipt no. {receipt_no}: {receipt_link}\nBalance: ₹{balance}';
    expect(fillMessage(text, { parent: 'Asha', amount: '500', receipt_no: 'R/1', receipt_link: '', balance: '0' }))
      .toBe('Dear Asha, we received ₹500. Receipt no. R/1\nBalance: ₹0');
    expect(fillMessage(text, { parent: 'Asha', amount: '500', receipt_no: 'R/1', receipt_link: 'https://x', balance: '0' }))
      .toContain('R/1: https://x');
  });

  it('lists placeholders once, in order', () => {
    expect(placeholdersIn('{event} on {date}. {details} {event}')).toEqual(['event', 'date', 'details']);
  });
});
