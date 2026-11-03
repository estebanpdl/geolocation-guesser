/**
 * The client address used to key per-client limits.
 *
 * Route handlers see no socket address. `next start` copies it into
 * X-Forwarded-For only when the request carries no such header, so a client
 * that sends its own header chooses the value. Proxies such as tunnels append
 * the address they saw to the header, which makes the entry added by the
 * outermost trusted proxy the only one a client cannot choose.
 */
import { isIP } from 'node:net';

/** Requests whose address cannot be attributed share this key, and with it one budget. */
export const UNATTRIBUTED_CLIENT = 'unattributed';

const MAX_HEADER_KEY_LENGTH = 64;

/**
 * With `trustedProxyHops` 0 there is no proxy: the whole header is used, as Next.js
 * recorded it from the connection or as the client sent it. With N trusted proxies,
 * each appending one entry, the Nth entry from the end is the address the outermost
 * proxy saw; anything before it is client-supplied and ignored.
 */
export function clientAddress(headers: Headers, trustedProxyHops: number): string {
  const header = headers.get('x-forwarded-for');
  if (trustedProxyHops === 0) {
    if (header === null) return UNATTRIBUTED_CLIENT;
    return addressKey(header.trim()) ?? header.slice(0, MAX_HEADER_KEY_LENGTH);
  }

  const entries = (header ?? '').split(',').map((entry) => entry.trim());
  if (entries.length < trustedProxyHops) return UNATTRIBUTED_CLIENT;
  return addressKey(entries[entries.length - trustedProxyHops]) ?? UNATTRIBUTED_CLIENT;
}

/**
 * The limit key for one IP address, or null if `address` is not one. An IPv4
 * address is its own key. An IPv6 address is keyed by its /64 prefix: a single
 * host is usually given a whole /64 and can use any address in it. IPv4-mapped
 * IPv6 addresses (`::ffff:a.b.c.d`) are keyed as the IPv4 address.
 */
export function addressKey(address: string): string | null {
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return null;

  const groups = ipv6Groups(address.split('%')[0].toLowerCase());
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address, with `::` and a trailing dotted IPv4 part expanded. */
function ipv6Groups(address: string): number[] {
  let text = address;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const parse = (part: string | undefined) => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const before = parse(head);
  const after = parse(tail);
  const zeros = tail === undefined ? [] : new Array(8 - before.length - after.length).fill(0);
  return [...before, ...zeros, ...after];
}
