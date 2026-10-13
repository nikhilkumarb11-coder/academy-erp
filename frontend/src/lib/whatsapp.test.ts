import { describe, expect, it } from 'vitest';
import type { MessageTemplate } from '../data/types';
import { amountText, fillMessage, templateText, whatsappUrl } from './whatsapp';

const template = (type: string, text: string, active = true): MessageTemplate =>
  ({ id: type, type, name: type, text, active, created_at: '', updated_at: '' }) as unknown as MessageTemplate;

describe('whatsapp', () => {
  it('builds wa.me links from stored phone numbers', () => {
    expect(whatsappUrl('+919876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye');
  });

  it('uses the active template of a type, else the built-in one', () => {
    const list = [template('Receipt', 'old', false), template('Receipt', 'Thanks {parent}')];
    expect(templateText(list, 'Receipt')).toBe('Thanks {parent}');
    expect(templateText([], 'Absent')).toContain('{student}');
  });

  it('drops the payment link sentence until online payments exist', () => {
    const text = 'Dear {parent}, ₹{amount} is due. Pay here: {payment_link}.\n\n{academy}';
    expect(fillMessage(text, { parent: 'Asha', amount: amountText(12500), academy: 'Rays' })).toBe('Dear Asha, ₹12,500 is due.\n\nRays');
    expect(fillMessage(text, { parent: 'Asha', amount: '500', academy: 'Rays', payment_link: 'https://x' })).toContain('Pay here: https://x');
  });
});
