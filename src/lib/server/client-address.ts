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
    return (header ?? UNATTRIBUTED_CLIENT).slice(0, MAX_HEADER_KEY_LENGTH);
  }

  const entries = (header ?? '').split(',').map((entry) => entry.trim());
  if (entries.length < trustedProxyHops) return UNATTRIBUTED_CLIENT;
  const address = entries[entries.length - trustedProxyHops].toLowerCase();
  return isIP(address) ? address : UNATTRIBUTED_CLIENT;
}
