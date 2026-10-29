// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addressKey, clientAddress, UNATTRIBUTED_CLIENT } from '../client-address';

function forwardedFor(value?: string): Headers {
  const headers = new Headers();
  if (value !== undefined) headers.set('x-forwarded-for', value);
  return headers;
}

describe('clientAddress', () => {
  it('uses the address Next.js records from the connection when there is no proxy', () => {
    // `next start` fills X-Forwarded-For with the socket address when the request has none.
    expect(clientAddress(forwardedFor('203.0.113.7'), 0)).toBe('203.0.113.7');
    expect(clientAddress(forwardedFor('::ffff:127.0.0.1'), 0)).toBe('127.0.0.1');
    expect(clientAddress(forwardedFor('2001:db8::7'), 0)).toBe('2001:db8:0:0::/64');
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
    expect(clientAddress(forwardedFor('2001:DB8::1, 198.51.100.1'), 2)).toBe('2001:db8:0:0::/64');
  });

  it('keys IPv6 addresses by their /64, so one host cannot rotate through its prefix', () => {
    const viaTunnel = (address: string) => clientAddress(forwardedFor(`spoofed, ${address}`), 1);
    const sameHost = ['2001:db8:aa:bb::1', '2001:db8:aa:bb:ffff:ffff:ffff:fffe', '2001:0DB8:00aa:00bb:1:2:3:4'];
    expect(new Set(sameHost.map(viaTunnel))).toEqual(new Set(['2001:db8:aa:bb::/64']));
    expect(viaTunnel('2001:db8:aa:bc::1')).not.toBe(viaTunnel('2001:db8:aa:bb::1'));
    expect(viaTunnel('2001:db8:1::1')).not.toBe(viaTunnel('2001:db8:2::1'));
  });

  it('matches compressed and expanded forms of the same IPv6 address', () => {
    expect(addressKey('2001:db8::1')).toBe(addressKey('2001:db8:0:0::1'));
    expect(addressKey('2001:db8::1')).toBe(addressKey('2001:0db8:0000:0000:0000:0000:0000:0001'));
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(addressKey('64:ff9b::192.0.2.33')).toBe('64:ff9b:0:0::/64');
  });

  it('keys IPv4-mapped IPv6 addresses as the IPv4 address, in full', () => {
    expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('::FFFF:cb00:7107')).toBe('203.0.113.7');
    expect(addressKey('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientAddress(forwardedFor('spoofed, ::ffff:203.0.113.7'), 1)).toBe(clientAddress(forwardedFor('203.0.113.7'), 1));
  });

  it('rejects anything that is not an IP address', () => {
    for (const value of ['', 'unattributed', '203.0.113.7:443', '[2001:db8::1]', '2001:db8::g', '1.2.3']) {
      expect(addressKey(value)).toBeNull();
    }
  });

  it('shares one key when the trusted entry is missing or malformed', () => {
    expect(clientAddress(forwardedFor(), 1)).toBe(UNATTRIBUTED_CLIENT);
    expect(clientAddress(forwardedFor('203.0.113.7'), 2)).toBe(UNATTRIBUTED_CLIENT);
    expect(clientAddress(forwardedFor('203.0.113.7, '), 1)).toBe(UNATTRIBUTED_CLIENT);
    expect(clientAddress(forwardedFor('203.0.113.7, 203.0.113.7:443'), 1)).toBe(UNATTRIBUTED_CLIENT);
  });
});
