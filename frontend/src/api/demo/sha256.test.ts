import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hmacSha256, sha256 } from './sha256';

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('sha256', () => {
  it.each(['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(200), 'नमस्ते ₹1,000'])('matches node for %j', (s) => {
    expect(hex(sha256(enc(s)))).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });

  it('computes HMAC like node, including long keys', () => {
    for (const key of ['k', 'x'.repeat(100)]) {
      expect(hex(hmacSha256(enc('payload.data'), enc(key)))).toBe(createHmac('sha256', key).update('payload.data').digest('hex'));
    }
  });
});
