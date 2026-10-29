// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clientAddress, UNATTRIBUTED_CLIENT } from '../client-address';

function forwardedFor(value?: string): Headers {
  const headers = new Headers();
  if (value !== undefined) headers.set('x-forwarded-for', value);
  return headers;
}

describe('clientAddress', () => {
  it('uses the address Next.js records from the connection when there is no proxy', () => {
    // `next start` fills X-Forwarded-For with the socket address when the request has none.
    expect(clientAddress(forwardedFor('203.0.113.7'), 0)).toBe('203.0.113.7');
    expect(clientAddress(forwardedFor('::ffff:127.0.0.1'), 0)).toBe('::ffff:127.0.0.1');
  });

  it('keeps the whole header without a proxy, bounded in length', () => {
    expect(clientAddress(forwardedFor('198.51.100.9, 203.0.113.7'), 0)).toBe('198.51.100.9, 203.0.113.7');
    expect(clientAddress(forwardedFor('x'.repeat(500)), 0)).toHaveLength(64);
    expect(clientAddress(forwardedFor(), 0)).toBe(UNATTRIBUTED_CLIENT);
  });

  it('takes the address a single proxy appended, not the client-supplied prefix', () => {
    expect(clientAddress(forwardedFor('198.51.100.66, 203.0.113.7'), 1)).toBe('203.0.113.7');
    expect(clientAddress(forwardedFor('fake'), 1)).toBe(UNATTRIBUTED_CLIENT);
    expect(clientAddress(forwardedFor('203.0.113.7'), 1)).toBe('203.0.113.7');
  });

  it('gives rotating spoofed prefixes the same address', () => {
    const keys = ['1.1.1.1', '2.2.2.2, 3.3.3.3', 'not-an-ip', ''].map((spoof) =>
      clientAddress(forwardedFor(`${spoof}, 203.0.113.7`), 1)
    );
    expect(new Set(keys)).toEqual(new Set(['203.0.113.7']));
  });

  it('counts back one entry per trusted proxy', () => {
    const header = 'spoofed, 203.0.113.7, 198.51.100.1';
    expect(clientAddress(forwardedFor(header), 2)).toBe('203.0.113.7');
    expect(clientAddress(forwardedFor(header), 3)).toBe(UNATTRIBUTED_CLIENT);
    expect(clientAddress(forwardedFor('2001:DB8::1, 198.51.100.1'), 2)).toBe('2001:db8::1');
  });

  it('shares one key when the trusted entry is missing or malformed', () => {
    expect(clientAddress(forwardedFor(), 1)).toBe(UNATTRIBUTED_CLIENT);
    expect(clientAddress(forwardedFor('203.0.113.7'), 2)).toBe(UNATTRIBUTED_CLIENT);
    expect(clientAddress(forwardedFor('203.0.113.7, '), 1)).toBe(UNATTRIBUTED_CLIENT);
    expect(clientAddress(forwardedFor('203.0.113.7, 203.0.113.7:443'), 1)).toBe(UNATTRIBUTED_CLIENT);
  });
});
